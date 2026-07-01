use std::collections::{HashMap};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use axum::{
    routing::{get, post, delete},
    extract::{Path, State},
    response::{IntoResponse, Response},
    body::Body,
    Json, Router,
};
use tower_http::cors::CorsLayer;
use rusqlite::{params, Connection};
use parking_lot::Mutex;
use futures_util::StreamExt;
use reqwest::Client;
use chrono::Local;
use log::{info, error, warn};
use tauri_plugin_opener::OpenerExt;

// --- 数据模型 ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ChatRequest {
    pub messages: Vec<Message>,
    pub model: Option<String>,
    pub stream: Option<bool>,
    pub session_id: Option<String>,
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<serde_json::Value>,
}



#[derive(Debug, Serialize, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub provider: String,
    pub caps: String,
    pub status: String,
    pub success: i64,
    pub fail: i64,
    #[serde(rename = "429")]
    pub rate_limit: i64,
    pub tokens: i64,
    pub cached: i64,
    pub last_active: String,
}

// --- 全局配置与状态 ---

const AIHUBMIX_URL: &str = "https://api.aihubmix.com/v1";
const BAILIAN_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const MODELSCOPE_URL: &str = "https://api-inference.modelscope.cn/v1";

const BAILIAN_MODELS: &[&str] = &[
    "qwen-plus", "qwen-turbo", "qwen-long", "qwen-vl-plus", 
    "qwen2.5-7b-instruct", "qwen2.5-14b-instruct", "qwen2.5-32b-instruct"
];

const MODEL_PRIORITY: &[&str] = &[
    "qwen-plus", "qwen-turbo", "qwen-long", "qwen2.5-72b-instruct",
    "gpt-4.1-mini-free", "gpt-4.1-nano-free", "gpt-4.1-free", "gpt-4o-free", 
    "claude-3-5-sonnet-free", "deepseek-v3-free", "gemini-exp-1206-free"
];



pub struct GlobalConfig {
    pub aihubmix_key: String,
    pub bailian_key: String,
    pub modelscope_key: String,
    pub proxy_port: u16,
    pub reasoning_model: String,
    // 写作助手自定义 API 配置
    pub writing_api_url: String,
    pub writing_api_key: String,
    pub writing_api_model: String,
}

#[derive(Debug, Clone, Default)]
pub struct ModelUsage {
    pub success: i64,
    pub fail: i64,
    pub rate_limits: i64,
    pub tokens: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub cached_tokens: i64,
    pub last_used: f64,
    pub cooldown_until: f64,
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub http_client: Client,
    pub active_models: RwLock<Vec<String>>,
    pub model_usage: RwLock<HashMap<String, ModelUsage>>,
    pub config: RwLock<GlobalConfig>,
    pub active_pi_pid: Mutex<Option<u32>>,
}

// --- 助手函数 ---

fn get_now_f64() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64()
}

fn get_workspace_root() -> std::path::PathBuf {
    if let Ok(cwd) = std::env::current_dir() {
        if cwd.ends_with("src-tauri") {
            cwd.parent().unwrap().to_path_buf()
        } else {
            cwd
        }
    } else {
        std::path::PathBuf::from(".")
    }
}

fn get_sync_dir() -> std::path::PathBuf {
    get_workspace_root().join("公众号文章")
}

fn sanitize_filename(name: &str) -> String {
    let mut cleaned = name.replace(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'), "-");
    cleaned = cleaned.trim().to_string();
    if cleaned.is_empty() {
        "untitled".to_string()
    } else {
        cleaned
    }
}

struct ArticleData {
    theme: String,
    content: String,
    title: Option<String>,
}

fn extract_frontmatter(content: &str) -> Option<(Vec<String>, usize, usize)> {
    let mut first_marker = None;
    let mut second_marker = None;
    
    let mut current_idx = 0;
    for line in content.split('\n') {
        let trimmed = line.trim();
        if trimmed == "---" {
            if first_marker.is_none() {
                first_marker = Some(current_idx);
            } else {
                second_marker = Some(current_idx + line.len());
                break;
            }
        }
        if first_marker.is_none() && current_idx > 2000 {
            break;
        }
        current_idx += line.len() + 1; // +1 for the '\n'
    }
    
    if let (Some(start), Some(end)) = (first_marker, second_marker) {
        let yaml_block = &content[start + 3..end - 3];
        let yaml_lines = yaml_block.lines().map(|s| s.to_string()).collect();
        let mut actual_end = end;
        if actual_end < content.len() && content.as_bytes()[actual_end] == b'\n' {
            actual_end += 1;
        } else if actual_end < content.len() && content.as_bytes()[actual_end] == b'\r' {
            actual_end += 1;
            if actual_end < content.len() && content.as_bytes()[actual_end] == b'\n' {
                actual_end += 1;
            }
        }
        Some((yaml_lines, start, actual_end))
    } else {
        None
    }
}

fn parse_markdown_file(content_str: &str) -> ArticleData {
    let mut theme = "default".to_string();
    let mut title = None;

    if let Some((yaml_lines, _, _)) = extract_frontmatter(content_str) {
        for line in yaml_lines {
            if let Some(colon_idx) = line.find(':') {
                let key = line[..colon_idx].trim().to_lowercase();
                let val = line[colon_idx + 1..].trim().to_string();
                if key == "theme" {
                    theme = val;
                } else if key == "title" {
                    title = Some(val);
                }
            }
        }
    }

    if title.is_none() {
        for line in content_str.lines() {
            let trimmed_line = line.trim();
            if trimmed_line.starts_with("# ") {
                title = Some(trimmed_line[2..].trim().to_string());
                break;
            } else if !trimmed_line.is_empty() && !trimmed_line.starts_with("<!--") {
                break;
            }
        }
    }

    ArticleData {
        theme,
        content: content_str.to_string(),
        title,
    }
}

fn write_markdown_file(content: &str, theme: &str, title: &str) -> String {
    let (mut yaml_pairs, rest_content) = if let Some((yaml_lines, start, end)) = extract_frontmatter(content) {
        let mut pairs = Vec::new();
        for line in yaml_lines {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.starts_with('#') {
                pairs.push((None, line));
                continue;
            }
            if let Some(colon_idx) = line.find(':') {
                let key = line[..colon_idx].trim().to_string();
                let val = line[colon_idx + 1..].trim().to_string();
                pairs.push((Some(key), val));
            } else {
                pairs.push((None, line));
            }
        }
        
        let mut clean_body = content.to_string();
        clean_body.replace_range(start..end, "");
        (pairs, clean_body)
    } else {
        (Vec::new(), content.to_string())
    };

    let mut theme_updated = false;
    let mut title_updated = false;

    for pair in &mut yaml_pairs {
        if let Some(key) = &pair.0 {
            let key_lower = key.to_lowercase();
            if key_lower == "theme" {
                pair.1 = theme.to_string();
                theme_updated = true;
            } else if key_lower == "title" {
                pair.1 = title.to_string();
                title_updated = true;
            }
        }
    }

    if !theme_updated {
        yaml_pairs.push((Some("theme".to_string()), theme.to_string()));
    }
    if !title_updated {
        yaml_pairs.push((Some("title".to_string()), title.to_string()));
    }

    let mut new_content = String::new();
    new_content.push_str("---\n");
    for (key_opt, val) in yaml_pairs {
        if let Some(key) = key_opt {
            new_content.push_str(&format!("{}: {}\n", key, val));
        } else {
            new_content.push_str(&format!("{}\n", val));
        }
    }
    new_content.push_str("---\n");

    let clean_body = rest_content.trim_start_matches(|c| c == '\r' || c == '\n');
    new_content.push_str(clean_body);
    
    new_content
}

fn export_db_to_disk(db: &Connection, sync_dir: &std::path::Path) -> Result<(), String> {
    let mut stmt = db.prepare("SELECT id, name, parent_id FROM wechat_folders").map_err(|e| e.to_string())?;
    let folder_rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            row.get::<_, Option<String>>(2)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut folders = Vec::new();
    for r in folder_rows {
        folders.push(r.map_err(|e| e.to_string())?);
    }

    let get_folder_path = |mut current_id: String, folders: &[(String, String, Option<String>)]| -> String {
        let mut path_parts = Vec::new();
        let mut visited = std::collections::HashSet::new();
        while !current_id.is_empty() && visited.insert(current_id.clone()) {
            if let Some(f) = folders.iter().find(|(id, _, _)| id == &current_id) {
                let sanitized_name = sanitize_filename(&f.1);
                path_parts.push(sanitized_name);
                current_id = f.2.clone().unwrap_or_default();
            } else {
                break;
            }
        }
        path_parts.reverse();
        path_parts.join("/")
    };

    for (id, _, _) in &folders {
        let folder_subpath = get_folder_path(id.clone(), &folders);
        if !folder_subpath.is_empty() {
            let path = sync_dir.join(&folder_subpath);
            std::fs::create_dir_all(&path)
                .map_err(|e| format!("Failed to create folder {:?}: {}", path, e))?;
        }
    }

    let mut stmt = db.prepare("SELECT id, title, content, theme, folder_id FROM wechat_articles").map_err(|e| e.to_string())?;
    let article_rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            row.get::<_, Option<String>>(4)?,
        ))
    }).map_err(|e| e.to_string())?;

    for r in article_rows {
        let (_id, title, content, theme, folder_id) = r.map_err(|e| e.to_string())?;
        if theme == "image" {
            continue;
        }
        let sanitized_title = sanitize_filename(&title);
        let folder_subpath = if let Some(fid) = folder_id {
            get_folder_path(fid, &folders)
        } else {
            "".to_string()
        };

        let file_name = format!("{}.md", sanitized_title);
        let dest_path = if folder_subpath.is_empty() {
            sync_dir.join(&file_name)
        } else {
            sync_dir.join(&folder_subpath).join(&file_name)
        };

        if let Some(parent) = dest_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dir {:?}: {}", parent, e))?;
        }

        let file_content = write_markdown_file(&content, &theme, &title);
        std::fs::write(&dest_path, file_content)
            .map_err(|e| format!("Failed to write article file {:?}: {}", dest_path, e))?;
    }

    Ok(())
}

fn import_disk_to_db(db: &Connection, sync_dir: &std::path::Path) -> Result<(), String> {
    db.execute("DELETE FROM wechat_folders", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM wechat_articles", []).map_err(|e| e.to_string())?;

    fn traverse(
        db: &Connection,
        current_dir: &std::path::Path,
        sync_dir: &std::path::Path,
    ) -> Result<(), String> {
        let entries = std::fs::read_dir(current_dir)
            .map_err(|e| format!("Failed to read dir {:?}: {}", current_dir, e))?;

        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let relative_path = path.strip_prefix(sync_dir)
                .map_err(|e| e.to_string())?;
            let relative_path_str = relative_path.to_string_lossy().replace("\\", "/");

            if path.is_dir() {
                let folder_name = path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                
                let parent_path = relative_path.parent();
                let parent_id = parent_path
                    .filter(|p| p.as_os_str() != "")
                    .map(|p| p.to_string_lossy().replace("\\", "/"));

                let metadata = path.metadata().ok();
                let modified = metadata
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs_f64())
                    .unwrap_or_else(get_now_f64);

                db.execute(
                    "INSERT INTO wechat_folders (id, name, parent_id, updated_at) VALUES (?, ?, ?, ?)",
                    params![relative_path_str, folder_name, parent_id, modified],
                ).map_err(|e| format!("Failed to insert folder {}: {}", relative_path_str, e))?;

                traverse(db, &path, sync_dir)?;
            } else if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_ascii_lowercase();
                    if ext_str == "md" || ext_str == "markdown" {
                        let file_content = std::fs::read_to_string(&path)
                            .map_err(|e| format!("Failed to read file {:?}: {}", path, e))?;

                        let parsed = parse_markdown_file(&file_content);

                        let title = parsed.title.clone().unwrap_or_else(|| {
                            path.file_stem()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string()
                        });

                        let parent_path = relative_path.parent();
                        let folder_id = parent_path
                            .filter(|p| p.as_os_str() != "")
                            .map(|p| p.to_string_lossy().replace("\\", "/"));

                        let metadata = path.metadata().ok();
                        let modified = metadata
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs_f64())
                            .unwrap_or_else(get_now_f64);

                        db.execute(
                            "INSERT INTO wechat_articles (id, title, content, theme, updated_at, folder_id) VALUES (?, ?, ?, ?, ?, ?)",
                            params![relative_path_str, title, parsed.content, parsed.theme, modified, folder_id],
                        ).map_err(|e| format!("Failed to insert article {}: {}", relative_path_str, e))?;
                    } else if ext_str == "png" || ext_str == "jpg" || ext_str == "jpeg" || ext_str == "gif" || ext_str == "svg" || ext_str == "webp" {
                        let title = path.file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();

                        let parent_path = relative_path.parent();
                        let folder_id = parent_path
                            .filter(|p| p.as_os_str() != "")
                            .map(|p| p.to_string_lossy().replace("\\", "/"));

                        let metadata = path.metadata().ok();
                        let modified = metadata
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs_f64())
                            .unwrap_or_else(get_now_f64);

                        db.execute(
                            "INSERT INTO wechat_articles (id, title, content, theme, updated_at, folder_id) VALUES (?, ?, ?, ?, ?, ?)",
                            params![relative_path_str, title, "", "image", modified, folder_id],
                        ).map_err(|e| format!("Failed to insert image {}: {}", relative_path_str, e))?;
                    }
                }
            }
        }
        Ok(())
    }

    if sync_dir.exists() {
        traverse(db, sync_dir, sync_dir)?;
    }
    Ok(())
}

