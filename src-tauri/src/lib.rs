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
use log::{info, error};
use tauri_plugin_opener::OpenerExt;

// --- 数据模型 ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ChatRequest {
    pub messages: Vec<Message>,
    pub model: Option<String>,
    pub stream: Option<bool>,
    pub session_id: Option<String>,
    pub provider: Option<String>,
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
}

// --- 助手函数 ---

fn get_now_f64() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64()
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
    let mut stmt = db.prepare("SELECT model_id, success, fail, rate_limits, tokens, prompt_tokens, completion_tokens, cached_tokens, last_used FROM model_stats").unwrap();
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, ModelUsage {
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
    let mut stmt = db.prepare("SELECT key, value FROM global_stats WHERE key LIKE '%_API_KEY' OR key = 'PROXY_PORT'").unwrap();
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
        let provider = if BAILIAN_MODELS.contains(&m_id.as_str()) { "Bailian" } else if m_id.contains("free") { "AIHubMix" } else { "ModelScope" };
        
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
            let p: i64 = row.get(4)?;
            let c: i64 = row.get(5)?;
            Ok(serde_json::json!({
                "time": row.get::<_, String>(0)?,
                "model": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "latency": row.get::<_, f64>(3)?,
                "p": p, // 改为前端期望的 p
                "c": c, // 改为前端期望的 c
                "tokens": p + c,
            }))
        }).unwrap();
        rows.map(|r| r.unwrap()).collect::<Vec<_>>()
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
            _ => {}
        }
    }
    Json(serde_json::json!({"status": "ok"}))
}

async fn chat_completions(State(state): State<Arc<AppState>>, Json(req): Json<ChatRequest>) -> impl IntoResponse {
    let now = get_now_f64();
    let model_id = req.model.clone().unwrap_or_else(|| "gpt-4o-free".to_string());

    if let Some(sid) = &req.session_id {
        if let Some(last) = req.messages.last() {
            let db = state.db.lock();
            let _ = db.execute("INSERT INTO chat_messages (session_id, role, content, model, timestamp) VALUES (?, ?, ?, ?, ?)", 
                params![sid, last.role, last.content, model_id, now]);
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

                let (tx, rx) = tokio::sync::mpsc::channel(100);
                let state_clone = state.clone();
                let model_clone = target_id.clone();
                let sid_clone = req.session_id.clone();
                let messages_clone = req.messages.clone();

                tokio::spawn(async move {
                    let mut full_content = String::new();
                    let reader = tokio_util::io::StreamReader::new(response.bytes_stream().map(|item| {
                        item.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
                    }));
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
                    let p_tokens = (messages_clone.iter().map(|m| m.content.len()).sum::<usize>() as f64 * 0.8) as i64;
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
    let rows = stmt.query_map([], |row| Ok(serde_json::json!({"id": row.get::<_, String>(0)?, "title": row.get::<_, String>(1)?, "created_at": row.get::<_, f64>(2)?}))).unwrap();
    Json(rows.map(|r| r.unwrap()).collect::<Vec<_>>())
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
    let rows = stmt.query_map(params![sid], |row| Ok(serde_json::json!({"role": row.get::<_, String>(0)?, "content": row.get::<_, String>(1)?, "model": row.get::<_, Option<String>>(2)?}))).unwrap();
    Json(rows.map(|r| r.unwrap()).collect::<Vec<_>>())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();
    let db = init_db();
    
    let mut ak = String::new(); let mut bk = String::new(); let mut mk = String::new();
    let mut pp = 8000;
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
                    _ => {} 
                }
            }
        }
    }

    let state = Arc::new(AppState {
        db: Mutex::new(db), 
        http_client: Client::builder()
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
        }),
    });

    let axum_state = state.clone();
    tauri::async_runtime::spawn(async move {
        refresh_models(axum_state.clone()).await;
        
        let app = Router::new()
            .route("/api/stats", get(get_stats))
            .route("/api/stats/purge", post(purge_stats))
            .route("/api/settings", get(get_settings).post(save_settings))
            .route("/api/sessions", get(get_sessions).post(create_session))
            .route("/api/sessions/:sid", delete(delete_session))
            .route("/api/sessions/:sid/messages", get(get_messages))
            .route("/v1/chat/completions", post(chat_completions))
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
        .invoke_handler(tauri::generate_handler![open_log_folder])
        .run(tauri::generate_context!())
        .expect("error");
}