fn sync_database_with_disk(db: &Connection) -> Result<(), String> {
    let sync_dir = get_sync_dir();
    if !sync_dir.exists() {
        std::fs::create_dir_all(&sync_dir)
            .map_err(|e| format!("Failed to create sync directory: {}", e))?;
    }

    let is_empty = match std::fs::read_dir(&sync_dir) {
        Ok(mut entries) => entries.next().is_none(),
        Err(_) => true,
    };

    if is_empty {
        export_db_to_disk(db, &sync_dir)?;
    }

    import_disk_to_db(db, &sync_dir)?;
    Ok(())
}

fn init_db() -> Connection {
    let mut db_path = std::path::PathBuf::from("aihubmix_stats.db");
    
    if let Ok(cwd) = std::env::current_dir() {
        // 开发模式：如果当前就在源码目录或 src-tauri 里
        if cwd.ends_with("src-tauri") || cwd.to_string_lossy().contains("aihub-router") {
            if cwd.ends_with("src-tauri") {
                db_path = cwd.parent().unwrap().join("aihubmix_stats.db");
            } else {
                db_path = cwd.join("aihubmix_stats.db");
            }
        } else {
            // 打包模式：优先使用用户主目录下的隐藏文件夹，避免写权限问题导致崩溃
            if let Ok(home) = std::env::var("HOME") {
                let app_dir = std::path::PathBuf::from(home).join(".mixhub-studio");
                if !app_dir.exists() {
                    let _ = std::fs::create_dir_all(&app_dir);
                }
                db_path = app_dir.join("aihubmix_stats.db");
            }
        }
    }

    let conn = Connection::open(&db_path).expect("Failed to open DB");
    
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS global_stats (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS model_stats (
            model_id TEXT PRIMARY KEY, success INTEGER DEFAULT 0, fail INTEGER DEFAULT 0,
            rate_limits INTEGER DEFAULT 0, tokens INTEGER DEFAULT 0, prompt_tokens INTEGER DEFAULT 0,
            completion_tokens INTEGER DEFAULT 0, cached_tokens INTEGER DEFAULT 0, last_used REAL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS request_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT, model TEXT, status TEXT, latency REAL,
            prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0, cached_tokens INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, title TEXT, created_at REAL);
        CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, model TEXT, timestamp REAL);
    ").ok();
    
    let _ = conn.execute("INSERT OR IGNORE INTO global_stats (key, value) VALUES ('AIHUBMIX_API_KEY', '')", []);
    let _ = conn.execute("INSERT OR IGNORE INTO global_stats (key, value) VALUES ('BAILIAN_API_KEY', '')", []);
    let _ = conn.execute("INSERT OR IGNORE INTO global_stats (key, value) VALUES ('MODELSCOPE_API_KEY', '')", []);
    let _ = conn.execute("INSERT OR IGNORE INTO global_stats (key, value) VALUES ('PROXY_PORT', '8000')", []);
    let _ = conn.execute("INSERT OR IGNORE INTO global_stats (key, value) VALUES ('REASONING_MODEL', 'gpt-4o-mini')", []);
    let _ = conn.execute("INSERT OR IGNORE INTO global_stats (key, value) VALUES ('WECHAT_APP_ID', '')", []);
    let _ = conn.execute("INSERT OR IGNORE INTO global_stats (key, value) VALUES ('WECHAT_APP_SECRET', '')", []);
    
    conn
}

async fn update_usage(state: Arc<AppState>, model_id: String, p: i64, c: i64, cached: i64, sid: Option<String>, full_text: String, latency: f64) {
    let now = get_now_f64();
    let time_str = Local::now().format("%H:%M:%S").to_string();
    let tokens = p + c;
    let rounded_latency = (latency * 100.0).round() / 100.0;
    
    {
        let mut usage_map = state.model_usage.write().await;
        let entry = usage_map.entry(model_id.clone()).or_default();
        entry.success += 1;
        entry.tokens += tokens;
        entry.prompt_tokens += p;
        entry.completion_tokens += c;
        entry.cached_tokens += cached;
        entry.last_used = now;
    }

    let db = state.db.lock();
    // 1. 更新全局统计
    let _ = db.execute("UPDATE global_stats SET value = CAST(value AS INTEGER) + ? WHERE key = 'total_tokens'", params![p + c]);
    let _ = db.execute("UPDATE global_stats SET value = CAST(value AS INTEGER) + 1 WHERE key = 'success_count'", []);
    
    // 2. 更新模型详细统计
    let _ = db.execute("INSERT OR IGNORE INTO model_stats (model_id) VALUES (?)", params![model_id]);
    let _ = db.execute("UPDATE model_stats SET success = success + 1, tokens = tokens + ?, prompt_tokens = prompt_tokens + ?, completion_tokens = completion_tokens + ?, cached_tokens = cached_tokens + ?, last_used = ? WHERE model_id = ?", 
        params![p + c, p, c, cached, now, model_id]);
    
    // 3. 记录历史日志
    let _ = db.execute("INSERT INTO request_log (time, model, status, latency, prompt_tokens, completion_tokens, cached_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)", 
        params![time_str, model_id, "Success", rounded_latency, p, c, cached]);

    if let Some(s) = sid {
        let _ = db.execute("INSERT INTO chat_messages (session_id, role, content, model, timestamp) VALUES (?, 'assistant', ?, ?, ?)", 
            params![s, full_text, model_id, now]);
    }
}

async fn refresh_models(state: Arc<AppState>) {
    let mut new_models = Vec::new();
    let config = state.config.read().await;

    if !config.bailian_key.is_empty() {
        new_models.extend(BAILIAN_MODELS.iter().map(|s| s.to_string()));
    }

    if !config.modelscope_key.is_empty() {
        if let Ok(res) = state.http_client.get(format!("{}/models", MODELSCOPE_URL))
            .header("Authorization", format!("Bearer {}", config.modelscope_key))
            .send().await {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
                    for m in data {
                        if let Some(id) = m.get("id").and_then(|i| i.as_str()) {
                            new_models.push(id.to_string());
                        }
                    }
                }
            }
        }
    }

    if !config.aihubmix_key.is_empty() {
        if let Ok(res) = state.http_client.get(format!("{}/models", AIHUBMIX_URL))
            .header("Authorization", format!("Bearer {}", config.aihubmix_key))
            .send().await {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
                    for m in data {
                        if let Some(id) = m.get("id").and_then(|i| i.as_str()) {
                            if id.to_lowercase().contains("free") || MODEL_PRIORITY.contains(&id) {
                                new_models.push(id.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    let mut active = state.active_models.write().await;
    *active = new_models;
    
    let mut usage = state.model_usage.write().await;
    let db = state.db.lock();
    for m in active.iter() {
        let _ = db.execute("INSERT OR IGNORE INTO model_stats (model_id) VALUES (?)", params![m]);
    }
    let mut stmt = db.prepare("SELECT model_id, success, fail, rate_limits, tokens, prompt_tokens, completion_tokens, cached_tokens, last_used FROM model_stats").unwrap();
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, Option<String>>(0)?.unwrap_or_default(), ModelUsage {
            success: row.get(1)?, fail: row.get(2)?, rate_limits: row.get(3)?,
            tokens: row.get(4)?, prompt_tokens: row.get(5)?, completion_tokens: row.get(6)?,
            cached_tokens: row.get(7)?, last_used: row.get(8)?, cooldown_until: 0.0,
        }))
    }).unwrap();
    for r in rows {
        if let Ok((id, u)) = r { usage.insert(id, u); }
    }
}

// --- 处理器 ---

async fn get_settings(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let db = state.db.lock();
    let mut stmt = db.prepare("SELECT key, value FROM global_stats WHERE key LIKE '%_API_KEY' OR key = 'PROXY_PORT' OR key = 'REASONING_MODEL' OR key LIKE 'WECHAT_%' OR key LIKE 'WRITING_%'").unwrap();
    let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, rusqlite::types::Value>(1)?))).unwrap();
    let mut settings = HashMap::new();
    for row in rows {
        if let Ok((k, v_val)) = row {
            let v = match v_val {
                rusqlite::types::Value::Text(s) => s,
                rusqlite::types::Value::Integer(i) => i.to_string(),
                rusqlite::types::Value::Real(f) => f.to_string(),
                _ => String::new(),
            };
            settings.insert(k, v);
        }
    }
    Json(settings)
}

#[derive(Debug, Deserialize)]
pub struct FetchWebpagePayload {
    pub url: String,
}

async fn fetch_webpage_api(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<FetchWebpagePayload>,
) -> impl IntoResponse {
    let client = &state.http_client;
    
    let res = client.get(&payload.url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7")
        .send()
        .await;

    match res {
        Err(e) => (
            axum::http::StatusCode::BAD_GATEWAY,
            axum::Json(serde_json::json!({
                "error": format!("获取网页失败: {}", e)
            }))
        ).into_response(),
        Ok(resp) => {
            let status = resp.status().as_u16();
            let content_type = resp.headers().get("content-type")
                .map(|h| h.to_str().unwrap_or_default().to_string())
                .unwrap_or_default();
            let final_url = resp.url().to_string();
            let bytes = resp.bytes().await.unwrap_or_default();
            (
                axum::http::StatusCode::OK,
                axum::Json(serde_json::json!({
                    "status": status,
                    "url": final_url,
                    "content_type": content_type,
                    "body": String::from_utf8_lossy(&bytes).to_string()
                }))
            ).into_response()
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct WebSearchPayload {
    pub query: String,
}

async fn web_search_api(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<WebSearchPayload>,
) -> impl IntoResponse {
    let client = &state.http_client;
    let escaped_query = urlencoding::encode(&payload.query);
    let url = format!("https://www.so.com/s?q={}", escaped_query);
    
    let res = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7")
        .send()
        .await;

    match res {
        Err(e) => (
            axum::http::StatusCode::BAD_GATEWAY,
            axum::Json(serde_json::json!({
                "error": format!("搜索失败: {}", e)
            }))
        ).into_response(),
        Ok(resp) => {
            let bytes = resp.bytes().await.unwrap_or_default();
            (
                axum::http::StatusCode::OK,
                axum::Json(serde_json::json!({
                    "html": String::from_utf8_lossy(&bytes).to_string()
                }))
            ).into_response()
        }
    }
}

async fn purge_stats(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut usage = state.model_usage.write().await;
    usage.clear();
    
    let db = state.db.lock();
    let _ = db.execute("DELETE FROM request_log", []);
    let _ = db.execute("UPDATE model_stats SET success=0, fail=0, rate_limits=0, tokens=0, prompt_tokens=0, completion_tokens=0, cached_tokens=0, last_used=0", []);
    let _ = db.execute("UPDATE global_stats SET value = '0' WHERE key IN ('total_tokens', 'success_count', 'fail_count')", []);
    
    Json(serde_json::json!({"status": "ok"}))
}

async fn get_stats(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let now = get_now_f64();
    let usage = state.model_usage.read().await;
    let active = state.active_models.read().await;
    
    // 1. 获取所有有统计记录的模型（包括活跃和历史）
    let mut all_model_ids: Vec<String> = active.clone();
    for m_id in usage.keys() {
        if !all_model_ids.contains(m_id) {
            all_model_ids.push(m_id.clone());
        }
    }

    let mut models_data = Vec::new();
    for m_id in all_model_ids {
        let u = usage.get(&m_id).cloned().unwrap_or_default();
        let status = if u.cooldown_until > now { format!("⏳ Cooldown") } else { "✅ Available".to_string() };
        let provider = if m_id.starts_with("custom-provider/") { "公众号编辑" } else if BAILIAN_MODELS.contains(&m_id.as_str()) { "Bailian" } else if m_id.contains("free") { "AIHubMix" } else { "ModelScope" };
        
        models_data.push(ModelInfo {
            id: m_id.clone(), provider: provider.to_string(), caps: "📝 Text".to_string(), status,
            success: u.success, fail: u.fail, rate_limit: u.rate_limits, tokens: u.tokens, cached: u.cached_tokens,
            last_active: if u.last_used > 0.0 { 
                chrono::TimeZone::timestamp_opt(&Local, u.last_used as i64, 0)
                    .unwrap()
                    .format("%H:%M:%S")
                    .to_string() 
            } else { "-".to_string() },
        });
    }

    // 2. 从数据库拉取历史记录 (最近 50 条)
    let history = {
        let db = state.db.lock();
        let mut stmt = db.prepare("SELECT time, model, status, latency, prompt_tokens, completion_tokens FROM request_log ORDER BY id DESC LIMIT 50").unwrap();
        let rows = stmt.query_map([], |row| {
            let p = row.get::<_, Option<i64>>(4)?.unwrap_or(0);
            let c = row.get::<_, Option<i64>>(5)?.unwrap_or(0);
            Ok(serde_json::json!({
                "time": row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                "model": row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                "status": row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                "latency": row.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
                "p": p, // 改为前端期望的 p
                "c": c, // 改为前端期望的 c
                "tokens": p + c,
            }))
        }).unwrap();
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };

    // 3. 计算汇总数据
    let mut success_count = 0;
    let mut total_tokens = 0;
    let mut fail_count = 0;
    
    for u in usage.values() {
        success_count += u.success;
        fail_count += u.fail + u.rate_limits;
        total_tokens += u.tokens;
    }
    let total_reqs = success_count + fail_count;

    Json(serde_json::json!({
        "summary": { 
            "total_requests": total_reqs, 
            "success_count": success_count, 
            "total_tokens": total_tokens, 
            "fail_count": fail_count 
        },
        "models": models_data,
        "history": history
    }))
}

async fn save_settings(State(state): State<Arc<AppState>>, Json(payload): Json<HashMap<String, serde_json::Value>>) -> impl IntoResponse {
    let mut config = state.config.write().await;
    let db = state.db.lock();
    for (k, v) in payload {
        let val_str = match &v {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Number(n) => n.to_string(),
            _ => continue,
        };
        let _ = db.execute("INSERT OR REPLACE INTO global_stats (key, value) VALUES (?, ?)", params![k, val_str]);
        match k.as_str() {
            "AIHUBMIX_API_KEY" => config.aihubmix_key = val_str,
            "BAILIAN_API_KEY" => config.bailian_key = val_str,
            "MODELSCOPE_API_KEY" => config.modelscope_key = val_str,
            "PROXY_PORT" => {
                if let Ok(p) = val_str.parse::<u16>() {
                    config.proxy_port = p;
                }
            }
            "REASONING_MODEL" => config.reasoning_model = val_str,
            "WRITING_API_URL" => config.writing_api_url = val_str,
            "WRITING_API_KEY" => config.writing_api_key = val_str,
            "WRITING_API_MODEL" => config.writing_api_model = val_str,
            _ => {}
        }
    }
    Json(serde_json::json!({"status": "ok"}))
}

/// Proxy endpoint for the writing assistant.
/// Tauri WebView cannot fetch external HTTPS URLs directly ("Load failed").
/// This handler runs in the Rust process (no CSP) and forwards to the
/// user-configured custom API, or falls back to MixHub routing.
async fn writing_proxy(State(state): State<Arc<AppState>>, Json(req): Json<serde_json::Value>) -> impl IntoResponse {
    let chat_req: ChatRequest = match serde_json::from_value(req.clone()) {
        Ok(r) => r,
        Err(e) => return (axum::http::StatusCode::BAD_REQUEST, axum::Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    };

    let model_id = chat_req.model.clone().unwrap_or_else(|| "gpt-4o-mini".to_string());

    let (target_url, auth_key) = {
        let config = state.config.read().await;
        if !config.writing_api_url.is_empty() && !config.writing_api_key.is_empty() {
            let base = config.writing_api_url.trim_end_matches('/').to_string();
            (format!("{}/chat/completions", base), config.writing_api_key.clone())
        } else {
            // Fall back to MixHub auto-routing
            drop(config);
            return chat_completions(State(state), Json(chat_req)).await.into_response();
        }
    };

    let start_time = get_now_f64();
    
    // Diagnostic logging to inspect high token counts
    let _ = std::fs::write(
        "/Users/lvqian/.gemini/antigravity-ide/brain/7a2c155b-2215-4375-9d5a-e009b4c9c29f/scratch/request_payload.json",
        serde_json::to_string_pretty(&req).unwrap_or_default()
    );

    let res = state.http_client.post(&target_url)
        .header("Authorization", format!("Bearer {}", auth_key))
        .header("Content-Type", "application/json")
        .json(&req)
        .send()
        .await;

    match res {
        Err(e) => (
            axum::http::StatusCode::BAD_GATEWAY,
            axum::Json(serde_json::json!({"error": format!("转发失败: {}", e)}))
        ).into_response(),
        Ok(upstream) => {
            let status = upstream.status();
            if !status.is_success() {
                let err_text = upstream.text().await.unwrap_or_default();
                return (
                    axum::http::StatusCode::from_u16(status.as_u16()).unwrap_or(axum::http::StatusCode::BAD_GATEWAY),
                    axum::Json(serde_json::json!({"error": err_text}))
                ).into_response();
            }

            let (tx, rx) = tokio::sync::mpsc::channel(100);
            let state_clone = state.clone();
            let model_clone = model_id.clone();
            let messages_clone = chat_req.messages.clone();
            let bytes_stream = upstream.bytes_stream();

            tokio::spawn(async move {
                let mut full_content = String::new();
                let reader = tokio_util::io::StreamReader::new(bytes_stream.map(|item| {
                    item.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
                }));
                use tokio::io::AsyncBufReadExt;
                let mut lines = tokio::io::BufReader::new(reader).lines();

                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx.send(Ok::<_, std::io::Error>(format!("{}\n", line))).await;
                    if line.is_empty() { continue; }

                    if line.starts_with("data: ") {
                        let data_str = &line[6..];
                        if data_str == "[DONE]" {
                            break;
                        }
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data_str) {
                            if let Some(choices) = json.get("choices").and_then(|c| c.as_array()) {
                                if let Some(first) = choices.get(0) {
                                    if let Some(content) = first.get("delta").and_then(|d| d.get("content")).and_then(|c| c.as_str()) {
                                        full_content.push_str(content);
                                    }
                                }
                            }
                        }
                    } else if !line.starts_with(":") { // Not a comment line
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                            if let Some(choices) = json.get("choices").and_then(|c| c.as_array()) {
                                if let Some(first) = choices.get(0) {
                                    if let Some(content) = first.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_str()) {
                                        full_content = content.to_string();
                                    }
                                }
                            }
                        }
                    }
                }

                let latency = get_now_f64() - start_time;
                let p_tokens = (messages_clone.iter().map(|m| {
                    match &m.content {
                        serde_json::Value::String(s) => s.len(),
                        other => other.to_string().len(),
                    }
                }).sum::<usize>() as f64 * 0.8) as i64;
                let c_tokens = (full_content.len() as f64 * 0.8) as i64;
                update_usage(state_clone, model_clone, p_tokens, c_tokens, 0, None, full_content, latency).await;
            });

            Response::builder()
                .status(200)
                .header("content-type", "text/event-stream")
                .header("cache-control", "no-cache")
                .body(Body::from_stream(tokio_stream::wrappers::ReceiverStream::new(rx)))
                .unwrap().into_response()
        }
    }
}

async fn chat_completions(State(state): State<Arc<AppState>>, Json(req): Json<ChatRequest>) -> impl IntoResponse {
    let now = get_now_f64();
    let model_id = req.model.clone().unwrap_or_else(|| "gpt-4o-free".to_string());

    if let Some(sid) = &req.session_id {
        if let Some(last) = req.messages.last() {
            let db = state.db.lock();
            let content_str = match &last.content {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            let _ = db.execute("INSERT INTO chat_messages (session_id, role, content, model, timestamp) VALUES (?, ?, ?, ?, ?)", 
                params![sid, last.role, content_str, model_id, now]);
        }
    }

    let start_time = get_now_f64();
    let mut tried = std::collections::HashSet::new();
    let max_tries = 5;

    for i in 0..max_tries {
        let active_models_list = {
            let am = state.active_models.read().await;
            let mut m = am.clone();
            m.sort_by_key(|a| {
                if a == &model_id { 0 }
                else if a.contains("free") { 1 }
                else { 2 }
            });
            m
        };

        // 预检：如果没有配置任何 Key，直接报错
        {
            let config = state.config.read().await;
            if config.aihubmix_key.is_empty() && config.bailian_key.is_empty() && config.modelscope_key.is_empty() {
                return (
                    axum::http::StatusCode::BAD_REQUEST,
                    axum::Json(serde_json::json!({
                        "error": "请先在设置中配置 API Key (AIHubMix / 阿里百炼 / 魔搭)"
                    }))
                ).into_response();
            }
        }

        let target_id = match active_models_list.iter().find(|m| !tried.contains(*m)).cloned() {
            Some(t) => t,
            None => break,
        };
        tried.insert(target_id.clone());

        let config = state.config.read().await;
        let (url, key) = if !config.bailian_key.is_empty() && BAILIAN_MODELS.contains(&target_id.as_str()) {
            (BAILIAN_URL, &config.bailian_key)
        } else if !config.modelscope_key.is_empty() && active_models_list.iter().any(|m| m == &target_id) && !target_id.contains("free") && !MODEL_PRIORITY.contains(&target_id.as_str()) {
            (MODELSCOPE_URL, &config.modelscope_key)
        } else {
            (AIHUBMIX_URL, &config.aihubmix_key)
        };

        if key.is_empty() { continue; }

        info!(">>> Attempting {} via {} ({}/{})", target_id, url, i+1, max_tries);

        let mut payload = serde_json::to_value(&req).unwrap();
        if let Some(obj) = payload.as_object_mut() {
            obj.remove("session_id");
            obj.remove("provider");
            obj.insert("model".to_string(), serde_json::json!(target_id));
            if !obj.contains_key("stream") { obj.insert("stream".to_string(), serde_json::json!(true)); }
        }

        let res = state.http_client.post(format!("{}/chat/completions", url))
            .header("Authorization", format!("Bearer {}", key))
            .json(&payload).send().await;

        match res {
            Ok(response) => {
                let status = response.status();
                if !status.is_success() {
                    let err_text = response.text().await.unwrap_or_default();
                    error!("!!! {} failed ({}): {}", target_id, status, err_text);
                    continue;
                }

                let mut bytes_stream = response.bytes_stream();
                // Read the first chunk with a 10 second timeout to pre-validate
                let first_chunk = match tokio::time::timeout(std::time::Duration::from_secs(10), bytes_stream.next()).await {
                    Ok(Some(Ok(bytes))) => bytes,
                    Ok(Some(Err(e))) => {
                        error!("!!! Failed to read first chunk for {}: {}", target_id, e);
                        continue;
                    }
                    Ok(None) => {
                        error!("!!! Empty response body for {}", target_id);
                        continue;
                    }
                    Err(_) => {
                        error!("!!! Read first chunk timed out for {}", target_id);
                        continue;
                    }
                };

                let chunk_str = String::from_utf8_lossy(&first_chunk);
                if chunk_str.contains("prevent abuse of free resources") || chunk_str.contains("only try 10 times") || chunk_str.contains("increase the free quota") {
                    error!("!!! Detected AIHubMix free limit error in stream for {}: {}", target_id, chunk_str);
                    continue; // Failover to next model
                }

                let (tx, rx) = tokio::sync::mpsc::channel(100);
                let state_clone = state.clone();
                let model_clone = target_id.clone();
                let sid_clone = req.session_id.clone();
                let messages_clone = req.messages.clone();

                tokio::spawn(async move {
                    let mut full_content = String::new();
                    
                    // Reconstruct stream by prepending the first chunk
                    let first_chunk_stream = futures_util::stream::once(futures_util::future::ready(Ok::<_, std::io::Error>(first_chunk)));
                    let mapped_bytes_stream = bytes_stream.map(|item| {
                        item.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
                    });
                    let reconstructed_stream = first_chunk_stream.chain(mapped_bytes_stream);

                    let reader = tokio_util::io::StreamReader::new(reconstructed_stream);
                    use tokio::io::AsyncBufReadExt;
                    let mut lines = tokio::io::BufReader::new(reader).lines();

                    while let Ok(Some(line)) = lines.next_line().await {
                        if line.is_empty() { continue; }
                        if line.starts_with("data: ") {
                            let data_str = &line[6..];
                            if data_str == "[DONE]" {
                                let _ = tx.send(Ok::<_, std::io::Error>(format!("data: [DONE]\n\n"))).await;
                                break;
                            }
                            if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(data_str) {
                                // 改写模型名称
                                if let Some(obj) = json.as_object_mut() {
                                    obj.insert("model".to_string(), serde_json::json!(model_clone));
                                    if let Some(choices) = obj.get("choices").and_then(|c| c.as_array()) {
                                        if let Some(first) = choices.get(0) {
                                            if let Some(content) = first.get("delta").and_then(|d| d.get("content")).and_then(|c| c.as_str()) {
                                                full_content.push_str(content);
                                            }
                                        }
                                    }
                                }
                                let _ = tx.send(Ok::<_, std::io::Error>(format!("data: {}\n\n", json.to_string()))).await;
                            }
                        }
                    }
                    let latency = get_now_f64() - start_time;
                    let p_tokens = (messages_clone.iter().map(|m| {
                        match &m.content {
                            serde_json::Value::String(s) => s.len(),
                            other => other.to_string().len(),
                        }
                    }).sum::<usize>() as f64 * 0.8) as i64;
                    let c_tokens = (full_content.len() as f64 * 0.8) as i64;
                    update_usage(state_clone, model_clone, p_tokens, c_tokens, 0, sid_clone, full_content, latency).await;
                });

                return Response::builder()
                    .header("content-type", "text/event-stream")
                    .body(Body::from_stream(tokio_stream::wrappers::ReceiverStream::new(rx)))
                    .unwrap();
            }
            Err(e) => {
                error!("!!! Request failed for {}: {}", target_id, e);
                continue;
            }
        }
    }

    (
        axum::http::StatusCode::SERVICE_UNAVAILABLE,
        axum::Json(serde_json::json!({
            "error": "所有模型尝试均失败，请检查 API Key 是否有效、网络是否通畅或额度是否充足。"
        }))
    ).into_response()
}

async fn get_sessions(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let db = state.db.lock();
    let mut stmt = db.prepare("SELECT id, title, created_at FROM chat_sessions ORDER BY created_at DESC").unwrap();
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            "title": row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            "created_at": row.get::<_, Option<f64>>(2)?.unwrap_or(0.0)
        }))
    }).unwrap();
    Json(rows.filter_map(|r| r.ok()).collect::<Vec<_>>())
}

async fn create_session(State(state): State<Arc<AppState>>, Json(payload): Json<serde_json::Value>) -> impl IntoResponse {
    let db = state.db.lock();
    let _ = db.execute("INSERT INTO chat_sessions (id, title, created_at) VALUES (?, ?, ?)", 
        params![payload["id"].as_str(), payload["title"].as_str(), get_now_f64()]);
    Json(serde_json::json!({"status": "ok"}))
}

async fn delete_session(State(state): State<Arc<AppState>>, Path(sid): Path<String>) -> impl IntoResponse {
    let db = state.db.lock();
    let _ = db.execute("DELETE FROM chat_sessions WHERE id = ?", params![sid]);
    let _ = db.execute("DELETE FROM chat_messages WHERE session_id = ?", params![sid]);
    Json(serde_json::json!({"status": "ok"}))
}

async fn get_messages(State(state): State<Arc<AppState>>, Path(sid): Path<String>) -> impl IntoResponse {
    let db = state.db.lock();
    let mut stmt = db.prepare("SELECT role, content, model FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC").unwrap();
    let rows = stmt.query_map(params![sid], |row| {
        Ok(serde_json::json!({
            "role": row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            "content": row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            "model": row.get::<_, Option<String>>(2)?
        }))
    }).unwrap();
    Json(rows.filter_map(|r| r.ok()).collect::<Vec<_>>())
}

#[tauri::command]
async fn open_log_folder(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    if !log_dir.exists() {
        std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    }
    let _ = app.opener().open_path(log_dir.to_string_lossy(), None::<&str>);
    Ok(())
}

#[tauri::command]
async fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let _ = app.opener().open_path(path, None::<&str>);
    Ok(())
}

#[tauri::command]
async fn get_paths_info() -> Result<serde_json::Value, String> {
    let mut db_path = std::path::PathBuf::from("aihubmix_stats.db");
    let mut workspace_path = std::path::PathBuf::new();
    
    if let Ok(cwd) = std::env::current_dir() {
        if cwd.ends_with("src-tauri") || cwd.to_string_lossy().contains("aihub-router") {
            if cwd.ends_with("src-tauri") {
                workspace_path = cwd.parent().unwrap().to_path_buf();
                db_path = workspace_path.join("aihubmix_stats.db");
            } else {
                workspace_path = cwd.clone();
                db_path = cwd.join("aihubmix_stats.db");
            }
        } else {
            workspace_path = cwd;
            if let Ok(home) = std::env::var("HOME") {
                let app_dir = std::path::PathBuf::from(home).join(".mixhub-studio");
                db_path = app_dir.join("aihubmix_stats.db");
            }
        }
    }
    
    Ok(serde_json::json!({
        "db_path": db_path.to_string_lossy().to_string(),
        "workspace_path": workspace_path.to_string_lossy().to_string()
    }))
}

// --- Wiki 逻辑 (Axum 接口) ---

async fn get_wiki_axum(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let db = state.db.lock();
    let mut stmt = db.prepare("SELECT id, title, content, tags, links, category, updated_at FROM wiki_entries ORDER BY updated_at DESC").unwrap();
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            "title": row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            "content": row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            "tags": row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            "links": row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "[]".to_string()),
            "category": row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "General".to_string()),
            "updated_at": row.get::<_, Option<f64>>(6)?.unwrap_or(0.0)
        }))
    }).unwrap();
    Json(rows.filter_map(|r| r.ok()).collect::<Vec<_>>())
}

async fn save_wiki_axum(State(state): State<Arc<AppState>>, Json(payload): Json<serde_json::Value>) -> impl IntoResponse {
    let db = state.db.lock();
    let now = get_now_f64();
    let _ = db.execute(
        "INSERT OR REPLACE INTO wiki_entries (id, title, content, tags, links, category, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![
            payload["id"].as_str(),
            payload["title"].as_str(),
            payload["content"].as_str(),
            payload["tags"].as_str().unwrap_or(""),
            payload["links"].as_str().unwrap_or("[]"),
            payload["category"].as_str().unwrap_or("General"),
            now
        ],
    );
    Json(serde_json::json!({"status": "ok"}))
}

async fn delete_wiki_axum(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> impl IntoResponse {
    let db = state.db.lock();
    let _ = db.execute("DELETE FROM wiki_entries WHERE id = ?", params![id]);
    Json(serde_json::json!({"status": "ok"}))
}

// --- Wiki 逻辑 (Tauri 指令) ---

#[tauri::command]
async fn get_wiki(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let db = state.db.lock();
    let mut stmt = db.prepare("SELECT id, title, content, tags, links, category, updated_at, source_text FROM wiki_entries ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            "title": row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            "content": row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            "tags": row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            "links": row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "[]".to_string()),
            "category": row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "General".to_string()),
            "updated_at": row.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
            "source_text": row.get::<_, Option<String>>(7)?
        }))
    }).map_err(|e| e.to_string())?;
    let results: Vec<_> = rows.filter_map(|r| r.ok()).collect();
    Ok(serde_json::json!(results))
}

#[tauri::command]
async fn save_wiki(state: tauri::State<'_, Arc<AppState>>, payload: serde_json::Value) -> Result<serde_json::Value, String> {
    let db = state.db.lock();
    let now = get_now_f64();
    let _ = db.execute(
        "INSERT OR REPLACE INTO wiki_entries (id, title, content, tags, links, category, updated_at, source_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            payload["id"].as_str(),
            payload["title"].as_str(),
            payload["content"].as_str(),
            payload["tags"].as_str().unwrap_or(""),
            payload["links"].as_str().unwrap_or("[]"),
            payload["category"].as_str().unwrap_or("General"),
            now,
            payload["source_text"].as_str()
        ],
    ).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"status": "ok"}))
}

#[tauri::command]
async fn delete_wiki(state: tauri::State<'_, Arc<AppState>>, id: String) -> Result<serde_json::Value, String> {
    let db = state.db.lock();
    let _ = db.execute("DELETE FROM wiki_entries WHERE id = ?", params![id]).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"status": "ok"}))
}

#[tauri::command]
async fn get_raw_sources(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let db = state.db.lock();
    let mut stmt = db.prepare("SELECT id, name, path, content, source_type, created_at FROM raw_sources ORDER BY created_at DESC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            "name": row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            "path": row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            "content": row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            "source_type": row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            "created_at": row.get::<_, Option<f64>>(5)?.unwrap_or(0.0)
        }))
    }).map_err(|e| e.to_string())?;
    let results: Vec<_> = rows.filter_map(|r| r.ok()).collect();
    Ok(serde_json::json!(results))
}

#[tauri::command]
async fn list_knowledge_files(path: String) -> Result<Vec<serde_json::Value>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for entry in entries {
        if let Ok(entry) = entry {
            let path_buf = entry.path();
            if path_buf.is_file() {
                let name = path_buf.file_name().unwrap_or_default().to_string_lossy().to_string();
                let ext = path_buf.extension().unwrap_or_default().to_string_lossy().to_string().to_lowercase();
                if ["pdf", "txt", "md", "docx"].contains(&ext.as_str()) {
                    files.push(serde_json::json!({
                        "name": name,
                        "path": path_buf.to_string_lossy().to_string(),
                        "size": path_buf.metadata().map(|m| m.len()).unwrap_or(0),
                        "status": "pending"
                    }));
                }
            }
        }
    }
    Ok(files)
}

#[tauri::command]
async fn ingest_content(state: tauri::State<'_, Arc<AppState>>, path_or_url: String) -> Result<String, String> {
    let path = std::path::Path::new(&path_or_url);
    let ext = path.extension().unwrap_or_default().to_string_lossy().to_string().to_lowercase();
    
    let content = if path_or_url.starts_with("http") {
        let res = reqwest::get(&path_or_url).await.map_err(|e| e.to_string())?;
        res.text().await.map_err(|e| e.to_string())?
    } else if ext == "pdf" {
        pdf_extract::extract_text(&path_or_url).map_err(|e| format!("PDF extraction failed: {}", e))?
    } else {
        std::fs::read_to_string(&path_or_url).map_err(|e| format!("File read failed: {}", e))?
    };

    let db = state.db.lock();
    let now = get_now_f64();
    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    
    let _ = db.execute(
        "INSERT OR REPLACE INTO raw_sources (id, name, path, content, source_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        params![
            uuid::Uuid::new_v4().to_string(),
            name,
            path_or_url,
            content,
            "text",
            now
        ],
    ).map_err(|e| e.to_string())?;

    Ok(content)
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct WikiEntry {
    title: String,
    content: String,
    category: String,
    tags: String,
    #[serde(default)]
    source_text: String,
}

#[tauri::command]
async fn compile_wiki(
    state: tauri::State<'_, Arc<AppState>>,
    raw_text: String
) -> Result<Vec<WikiEntry>, String> {
    let config = state.config.read().await;
    let api_key = &config.aihubmix_key;
    
    if api_key.is_empty() {
        return Err("AIHubMix API Key not configured. Please set it in Settings.".to_string());
    }

    let system_prompt = "You are a professional knowledge engineer. Your task is to extract structured knowledge entries from the provided raw text.
Output MUST be a valid JSON array of objects with the following structure:
[
  {
    \"title\": \"Clear and concise title\",
    \"content\": \"Markdown formatted content explaining the concept deeply\",
    \"category\": \"One of: Architecture, Logic, Implementation, Concept, or General\",
    \"tags\": \"comma,separated,keywords\"
  }
]
Distill the most important technical insights and architectural patterns.";

    let models_to_try: Vec<String> = if !config.reasoning_model.is_empty() {
        config.reasoning_model.split(',').map(|s| s.trim().to_string()).collect()
    } else {
        vec!["gpt-4o-mini".to_string(), "gpt-4o-free".to_string()]
    };

    let mut last_error = String::new();

    for model in models_to_try {
        let (url, api_key) = if !config.bailian_key.is_empty() && BAILIAN_MODELS.contains(&model.as_str()) {
            (BAILIAN_URL, &config.bailian_key)
        } else if !config.modelscope_key.is_empty() && model.contains('/') && !model.contains("free") && !MODEL_PRIORITY.contains(&model.as_str()) {
            (MODELSCOPE_URL, &config.modelscope_key)
        } else {
            (AIHUBMIX_URL, &config.aihubmix_key)
        };

        if api_key.is_empty() {
            warn!("Skipping model {} because its provider key is not configured.", model);
            continue;
        }

        info!("--- Attempting extraction with model: {} via {} ---", model, url);
        let mut retry_per_model = 0;
        while retry_per_model < 2 {
            let payload = serde_json::json!({
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": format!("Extract knowledge from this text:\n\n{}", raw_text)}
                ],
                "response_format": { "type": "json_object" }
            });

            let response = state.http_client
                .post(format!("{}/chat/completions", url))
                .header("Authorization", format!("Bearer {}", api_key))
                .json(&payload)
                .send()
                .await;

        match response {
            Ok(resp) => {
                let status = resp.status();
                let res_json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
                
                if status.is_success() {
                    let mut content = res_json["choices"][0]["message"]["content"]
                        .as_str()
                        .ok_or_else(|| format!("Invalid AI response: {}", res_json))?
                        .trim()
                        .to_string();

                    // 1. 处理 Markdown 代码块包裹
                    if content.starts_with("```") {
                        if let Some(start) = content.find('[') {
                            if let Some(end) = content.rfind(']') {
                                content = content[start..=end].to_string();
                            }
                        } else if let Some(start) = content.find('{') {
                             if let Some(end) = content.rfind('}') {
                                content = content[start..=end].to_string();
                            }
                        }
                    }
                    
                    // 2. 尝试修复截断的 JSON (处理末尾多余的冒号或缺失的括号)
                    if !content.ends_with('}') && !content.ends_with(']') {
                        if let Some(last_brace) = content.rfind('}') {
                            content = content[..=last_brace].to_string();
                        } else if let Some(last_bracket) = content.rfind(']') {
                            content = content[..=last_bracket].to_string();
                        }
                    }

                    let entries: Vec<WikiEntry> = if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                        let raw_array = if let Some(arr) = v.as_array() {
                            Some(arr.clone())
                        } else if let Some(arr) = v["entries"].as_array() {
                            Some(arr.clone())
                        } else if let Some(arr) = v["wiki_entries"].as_array() {
                            Some(arr.clone())
                        } else if let Some(arr) = v["knowledge"].as_array() {
                            Some(arr.clone())
                        } else if let Some(arr) = v["json"].as_array() {
                            Some(arr.clone())
                        } else if let Some(arr) = v["knowledge_entries"].as_array() {
                            Some(arr.clone())
                        } else if let Some(arr) = v["data"].as_array() {
                            Some(arr.clone())
                        } else if let Some(arr) = v["results"].as_array() {
                            Some(arr.clone())
                        } else {
                            None
                        };

                        if let Some(arr) = raw_array {
                            // 鲁棒处理：过滤掉非对象元素
                            let filtered_nodes: Vec<WikiEntry> = arr.into_iter().filter_map(|item| {
                                if item.is_object() {
                                    serde_json::from_value::<WikiEntry>(item).ok()
                                } else if item.is_string() {
                                    // 如果是字符串，尝试构造一个极简条目
                                    Some(WikiEntry {
                                        title: item.as_str().unwrap().to_string(),
                                        content: "AI returned only a title for this entry.".to_string(),
                                        category: "General".to_string(),
                                        tags: "".to_string(),
                                        source_text: "".to_string(),
                                    })
                                } else {
                                    None
                                }
                            }).collect();
                            
                            if filtered_nodes.is_empty() {
                                last_error = format!("Model [{}] returned an array but it contained no valid entries. Response: {}", model, content);
                                warn!("{}", last_error);
                                retry_per_model += 1;
                                continue;
                            }
                            filtered_nodes
                        } else {
                            // 最后的尝试：单体对象
                            if let Ok(single_entry) = serde_json::from_value::<WikiEntry>(v.clone()) {
                                vec![single_entry]
                            } else {
                                last_error = format!("Model [{}] response format is unrecognized or invalid JSON. Response: {}", model, content);
                                warn!("{}", last_error);
                                retry_per_model += 1;
                                continue;
                            }
                        }
                    } else {
                        last_error = format!("Model [{}] failed to parse AI content as JSON. Content: {}", model, content);
                        warn!("{}", last_error);
                        retry_per_model += 1;
                        continue;
                    };
                    return Ok(entries);
                } else {
                    let err_str = res_json.to_string();
                    let preview = if err_str.len() > 200 {
                        format!("{}...", &err_str[..200])
                    } else {
                        err_str
                    };
                    last_error = format!("Model [{}] request failed (status: {}). Response: {}", model, status, preview);
                    warn!("{}", last_error);
                    retry_per_model += 1;
                    continue;
                }
            },
            Err(e) => {
                last_error = format!("Network error with model [{}]: {}", model, e);
                warn!("{}", last_error);
                retry_per_model += 1;
                continue;
            }
        }
    }
}
Err(format!("All selected models failed. Last error: {}", last_error))
}

#[derive(serde::Serialize)]
struct GraphNode {
    id: String,
    title: String,
    category: String,
}

#[derive(serde::Serialize)]
struct GraphLink {
    source: String,
    target: String,
}

#[derive(serde::Serialize)]
struct GraphData {
    nodes: Vec<GraphNode>,
    links: Vec<GraphLink>,
}

#[tauri::command]
async fn get_knowledge_graph() -> Result<GraphData, String> {
    let db = init_db();
    let mut stmt = db.prepare("SELECT id, title, category, links FROM wiki_entries").map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?.unwrap_or_default()
        ))
    }).map_err(|e| e.to_string())?;

    let mut nodes = Vec::new();
    let mut raw_links = Vec::new();
    let mut node_ids = std::collections::HashSet::new();

    for r in rows {
        let (id, title, category, links_str) = r.map_err(|e| e.to_string())?;
        node_ids.insert(id.clone());
        nodes.push(GraphNode { id: id.clone(), title, category });
        
        for target in links_str.split(',').filter(|s| !s.is_empty()) {
            raw_links.push((id.clone(), target.trim().to_string()));
        }
    }

    // 只保留目标存在的连线，防止 D3 报错
    let mut links = Vec::new();
    for (source, target) in raw_links {
        if node_ids.contains(&target) {
            links.push(GraphLink { source, target });
        }
    }

    let graph_data = GraphData { nodes, links };
    info!("Graph Data: {} nodes, {} links", graph_data.nodes.len(), graph_data.links.len());
    Ok(graph_data)
}

#[derive(serde::Serialize, serde::Deserialize)]
struct KnowledgeIssue {
    id: String,
    issue_type: String, // "contradiction", "duplicate", "outdated", "gap"
    severity: String,   // "high", "medium", "low"
    title: String,
    description: String,
    related_ids: Vec<String>,
}

#[tauri::command]
async fn run_knowledge_audit(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<KnowledgeIssue>, String> {
    info!("Running AI Knowledge Audit...");
    
    // 获取所有条目用于分析 (实际项目中可以分批或按关联分析)
    let entries = {
        let db = init_db();
        let mut stmt = db.prepare("SELECT id, title, content FROM wiki_entries").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "title": r.get::<_, String>(1)?,
                "content": r.get::<_, String>(2)?
            }))
        }).map_err(|e| e.to_string())?;
        
        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| e.to_string())?);
        }
        list
    };

    if entries.is_empty() {
        return Ok(vec![]);
    }

    // 调用 AI 进行审计 (这里使用 prompt 让 AI 找矛盾)
    let prompt = format!(
        "As a Knowledge Auditor, analyze the following Wiki entries for logical contradictions, factual conflicts, or content duplicates. 
        Return a JSON array of issues with fields: id (random), issue_type (contradiction|duplicate|gap), severity (high|medium|low), title, description, related_ids.
        
        Entries:
        {}",
        serde_json::to_string(&entries).unwrap()
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build().map_err(|e| e.to_string())?;
    
    let config = state.config.read().await;
    let url = format!("{}/chat/completions", AIHUBMIX_URL);
    
    let payload = serde_json::json!({
        "model": "gpt-4o-mini", // 使用轻量模型进行快速审计
        "messages": [
            {"role": "system", "content": "You are a professional Knowledge Graph Auditor. You output strictly valid JSON."},
            {"role": "user", "content": prompt}
        ],
        "response_format": { "type": "json_object" }
    });

    let res = client.post(&url)
        .header("Authorization", format!("Bearer {}", config.aihubmix_key))
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let content = body["choices"][0]["message"]["content"].as_str().ok_or("AI failed to respond")?;
    
    // 解析 AI 返回的 JSON
    let audit_res: serde_json::Value = serde_json::from_str(content).map_err(|e| e.to_string())?;
    let issues: Vec<KnowledgeIssue> = if let Some(arr) = audit_res["issues"].as_array() {
        serde_json::from_value(serde_json::Value::Array(arr.clone())).map_err(|e| e.to_string())?
    } else {
        vec![]
    };

    Ok(issues)
}

#[tauri::command]
async fn analyze_wiki_health() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "duplicates": [],
        "gaps": ["AI Agents Architecture", "Vector Databases Comparison"]
    }))
}

#[tauri::command]
async fn evolve_wiki_topic(topic: String) -> Result<serde_json::Value, String> {
    info!("Evolving topic: {}", topic);
    Ok(serde_json::json!({"status": "ok"}))
}

#[derive(serde::Deserialize, Clone)]
struct WechatFilePart {
    field: String,
    name: String,
    data: Vec<u8>,
    mime: String,
}

#[tauri::command]
async fn wechat_http_request(
    state: tauri::State<'_, Arc<AppState>>,
    url: String,
    method: String,
    headers: std::collections::HashMap<String, String>,
    body: String,
    is_multipart: bool,
    files: Vec<WechatFilePart>,
) -> Result<serde_json::Value, String> {
    use reqwest::header::{HeaderName, HeaderValue};
    
    let mut last_err = String::new();
    
    for attempt in 0..3 {
        let client = if attempt == 0 {
            None
        } else {
            let c = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(180))
                .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                .http1_only()
                .pool_max_idle_per_host(0)
                .pool_idle_timeout(std::time::Duration::from_secs(0))
                .build();
            match c {
                Ok(client_built) => Some(client_built),
                Err(e) => {
                    last_err = format!("Failed to build fallback client: {}", e);
                    continue;
                }
            }
        };
        
        let active_client = match &client {
            Some(c) => c,
            None => &state.http_client,
        };
        
        let method_parsed = match method.to_uppercase().as_str() {
            "POST" => reqwest::Method::POST,
            "GET" => reqwest::Method::GET,
            _ => reqwest::Method::GET,
        };
        
        let mut req = active_client.request(method_parsed, &url);
        
        for (k, v) in &headers {
            if let Ok(hn) = HeaderName::from_bytes(k.as_bytes()) {
                if let Ok(hv) = HeaderValue::from_str(v) {
                    req = req.header(hn, hv);
                }
            }
        }
        
        if is_multipart {
            let mut form = reqwest::multipart::Form::new();
            if !body.is_empty() {
                if let Ok(json_body) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(fields) = json_body["fields"].as_array() {
                        for field in fields {
                            if let (Some(k), Some(v)) = (field["key"].as_str(), field["value"].as_str()) {
                                form = form.text(k.to_string(), v.to_string());
                            }
                        }
                    }
                }
            }
            
            let mut multipart_ok = true;
            for file in &files {
                let part = match reqwest::multipart::Part::bytes(file.data.clone())
                    .file_name(file.name.clone())
                    .mime_str(&file.mime) {
                        Ok(p) => p,
                        Err(e) => {
                            last_err = format!("Failed to create multipart part: {}", e);
                            multipart_ok = false;
                            break;
                        }
                    };
                form = form.part(file.field.clone(), part);
            }
            if !multipart_ok {
                continue;
            }
            req = req.multipart(form);
        } else if !body.is_empty() {
            req = req.body(body.clone());
        }
        
        match req.send().await {
            Ok(res) => {
                let status = res.status().as_u16();
                match res.text().await {
                    Ok(text) => {
                        return Ok(serde_json::json!({
                            "status": status,
                            "text": text
                        }));
                    }
                    Err(e) => {
                        last_err = format!("Failed to read response body: {}", e);
                    }
                }
            }
            Err(e) => {
                last_err = format!("Request failed (attempt {}): {}", attempt + 1, e);
                log::warn!("wechat_http_request attempt {} failed: {}", attempt + 1, e);
                if attempt < 2 {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }
            }
        }
    }
    
    Err(format!("WeChat request failed after 3 attempts. Last error: {}", last_err))
}


#[tauri::command]
async fn get_folders(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let db = state.db.lock();
    sync_database_with_disk(&db)?;
    
    let mut stmt = db.prepare("SELECT id, name, parent_id FROM wechat_folders").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            "name": row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            "parent_id": row.get::<_, Option<String>>(2)?
        }))
    }).map_err(|e| e.to_string())?;
    let results: Vec<_> = rows.filter_map(|r| r.ok()).collect();
    Ok(serde_json::json!(results))
}

#[tauri::command]
async fn save_folder(state: tauri::State<'_, Arc<AppState>>, payload: serde_json::Value) -> Result<serde_json::Value, String> {
    let db = state.db.lock();
    let sync_dir = get_sync_dir();

    let old_id = payload["id"].as_str().unwrap_or("").replace("\\", "/");
    let name = payload["name"].as_str().unwrap_or("Untitled Folder");
    let parent_id = payload["parent_id"].as_str().filter(|s| !s.is_empty()).map(|s| s.replace("\\", "/"));

    let sanitized_name = sanitize_filename(name);
    let new_id = match &parent_id {
        Some(pid) => format!("{}/{}", pid, sanitized_name),
        None => sanitized_name,
    };

    let old_path = sync_dir.join(&old_id);
    let new_path = sync_dir.join(&new_id);

    if !old_id.is_empty() && old_path.exists() && old_path.is_dir() {
        if old_path != new_path {
            if let Some(parent) = new_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory {:?}: {}", parent, e))?;
            }
            std::fs::rename(&old_path, &new_path)
                .map_err(|e| format!("Failed to rename folder from {:?} to {:?}: {}", old_path, new_path, e))?;
        }
    } else {
        std::fs::create_dir_all(&new_path)
            .map_err(|e| format!("Failed to create folder {:?}: {}", new_path, e))?;
    }

    sync_database_with_disk(&db)?;

    Ok(serde_json::json!({
        "status": "ok",
        "id": new_id
    }))
}

#[tauri::command]
async fn delete_folder(state: tauri::State<'_, Arc<AppState>>, id: String) -> Result<serde_json::Value, String> {
    let db = state.db.lock();
    let sync_dir = get_sync_dir();
    let path = sync_dir.join(&id);
    if path.exists() && path.is_dir() {
        std::fs::remove_dir_all(&path)
            .map_err(|e| format!("Failed to delete folder directory: {}", e))?;
    }
    sync_database_with_disk(&db)?;
    Ok(serde_json::json!({"status": "ok"}))
}

#[tauri::command]
async fn get_articles(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let db = state.db.lock();
    sync_database_with_disk(&db)?;

    let mut stmt = db.prepare("SELECT id, title, content, theme, updated_at, folder_id FROM wechat_articles ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            "title": row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            "content": row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            "theme": row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            "updated_at": row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
            "folder_id": row.get::<_, Option<String>>(5)?
        }))
    }).map_err(|e| e.to_string())?;
    let results: Vec<_> = rows.filter_map(|r| r.ok()).collect();
    Ok(serde_json::json!(results))
}

#[tauri::command]
async fn save_article(state: tauri::State<'_, Arc<AppState>>, payload: serde_json::Value) -> Result<serde_json::Value, String> {
    let db = state.db.lock();
    let sync_dir = get_sync_dir();
    
    let old_id = payload["id"].as_str().unwrap_or("").replace("\\", "/");
    let title = payload["title"].as_str().unwrap_or("Untitled");
    let content = payload["content"].as_str().unwrap_or("");
    let theme = payload["theme"].as_str().unwrap_or("default");
    let folder_id = payload["folder_id"].as_str().filter(|s| !s.is_empty()).map(|s| s.replace("\\", "/"));

    let sanitized_title = sanitize_filename(title);
    
    let new_id = if theme == "image" {
        let filename = title.to_string();
        match &folder_id {
            Some(fid) => format!("{}/{}", fid, filename),
            None => filename,
        }
    } else {
        let filename = format!("{}.md", sanitized_title);
        match &folder_id {
            Some(fid) => format!("{}/{}", fid, filename),
            None => filename,
        }
    };

    let new_path = sync_dir.join(&new_id);

    if let Some(fid) = &folder_id {
        let folder_path = sync_dir.join(fid);
        if !folder_path.exists() {
            std::fs::create_dir_all(&folder_path)
                .map_err(|e| format!("Failed to create folder {:?}: {}", folder_path, e))?;
        }
    }

    if theme == "image" {
        if !old_id.is_empty() && old_id != new_id {
            let old_path = sync_dir.join(&old_id);
            if old_path.exists() && old_path.is_file() {
                std::fs::rename(&old_path, &new_path)
                    .map_err(|e| format!("Failed to rename/move image file: {}", e))?;
            }
        }
    } else {
        let file_content = write_markdown_file(content, theme, title);
        std::fs::write(&new_path, file_content)
            .map_err(|e| format!("Failed to write file {:?}: {}", new_path, e))?;

        if !old_id.is_empty() && old_id != new_id {
            let old_path = sync_dir.join(&old_id);
            if old_path.exists() && old_path.is_file() {
                let _ = std::fs::remove_file(&old_path);
            }
        }
    }

    sync_database_with_disk(&db)?;

    Ok(serde_json::json!({
        "status": "ok",
        "id": new_id
    }))
}

#[tauri::command]
async fn delete_article(state: tauri::State<'_, Arc<AppState>>, id: String) -> Result<serde_json::Value, String> {
    let db = state.db.lock();
    let sync_dir = get_sync_dir();
    let path = sync_dir.join(&id);
    if path.exists() && path.is_file() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete article file: {}", e))?;
    }
    sync_database_with_disk(&db)?;
    Ok(serde_json::json!({"status": "ok"}))
}

#[tauri::command]
async fn get_wechat_analytics(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let db = state.db.lock();
    let mut stmt = db.prepare("SELECT id, msgid, title, publish_time, url, read_num, like_num, share_num, favor_num, updated_at FROM wechat_article_analytics ORDER BY publish_time DESC")
        .map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            "msgid": row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            "title": row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            "publish_time": row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            "url": row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            "read_num": row.get::<_, Option<i64>>(5)?.unwrap_or(0),
            "like_num": row.get::<_, Option<i64>>(6)?.unwrap_or(0),
            "share_num": row.get::<_, Option<i64>>(7)?.unwrap_or(0),
            "favor_num": row.get::<_, Option<i64>>(8)?.unwrap_or(0),
            "updated_at": row.get::<_, Option<f64>>(9)?.unwrap_or(0.0)
        }))
    }).map_err(|e| e.to_string())?;

    let results: Vec<_> = rows.filter_map(|r| r.ok()).collect();
    Ok(serde_json::json!(results))
}

#[tauri::command]
async fn save_wechat_analytics(state: tauri::State<'_, Arc<AppState>>, articles: Vec<serde_json::Value>) -> Result<serde_json::Value, String> {
    let mut db = state.db.lock();
    let now = get_now_f64();
    let tx = db.transaction().map_err(|e| e.to_string())?;

    {
        let mut stmt = tx.prepare("
            INSERT OR REPLACE INTO wechat_article_analytics 
            (id, msgid, title, publish_time, url, read_num, like_num, share_num, favor_num, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ").map_err(|e| e.to_string())?;

        for art in articles {
            let id = art["id"].as_str().or_else(|| art["article_id"].as_str()).unwrap_or_default();
            if id.is_empty() {
                continue;
            }
            let msgid = art["msgid"].as_str().unwrap_or_default();
            let title = art["title"].as_str().unwrap_or_default();
            let publish_time = art["publish_time"].as_str().unwrap_or_default();
            let url = art["url"].as_str().unwrap_or_default();
            let read_num = art["read_num"].as_i64().or_else(|| art["read_count"].as_i64()).unwrap_or(0);
            let like_num = art["like_num"].as_i64().or_else(|| art["like_count"].as_i64()).unwrap_or(0);
            let share_num = art["share_num"].as_i64().or_else(|| art["share_count"].as_i64()).unwrap_or(0);
            let favor_num = art["favor_num"].as_i64().or_else(|| art["favor_count"].as_i64()).unwrap_or(0);

            stmt.execute(rusqlite::params![
                id, msgid, title, publish_time, url, read_num, like_num, share_num, favor_num, now
            ]).map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"status": "ok"}))
}

#[tauri::command]
async fn download_remote_file(
    state: tauri::State<'_, Arc<AppState>>,
    url: String,
) -> Result<Vec<u8>, String> {
    let mut last_err = String::new();
    
    for attempt in 0..3 {
        let client = if attempt == 0 {
            None
        } else {
            let c = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                .http1_only()
                .pool_max_idle_per_host(0)
                .pool_idle_timeout(std::time::Duration::from_secs(0))
                .build();
            match c {
                Ok(client_built) => Some(client_built),
                Err(e) => {
                    last_err = format!("Failed to build fallback client: {}", e);
                    continue;
                }
            }
        };
        
        let active_client = match &client {
            Some(c) => c,
            None => &state.http_client,
        };
        
        match active_client.get(&url).header("Accept", "*/*").send().await {
            Ok(res) => {
                match res.bytes().await {
                    Ok(bytes) => return Ok(bytes.to_vec()),
                    Err(e) => {
                        last_err = format!("Failed to read remote file bytes: {}", e);
                    }
                }
            }
            Err(e) => {
                last_err = format!("Download failed (attempt {}): {}", attempt + 1, e);
                log::warn!("download_remote_file attempt {} failed: {}", attempt + 1, e);
                if attempt < 2 {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }
            }
        }
    }
    
    Err(format!("Download failed after 3 attempts. Last error: {}", last_err))
}

#[tauri::command]
async fn read_local_file(
    path: String,
) -> Result<Vec<u8>, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(bytes)
}

#[tauri::command]
async fn save_temp_image(bytes: Vec<u8>) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64();
    let filename = format!("oneink_paste_{}.png", now as u64);
    let path = temp_dir.join(filename);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn get_image_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "png" => "image/png",
        _ => "image/png",
    };
    
    // Custom base64 encoder
    const CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        match chunk.len() {
            3 => {
                let n = ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8) | (chunk[2] as u32);
                result.push(CHARS[((n >> 18) & 63) as usize] as char);
                result.push(CHARS[((n >> 12) & 63) as usize] as char);
                result.push(CHARS[((n >> 6) & 63) as usize] as char);
                result.push(CHARS[(n & 63) as usize] as char);
            }
            2 => {
                let n = ((chunk[0] as u32) << 8) | (chunk[1] as u32);
                result.push(CHARS[((n >> 10) & 63) as usize] as char);
                result.push(CHARS[((n >> 4) & 63) as usize] as char);
                result.push(CHARS[((n << 2) & 63) as usize] as char);
                result.push('=');
            }
            1 => {
                let n = chunk[0] as u32;
                result.push(CHARS[((n >> 2) & 63) as usize] as char);
                result.push(CHARS[((n << 4) & 63) as usize] as char);
                result.push('=');
                result.push('=');
            }
            _ => unreachable!(),
        }
    }
    
    Ok(format!("data:{};base64,{}", mime, result))
}

#[tauri::command]
fn copy_html_to_clipboard(html: String, plain: String) -> Result<(), String> {
    // Debug: write the HTML to a file in the workspace to inspect it
    let _ = std::fs::write("/Users/lvqian/workspace/OneInk/copied_output.html", &html);
    #[cfg(target_os = "macos")]
    {
        use std::fs;
        use std::io::Write;
        use std::process::{Command, Stdio};
        
        let hex_html: String = html.bytes().map(|b| format!("{:02x}", b)).collect();
        
        // Write the plain text to a temp file to avoid escaping and syntax errors in AppleScript
        let temp_dir = std::env::temp_dir();
        let plain_file_path = temp_dir.join(format!("oneink_copy_plain_{}.txt", uuid::Uuid::new_v4()));
        fs::write(&plain_file_path, plain).map_err(|e| format!("Failed to write plain text to temp file: {}", e))?;
        
        let script = format!(
            "set thePlain to read (POSIX file \"{}\") as «class utf8»\n\
             set the clipboard to {{text:thePlain, «class HTML»:«data HTML{}»}}",
            plain_file_path.to_string_lossy(),
            hex_html
        );
        
        let mut child = Command::new("osascript")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                let _ = fs::remove_file(&plain_file_path);
                format!("Failed to spawn osascript: {}", e)
            })?;
            
        if let Some(mut stdin) = child.stdin.take() {
            if let Err(e) = stdin.write_all(script.as_bytes()) {
                let _ = fs::remove_file(&plain_file_path);
                return Err(format!("Failed to write to stdin: {}", e));
            }
        }
        
        let output = child.wait_with_output().map_err(|e| {
            let _ = fs::remove_file(&plain_file_path);
            format!("Failed to wait for osascript: {}", e)
        })?;
        
        // Clean up the temp file
        let _ = fs::remove_file(&plain_file_path);
        
        if !output.status.success() {
            let err_msg = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(format!("osascript failed: {}", err_msg));
        }
        
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Unsupported operating system for native HTML copy".to_string())
    }
}

use tauri::Emitter;
use tokio::io::AsyncBufReadExt;
use std::process::Stdio;

#[tauri::command]
async fn run_pi_agent(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    session_id: String,
    prompt: String,
    content: String,
    image_paths: Vec<String>,
) -> Result<serde_json::Value, String> {
    // 1. 写入临时文件作为桥梁
    let temp_dir = std::env::temp_dir();
    let temp_file_path = temp_dir.join("oneink_article.md");
    std::fs::write(&temp_file_path, &content).map_err(|e| format!("写入临时文件失败: {}", e))?;

    // 2. 定位 Pi 的 CLI 脚本与工作目录
    let mut pi_script_path = std::path::PathBuf::from("node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    let mut workspace_root = std::path::PathBuf::new();
    if let Ok(cwd) = std::env::current_dir() {
        if cwd.ends_with("src-tauri") {
            workspace_root = cwd.parent().unwrap().to_path_buf();
            pi_script_path = workspace_root.join("node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
        } else {
            workspace_root = cwd;
        }
    }
    let sync_dir = get_sync_dir();
    let session_dir = workspace_root.join(".oneink_ai_sessions");
    let _ = std::fs::create_dir_all(&session_dir);

    // 3. 读取全局配置并准备动态 models.json
    let config = state.config.read().await;
    let mut model_to_use = config.writing_api_model.clone();
    if model_to_use.is_empty() || model_to_use == "any" {
        model_to_use = "gpt-4o-mini".to_string();
    }

    let api_url = "http://127.0.0.1:8001/api/writing-proxy".to_string();
    let api_key = "local-proxy-token".to_string();
    let api_type = "openai-completions";

    // 在临时目录下创建专属配置目录，防止内置模型提供商的凭证冲突
    let pi_config_dir = temp_dir.join("oneink_pi_config");
    let _ = std::fs::create_dir_all(&pi_config_dir);

    // 动态生成 models.json
    let has_reasoning = model_to_use.contains("plus") || model_to_use.contains("pro") || model_to_use.contains("reasoning") || model_to_use.contains("r1") || model_to_use.contains("thinking");
    let models_json = serde_json::json!({
        "providers": {
            "custom-provider": {
                "baseUrl": api_url,
                "apiKey": api_key,
                "api": api_type,
                "compat": {
                    "supportsDeveloperRole": false,
                    "supportsReasoningEffort": false
                },
                "models": [
                    {
                        "id": model_to_use,
                        "name": model_to_use,
                        "contextWindow": 200000,
                        "maxTokens": 16384,
                        "reasoning": has_reasoning
                    }
                ]
            }
        }
    });

    let _ = std::fs::write(
        pi_config_dir.join("models.json"),
        serde_json::to_string_pretty(&models_json).unwrap_or_default()
    );
    let _ = std::fs::write(pi_config_dir.join("auth.json"), "{}");

    // 4. 构建命令行参数
    // 将模型重定向到我们自定义的提供商 custom-provider/<model_name>
    let extension_path = workspace_root.join("src-tauri/src/extensions/web_fetch.ts");
    let mut args = vec![
        pi_script_path.to_string_lossy().to_string(),
        format!("@{}", temp_file_path.to_string_lossy()),
    ];

    for img_path in &image_paths {
        args.push(format!("@{}", img_path));
    }

    args.extend(vec![
        "-p".to_string(),
        prompt,
        "--tools".to_string(),
        "read,edit,write,bash,fetch_webpage,web_search".to_string(),
        "--session-id".to_string(),
        session_id,
        "--session-dir".to_string(),
        session_dir.to_string_lossy().to_string(),
        "--model".to_string(),
        format!("custom-provider/{}", model_to_use),
        "--approve".to_string(),
        "--no-context-files".to_string(),
        "--no-extensions".to_string(),
        "--no-skills".to_string(),
        "--no-prompt-templates".to_string(),
        "--no-themes".to_string(),
        "--append-system-prompt".to_string(),
        format!(
            "你是一个极其聪明的微信公众号内容编辑、排版与写作助手。当前用户正在编辑的文章已作为上下文读入，且位于临时文件：`{}`。
            请遵守以下准则开展工作：
            1. **工作空间与目录**：你的当前工作目录是文章存储目录：`{}`。如果你需要新建文章（生成新文档），请直接使用 write 工具写入本工作目录下（例如：`新文章.md` 或 `某分类/新文章.md`）。
            2. **文档翻译与生成**：在翻译或扩写文档（例如：把当前文章翻译为英文，或将当前英文文章翻译为中文）时，你**绝对不要**修改或替换当前的临时文件 `{}`（这会覆盖用户的原始文档），而**必须**将翻译/生成后的完整内容作为一个**全新的文档**使用 `write` 工具写入到当前工作目录下，文件名格式通常为 `原文章名_翻译.md`、`原文章名_en.md` 或新命名的中文/英文文件名。只有在用户明确指令要求你'直接替换/修改当前文章'时，你才可以修改临时文件。
            3. **编辑与修改（仅限润色、修正与局部修改）**：只有当用户的指令是对当前已打开的文章进行常规的润色、纠错、扩写、续写、插图、局部内容修改或结构微调时，你才应该通过 write 或 edit 工具直接修改该临时文件 `{}`。请优先使用 edit 工具进行精准的局部修改（例如仅插入少量图片链接、润色局部段落等）。但如果修改量巨大（如修改篇幅超过 30%），请直接使用 write 工具重新写入完整 file，这比多次局部 edit 更加高效且不易出错。
            4. **文档完整性**：无论在翻译、新建还是修改文档时，都必须输出**完整、无截断的内容**到文件中，禁止使用 '... (以下省略)' 或 '... (代码部分同上)' 等省略 and 占位方式，所有字句和完整代码块都必须完全展开，确保该文件随时可以直接发布。
            5. **网络调研与补充**：当用户要求你做网络调研、或者指出内容/图片缺失时，你应当主动使用 web_search 进行检索，并使用 fetch_webpage 工具去抓取高价值源网页的内容，比对提取后直接修改该临时文件以补全所需信息及真实图片链接。此外，如果你需要下载文件、图片或执行其它终端操作，可以使用 bash 工具执行命令（如 curl、wget）进行处理。
            6. **格式与样式**：修改时请保留原本的微信排版风格与漂亮的 Markdown 格式样式。
            7. 完成修改后，请在回复中简要列出你具体做了哪些改动，字数控制在 200 字以内。",
            temp_file_path.to_string_lossy(),
            sync_dir.to_string_lossy(),
            temp_file_path.to_string_lossy(),
            temp_file_path.to_string_lossy()
        ),
        "--mode".to_string(),
        "json".to_string(),
    ]);

    if extension_path.exists() {
        args.push("--extension".to_string());
        args.push(extension_path.to_string_lossy().to_string());
    }

    // 记录运行前的 markdown 文件列表
    let mut before_files = std::collections::HashSet::new();

    // 1. 扫描 workspace_root (非递归)
    if !workspace_root.as_os_str().is_empty() {
        if let Ok(entries) = std::fs::read_dir(&workspace_root) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        let path = entry.path();
                        if path.extension().map_or(false, |ext| ext == "md") {
                            before_files.insert(path);
                        }
                    }
                }
            }
        }
    }

    // 2. 递归扫描 sync_dir (即：公众号文章/)
    fn collect_sync_md_files(dir: &std::path::Path, before_files: &mut std::collections::HashSet<std::path::PathBuf>) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    let path = entry.path();
                    if file_type.is_dir() {
                        collect_sync_md_files(&path, before_files);
                    } else if file_type.is_file() && path.extension().map_or(false, |ext| ext == "md") {
                        before_files.insert(path);
                    }
                }
            }
        }
    }
    collect_sync_md_files(&sync_dir, &mut before_files);

    // 5. 构建子进程并注入环境变量
    let mut cmd = tokio::process::Command::new("node");
    if !sync_dir.as_os_str().is_empty() {
        cmd.current_dir(&sync_dir);
    }
    cmd.env("PI_CODING_AGENT_DIR", &pi_config_dir);
    cmd.args(&args);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // 5. 启动子进程
    let mut child = cmd.spawn().map_err(|e| format!("无法启动 Pi 子进程: {}", e))?;
    
    // Store the child PID in the active_pi_pid global state
    {
        let mut active_pid = state.active_pi_pid.lock();
        *active_pid = Some(child.id().unwrap_or(0));
    }
    
    let stdout = child.stdout.take().ok_or("无法捕获 stdout")?;
    let stderr = child.stderr.take().ok_or("无法捕获 stderr")?;

    let app_handle_for_stdout = app.clone();
    let app_handle_for_stderr = app.clone();

    // 异步流式读取并推送 Stdout
    let stdout_handle = tokio::spawn(async move {
        let mut reader = tokio::io::BufReader::new(stdout).lines();
        let mut full_stdout = String::new();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_handle_for_stdout.emit("pi-stream-output", line.clone());
            full_stdout.push_str(&line);
            full_stdout.push('\n');
        }
        full_stdout
    });

    // 异步流式读取并推送 Stderr
    let stderr_handle = tokio::spawn(async move {
        let mut reader = tokio::io::BufReader::new(stderr).lines();
        let mut full_stderr = String::new();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_handle_for_stderr.emit("pi-stream-output", format!("ERR: {}", line));
            full_stderr.push_str(&line);
            full_stderr.push('\n');
        }
        full_stderr
    });

    // 等待子进程退出，设置 600 秒超时以防止大上下文生成时后台进程超时挂死
    let status = match tokio::time::timeout(std::time::Duration::from_secs(600), child.wait()).await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            let mut active_pid = state.active_pi_pid.lock();
            *active_pid = None;
            return Err(format!("等待 Pi 执行失败: {}", e));
        },
        Err(_) => {
            let _ = child.kill().await;
            let mut active_pid = state.active_pi_pid.lock();
            *active_pid = None;
            return Err("Pi 智能体执行超时（600秒限制），已自动终止进程。这通常是由于 API 访问受限、配额超限或网络连接中断导致的。".to_string());
        }
    };

    // Clear it here upon successful completion
    {
        let mut active_pid = state.active_pi_pid.lock();
        *active_pid = None;
    }

    let stdout_str = stdout_handle.await.unwrap_or_default();
    let stderr_str = stderr_handle.await.unwrap_or_default();

    // 6. 从文件读回修改后的新文章内容
    let modified_content = std::fs::read_to_string(&temp_file_path)
        .unwrap_or_else(|_| content); // 若无修改或被删除，回退到原内容

    // 清理临时文件
    let _ = std::fs::remove_file(&temp_file_path);

    // 检查是否有新增的 markdown 文件
    let mut new_articles_info = Vec::new();
    
    // 1. 扫描 workspace_root (非递归)
    if !workspace_root.as_os_str().is_empty() {
        if let Ok(entries) = std::fs::read_dir(&workspace_root) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        let path = entry.path();
                        if path.extension().map_or(false, |ext| ext == "md") && !before_files.contains(&path) {
                            if let Ok(content) = std::fs::read_to_string(&path) {
                                let title = path.file_stem()
                                    .map(|s| s.to_string_lossy().to_string())
                                    .unwrap_or_else(|| "未命名新文档".to_string());
                                new_articles_info.push((title, content, path.clone(), true)); // true = 需要移动至 sync_dir
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. 递归扫描 sync_dir (公众号文章/)
    fn scan_sync_new_files(
        dir: &std::path::Path,
        before_files: &std::collections::HashSet<std::path::PathBuf>,
        new_articles_info: &mut Vec<(String, String, std::path::PathBuf, bool)>,
    ) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    let path = entry.path();
                    if file_type.is_dir() {
                        scan_sync_new_files(&path, before_files, new_articles_info);
                    } else if file_type.is_file() && path.extension().map_or(false, |ext| ext == "md") && !before_files.contains(&path) {
                        if let Ok(content) = std::fs::read_to_string(&path) {
                            let title = path.file_stem()
                                .map(|s| s.to_string_lossy().to_string())
                                .unwrap_or_else(|| "未命名新文档".to_string());
                            new_articles_info.push((title, content, path.clone(), false)); // false = 已在 sync_dir，无需移动
                        }
                    }
                }
            }
        }
    }
    scan_sync_new_files(&sync_dir, &before_files, &mut new_articles_info);

    // 将新增文件导入/同步，并通过同步引擎映射至 SQLite
    let mut imported_articles = Vec::new();
    if !new_articles_info.is_empty() {
        let db = state.db.lock();
        for (title, content, path, needs_move) in new_articles_info {
            let article_id = if needs_move {
                let sanitized_title = sanitize_filename(&title);
                let filename = format!("{}.md", sanitized_title);
                let dest_path = sync_dir.join(&filename);
                
                // 写入物理同步目录
                let file_content = write_markdown_file(&content, "default", &title);
                let _ = std::fs::write(&dest_path, file_content);
                let _ = std::fs::remove_file(path);
                filename
            } else {
                // 已在 sync_dir，计算相对于 sync_dir 的相对路径作为 ID
                let rel_path = path.strip_prefix(&sync_dir)
                    .map(|p| p.to_string_lossy().replace("\\", "/"))
                    .unwrap_or_else(|_| path.file_name().unwrap().to_string_lossy().to_string());
                rel_path
            };
            
            imported_articles.push(serde_json::json!({
                "id": article_id,
                "title": title
            }));
        }
        let _ = sync_database_with_disk(&db);
    }

    Ok(serde_json::json!({
        "success": status.success(),
        "stdout": stdout_str,
        "stderr": stderr_str,
        "modified_content": modified_content,
        "new_articles": imported_articles,
    }))
}

#[tauri::command]
async fn stop_pi_agent(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let pid_opt = {
        let active_pid = state.active_pi_pid.lock();
        *active_pid
    };

    if let Some(pid) = pid_opt {
        if pid > 0 {
            // Kill the process based on platform
            #[cfg(unix)]
            {
                let _ = std::process::Command::new("kill")
                    .arg("-9")
                    .arg(pid.to_string())
                    .status();
            }
            #[cfg(windows)]
            {
                let _ = std::process::Command::new("taskkill")
                    .arg("/F")
                    .arg("/PID")
                    .arg(pid.to_string())
                    .status();
            }
        }
        
        let mut active_pid = state.active_pi_pid.lock();
        *active_pid = None;
        
        Ok(serde_json::json!({
            "status": "ok",
            "message": "已主动停止智能体执行。"
        }))
    } else {
        Ok(serde_json::json!({
            "status": "ok",
            "message": "当前没有正在运行的智能体。"
        }))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();
    let db = init_db();
    
    // 初始化 Wiki 表和文章表
    {
        db.execute(
            "CREATE TABLE IF NOT EXISTS wechat_articles (
                id TEXT PRIMARY KEY,
                title TEXT,
                content TEXT,
                theme TEXT,
                updated_at REAL
            )",
            [],
        ).unwrap();

        // Migration to add folder_id to wechat_articles table
        let _ = db.execute("ALTER TABLE wechat_articles ADD COLUMN folder_id TEXT", []);

        // Initialize wechat_folders table
        db.execute(
            "CREATE TABLE IF NOT EXISTS wechat_folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT,
                updated_at REAL
            )",
            [],
        ).unwrap();

        // Initialize wechat_article_analytics table
        db.execute(
            "CREATE TABLE IF NOT EXISTS wechat_article_analytics (
                id TEXT PRIMARY KEY,
                msgid TEXT,
                title TEXT,
                publish_time TEXT,
                url TEXT,
                read_num INTEGER DEFAULT 0,
                like_num INTEGER DEFAULT 0,
                share_num INTEGER DEFAULT 0,
                favor_num INTEGER DEFAULT 0,
                updated_at REAL
            )",
            [],
        ).unwrap();

        db.execute(
            "CREATE TABLE IF NOT EXISTS wiki_entries (
                id TEXT PRIMARY KEY,
                title TEXT,
                content TEXT,
                tags TEXT,
                links TEXT,
                category TEXT,
                updated_at REAL,
                source_text TEXT,
                purpose TEXT,
                metadata TEXT
            )",
            [],
        ).unwrap();
        
        // 显式添加缺失的列 (Migration)
        let _ = db.execute("ALTER TABLE wiki_entries ADD COLUMN source_text TEXT", []);
        let _ = db.execute("ALTER TABLE wiki_entries ADD COLUMN purpose TEXT", []);
        let _ = db.execute("ALTER TABLE wiki_entries ADD COLUMN metadata TEXT", []);
        
        db.execute(
            "CREATE TABLE IF NOT EXISTS wiki_events (
                id TEXT PRIMARY KEY,
                wiki_id TEXT,
                event_type TEXT,
                description TEXT,
                timestamp REAL
            )",
            [],
        ).unwrap();
        
        db.execute(
            "CREATE TABLE IF NOT EXISTS raw_sources (
                id TEXT PRIMARY KEY,
                name TEXT,
                path TEXT,
                content TEXT,
                source_type TEXT,
                created_at REAL,
                metadata TEXT
            )",
            [],
        ).unwrap();
        
        // 显式添加缺失的列 (Migration)
        let _ = db.execute("ALTER TABLE raw_sources ADD COLUMN content TEXT", []);
        
        // Startup directory sync to and from disk
        if let Err(e) = sync_database_with_disk(&db) {
            log::error!("Failed to sync database with disk on startup: {}", e);
        }
    }

    let mut ak = String::new(); let mut bk = String::new(); let mut mk = String::new();
    let mut pp = 8000;
    let mut rm = "gpt-4o-mini".to_string();
    let mut w_url = String::new(); let mut w_key = String::new(); let mut w_model = String::new();
    {
        let mut stmt = db.prepare("SELECT key, value FROM global_stats").unwrap();
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, rusqlite::types::Value>(1)?))).unwrap();
        for r in rows {
            if let Ok((k, v_val)) = r {
                let v = match v_val {
                    rusqlite::types::Value::Text(s) => s,
                    rusqlite::types::Value::Integer(i) => i.to_string(),
                    rusqlite::types::Value::Real(f) => f.to_string(),
                    _ => String::new(),
                };
                match k.trim().to_uppercase().as_str() { 
                    "AIHUBMIX_API_KEY" => ak = v, 
                    "BAILIAN_API_KEY" => bk = v, 
                    "MODELSCOPE_API_KEY" => mk = v,
                    "PROXY_PORT" => {
                        let cleaned = v.trim();
                        if let Ok(p) = cleaned.parse::<u16>() {
                            pp = p;
                        }
                    },
                    "REASONING_MODEL" => rm = v,
                    "WRITING_API_URL" => w_url = v,
                    "WRITING_API_KEY" => w_key = v,
                    "WRITING_API_MODEL" => w_model = v,
                    _ => {} 
                }
            }
        }
    }

    let state = Arc::new(AppState {
        db: Mutex::new(db), 
        http_client: Client::builder()
            .timeout(std::time::Duration::from_secs(600))
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .default_headers({
                let mut headers = reqwest::header::HeaderMap::new();
                headers.insert("Accept", "application/json".parse().unwrap());
                headers
            })
            .build()
            .unwrap(),
        active_models: RwLock::new(vec![]),
        model_usage: RwLock::new(HashMap::new()),
        config: RwLock::new(GlobalConfig { 
            aihubmix_key: ak.trim().to_string(), 
            bailian_key: bk.trim().to_string(), 
            modelscope_key: mk.trim().to_string(),
            proxy_port: pp,
            reasoning_model: rm,
            writing_api_url: w_url.trim().to_string(),
            writing_api_key: w_key.trim().to_string(),
            writing_api_model: w_model.trim().to_string(),
        }),
        active_pi_pid: Mutex::new(None),
    });

    let axum_state = state.clone();
    tauri::async_runtime::spawn(async move {
        refresh_models(axum_state.clone()).await;
        
        let app = Router::new()
            .route("/api/stats", get(get_stats))
            .route("/api/stats/purge", post(purge_stats))
            .route("/api/fetch-webpage", post(fetch_webpage_api))
            .route("/api/web-search", post(web_search_api))
            .route("/api/settings", get(get_settings).post(save_settings))
            .route("/api/sessions", get(get_sessions).post(create_session))
            .route("/api/sessions/:sid", delete(delete_session))
            .route("/api/sessions/:sid/messages", get(get_messages))
            .route("/api/wiki", get(get_wiki_axum).post(save_wiki_axum))
            .route("/api/wiki/:id", delete(delete_wiki_axum))
            .route("/v1/chat/completions", post(chat_completions))
            .route("/api/writing-proxy", post(writing_proxy))
            .route("/api/writing-proxy/chat/completions", post(writing_proxy))
            .layer(CorsLayer::permissive()).with_state(axum_state.clone());
        
        // 启动 UI 控制后台 (固定 8001)
        let ui_listener = tokio::net::TcpListener::bind("127.0.0.1:8001").await.unwrap();
        info!("Console API listening on http://127.0.0.1:8001");
        
        // 启动 代理网关 (用户自定义端口)
        let proxy_port = axum_state.config.read().await.proxy_port;
        let proxy_listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", proxy_port)).await.unwrap();
        info!("Proxy Gateway listening on http://0.0.0.0:{}", proxy_port);

        let app_ui = app.clone();
        let app_proxy = app;

        tokio::join!(
            async { axum::serve(ui_listener, app_ui).await.unwrap() },
            async { axum::serve(proxy_listener, app_proxy).await.unwrap() }
        );
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new()
            .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                file_name: Some("app".into()),
            }))
            .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
            .max_file_size(10 * 1024 * 1024) // 10MB
            .level(log::LevelFilter::Info) // 只显示 INFO 及以上
            .filter(|metadata| {
                // 屏蔽掉过于琐碎的依赖库日志
                let target = metadata.target();
                !target.starts_with("hyper") && 
                !target.starts_with("tao") && 
                !target.starts_with("mio") &&
                !target.starts_with("want")
            })
            .build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![open_log_folder, open_path, get_paths_info, get_wiki, save_wiki, delete_wiki, ingest_content, compile_wiki, analyze_wiki_health, run_knowledge_audit, evolve_wiki_topic, get_raw_sources, list_knowledge_files, get_knowledge_graph, get_articles, save_article, delete_article, wechat_http_request, download_remote_file, read_local_file, run_pi_agent, stop_pi_agent, get_folders, save_folder, delete_folder, save_temp_image, get_image_base64, copy_html_to_clipboard, get_wechat_analytics, save_wechat_analytics])
        .run(tauri::generate_context!())
        .expect("error");
}
