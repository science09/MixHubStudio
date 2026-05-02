import os
from dotenv import load_dotenv

# 加载 .env 环境变量
load_dotenv()

import asyncio
import time
import json
import sqlite3
from typing import List, Dict, Any, Optional, Set
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import uvicorn
from pydantic import BaseModel
from collections import deque

app = FastAPI(title="HubMix Studio Router")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 配置区域
AIHUBMIX_API_KEY = os.getenv("AIHUBMIX_API_KEY", "")
BAILIAN_API_KEY = os.getenv("BAILIAN_API_KEY", "")
MODELSCOPE_API_KEY = os.getenv("MODELSCOPE_API_KEY", "")

AIHUBMIX_URL = "https://api.aihubmix.com/v1"
BAILIAN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
MODELSCOPE_URL = "https://api-inference.modelscope.cn/v1"

# 百炼免费模型
BAILIAN_MODELS = [
    "qwen-plus", "qwen-turbo", "qwen-long", "qwen-vl-plus", 
    "qwen2.5-7b-instruct", "qwen2.5-14b-instruct", "qwen2.5-32b-instruct"
]

# 魔搭免费模型 (尝试更简短的 ID 格式)
MODELSCOPE_MODELS = [
    "GLM-4", "chatglm3-6b",
    "Qwen2.5-72B-Instruct", "Qwen2.5-7B-Instruct",
    "DeepSeek-V2.5", "Llama-3-8B-Instruct-v0.1"
]

# 统一模型优先级
MODEL_PRIORITY = BAILIAN_MODELS + MODELSCOPE_MODELS + [
    "gpt-4.1-mini-free", "gpt-4.1-nano-free", "gpt-4.1-free", "gpt-4o-free", 
    "claude-3-5-sonnet-free", "deepseek-v3-free"
]

DB_FILE = "aihubmix_stats.db"

def get_model_priority(model_id: str) -> int:
    try: return MODEL_PRIORITY.index(model_id)
    except ValueError: return 999

def get_provider_config(model_id: str):
    if model_id in BAILIAN_MODELS:
        return BAILIAN_URL, BAILIAN_API_KEY
    if model_id in MODELSCOPE_MODELS:
        return MODELSCOPE_URL, MODELSCOPE_API_KEY
    return AIHUBMIX_URL, AIHUBMIX_API_KEY

class Stats:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.active_models: Set[str] = set()
        self.init_db()
        self.request_history = deque(maxlen=50)
        self.load_stats()

    def init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS global_stats (key TEXT PRIMARY KEY, value TEXT)")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS model_stats (
                    model_id TEXT PRIMARY KEY, success INTEGER DEFAULT 0, fail INTEGER DEFAULT 0,
                    rate_limits INTEGER DEFAULT 0, tokens INTEGER DEFAULT 0, prompt_tokens INTEGER DEFAULT 0,
                    completion_tokens INTEGER DEFAULT 0, cached_tokens INTEGER DEFAULT 0, last_used REAL DEFAULT 0
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS request_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT, model TEXT, status TEXT, latency REAL,
                    prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0, cached_tokens INTEGER DEFAULT 0
                )
            """)
            conn.execute("CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, title TEXT, created_at REAL)")
            conn.execute("CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, model TEXT, timestamp REAL)")
            
            # 平滑升级：检查并添加 model 字段 (针对已存在的数据库)
            try: conn.execute("ALTER TABLE chat_messages ADD COLUMN model TEXT")
            except: pass
            
            for k in ["AIHUBMIX_API_KEY", "BAILIAN_API_KEY", "MODELSCOPE_API_KEY"]:
                conn.execute("INSERT OR IGNORE INTO global_stats (key, value) VALUES (?, ?)", (k, os.getenv(k, "")))
            for k in ["total_requests", "success_count", "total_tokens", "fail_count", "rate_limit_count"]:
                conn.execute("INSERT OR IGNORE INTO global_stats (key, value) VALUES (?, ?)", (k, "0"))
            conn.commit()

    def load_stats(self):
        global AIHUBMIX_API_KEY, BAILIAN_API_KEY, MODELSCOPE_API_KEY
        with sqlite3.connect(self.db_path) as conn:
            g = dict(conn.execute("SELECT key, value FROM global_stats").fetchall())
            self.total_requests = int(g.get("total_requests", 0))
            self.success_count = int(g.get("success_count", 0))
            self.total_tokens = int(g.get("total_tokens", 0))
            self.fail_count = int(g.get("fail_count", 0))
            self.rate_limit_count = int(g.get("rate_limit_count", 0))
            AIHUBMIX_API_KEY = g.get("AIHUBMIX_API_KEY", AIHUBMIX_API_KEY)
            BAILIAN_API_KEY = g.get("BAILIAN_API_KEY", BAILIAN_API_KEY)
            MODELSCOPE_API_KEY = g.get("MODELSCOPE_API_KEY", MODELSCOPE_API_KEY)
            self.model_usage = {r[0]: {"success":r[1], "fail":r[2], "429":r[3], "tokens":r[4], "prompt_tokens":r[5], "completion_tokens":r[6], "cached_tokens":r[7], "last_used":r[8], "cooldown_until": 0} for r in conn.execute("SELECT model_id, success, fail, rate_limits, tokens, prompt_tokens, completion_tokens, cached_tokens, last_used FROM model_stats").fetchall()}
        self.load_history()

    def load_history(self):
        self.request_history.clear()
        with sqlite3.connect(self.db_path) as conn:
            for r in conn.execute("SELECT time, model, status, latency, prompt_tokens, completion_tokens, cached_tokens FROM request_log ORDER BY id DESC LIMIT 50").fetchall():
                self.request_history.append({"time":r[0], "model":r[1], "status":r[2], "latency":r[3], "p":r[4], "c":r[5], "cached":r[6]})

    def add_to_history(self, model: str, status: str, latency: float, p: int, c: int, cached: int = 0):
        t = time.strftime("%H:%M:%S")
        self.request_history.appendleft({"time": t, "model": model, "status": status, "latency": round(latency, 2), "p": p, "c": c, "cached": cached})
        with sqlite3.connect(self.db_path) as conn: 
            conn.execute("INSERT INTO request_log (time, model, status, latency, prompt_tokens, completion_tokens, cached_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)", (t, model, status, round(latency, 2), p, c, cached))
            conn.commit()

    def update_global(self, key: str, increment: int = 1):
        with sqlite3.connect(self.db_path) as conn: 
            conn.execute("UPDATE global_stats SET value = CAST(value AS INTEGER) + ? WHERE key = ?", (increment, key))
            conn.commit()
        if hasattr(self, key): setattr(self, key, getattr(self, key) + increment)

    def update_model(self, model_id: str, field: str, increment: int = 1):
        f_map = {"success": "success", "fail": "fail", "429": "rate_limits", "tokens": "tokens", "prompt_tokens": "prompt_tokens", "completion_tokens": "completion_tokens", "cached_tokens": "cached_tokens"}
        db_f = f_map.get(field)
        if not db_f: return
        with sqlite3.connect(self.db_path) as conn: 
            conn.execute(f"UPDATE model_stats SET {db_f} = {db_f} + ?, last_used = ? WHERE model_id = ?", (increment, time.time(), model_id))
            conn.commit()
        if model_id in self.model_usage: self.model_usage[model_id][field] += increment; self.model_usage[model_id]["last_used"] = time.time()

    def add_usage(self, model: str, prompt: int, completion: int, cached: int = 0):
        self.update_global("total_tokens", prompt + completion)
        self.update_model(model, "prompt_tokens", prompt)
        self.update_model(model, "completion_tokens", completion)
        self.update_model(model, "tokens", prompt + completion)
        self.update_model(model, "cached_tokens", cached)

    def save_message(self, sid: str, role: str, content: str, model: str = ""):
        with sqlite3.connect(self.db_path) as conn: 
            conn.execute("INSERT INTO chat_messages (session_id, role, content, model, timestamp) VALUES (?, ?, ?, ?, ?)", (sid, role, content, model, time.time()))
            conn.commit()

stats = Stats(DB_FILE)

class ModelRouter:
    def __init__(self, s): self.s = s
    def get_next(self, exclude: Set[str] = None) -> Optional[str]:
        now = time.time(); exclude = exclude or set()
        online = sorted(list(self.s.active_models), key=get_model_priority)
        for m in online:
            if m in exclude: continue
            if self.s.model_usage.get(m, {}).get("cooldown_until", 0) < now: return m
        return None

router = ModelRouter(stats)
http_client = httpx.AsyncClient(timeout=120.0)

async def refresh_models():
    # 1. 加载百炼硬编码模型
    if BAILIAN_API_KEY:
        with sqlite3.connect(DB_FILE) as conn:
            for m in BAILIAN_MODELS: conn.execute("INSERT OR IGNORE INTO model_stats (model_id) VALUES (?)", (m,))
            conn.commit()
        stats.active_models.update(BAILIAN_MODELS)

    # 2. 从魔搭动态拉取模型 (自动发现)
    if MODELSCOPE_API_KEY:
        try:
            res = await http_client.get(f"{MODELSCOPE_URL}/models", headers={"Authorization": f"Bearer {MODELSCOPE_API_KEY}"})
            if res.status_code == 200:
                ms_ids = [m["id"] for m in res.json().get("data", [])]
                if ms_ids:
                    with sqlite3.connect(DB_FILE) as conn:
                        for mid in ms_ids: conn.execute("INSERT OR IGNORE INTO model_stats (model_id) VALUES (?)", (mid,))
                        conn.commit()
                    stats.active_models.update(ms_ids)
                    # 动态更新魔搭模型列表，确保 chat 路由能识别这些 ID
                    global MODELSCOPE_MODELS
                    MODELSCOPE_MODELS = list(set(MODELSCOPE_MODELS + ms_ids))
        except Exception as e: print(f"ModelScope Sync error: {e}")

    # 3. 从 AIHubMix 动态加载
    try:
        res = await http_client.get(f"{AIHUBMIX_URL}/models", headers={"Authorization": f"Bearer {AIHUBMIX_API_KEY}"})
        if res.status_code == 200:
            ids = [m["id"] for m in res.json().get("data", [])]
            free = [i for i in ids if "free" in i.lower() or i in MODEL_PRIORITY]
            if free:
                with sqlite3.connect(DB_FILE) as conn:
                    for f in free: conn.execute("INSERT OR IGNORE INTO model_stats (model_id) VALUES (?)", (f,))
                    conn.commit()
                stats.active_models.update(free)
        stats.load_stats()
        return list(stats.active_models)
    except Exception as e: print(f"Sync error: {e}")
    return list(stats.active_models)

@app.on_event("startup")
async def startup(): await refresh_models()

def get_model_caps(model_id: str) -> str:
    m = model_id.lower()
    if "image" in m: return "🖼️ Multi"
    if any(x in m for x in ["gpt-4o", "gemini-3", "gpt-4.1-mini"]): return "👁️ Multi"
    if any(x in m for x in ["coding", "k2.6", "kimi"]): return "💻 Coding"
    return "📝 Text"

@app.get("/api/stats")
async def get_stats_api():
    now = time.time(); sorted_active = sorted(list(stats.active_models), key=get_model_priority)
    m_data = []
    for m in sorted_active:
        ms = stats.model_usage.get(m, {})
        status = "✅ Available"
        if ms.get("cooldown_until", 0) > now: status = f"⏳ Cooldown ({int(ms['cooldown_until'] - now)}s)"
        provider = "AIHubMix"
        if m in BAILIAN_MODELS: provider = "Bailian"
        elif m in MODELSCOPE_MODELS: provider = "ModelScope"
        m_data.append({"id": m, "provider": provider, "caps": get_model_caps(m), "status": status, "success": ms.get("success", 0), "429": ms.get("429", 0), "fail": ms.get("fail", 0), "tokens": ms.get("tokens", 0), "cached": ms.get("cached_tokens", 0), "last_active": time.strftime("%H:%M:%S", time.localtime(ms.get("last_used", 0))) if ms.get("last_used", 0) > 0 else "-"})
    return {"summary": {"total_requests": stats.total_requests, "success_count": stats.success_count, "total_tokens": stats.total_tokens, "fail_count": stats.fail_count}, "models": m_data, "history": list(stats.request_history)}

@app.get("/api/sessions")
async def get_sessions():
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute("SELECT * FROM chat_sessions ORDER BY created_at DESC").fetchall()]

@app.post("/api/sessions")
async def create_s(d: dict):
    with sqlite3.connect(DB_FILE) as conn: 
        conn.execute("INSERT INTO chat_sessions (id, title, created_at) VALUES (?, ?, ?)", (d["id"], d["title"], time.time()))
        conn.commit()
    return {"status": "ok"}

@app.get("/api/settings")
async def get_settings():
    with sqlite3.connect(DB_FILE) as conn:
        return dict(conn.execute("SELECT key, value FROM global_stats WHERE key LIKE '%_API_KEY'").fetchall())

@app.post("/api/settings")
async def save_settings(d: dict):
    with sqlite3.connect(DB_FILE) as conn:
        for k, v in d.items(): conn.execute("UPDATE global_stats SET value = ? WHERE key = ?", (v, k))
        conn.commit()
    stats.load_stats()
    await refresh_models()
    return {"status": "ok"}

@app.post("/refresh")
async def manual_refresh():
    models = await refresh_models()
    return {"status": "success", "count": len(models)}

@app.get("/api/sessions/{sid}/messages")
async def get_msgs(sid: str):
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute("SELECT role, content, model FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC", (sid,)).fetchall()]

@app.delete("/api/sessions/{sid}")
async def del_s(sid: str):
    with sqlite3.connect(DB_FILE) as conn: 
        conn.execute("DELETE FROM chat_sessions WHERE id = ?", (sid,))
        conn.execute("DELETE FROM chat_messages WHERE session_id = ?", (sid,))
        conn.commit()
    return {"status": "ok"}

@app.post("/v1/chat/completions")
async def chat(request: Request):
    b = await request.json()
    sid = b.pop("session_id", None)
    req_provider = b.pop("provider", "All")
    stats.update_global("total_requests"); start = time.time()
    if sid:
        last = b.get("messages", [])[-1]
        stats.save_message(sid, last.get("role", "user"), last.get("content", ""))
    tried = set()
    max_t = 12
    for i in range(max_t):
        target = router.get_next(exclude=tried)
        if not target: break
        tried.add(target)
        t_url, t_key = get_provider_config(target)
        t_provider = "AIHubMix"
        if target in BAILIAN_MODELS: t_provider = "Bailian"
        elif target in MODELSCOPE_MODELS: t_provider = "ModelScope"
        if req_provider != "All" and t_provider != req_provider: continue
        if not t_key: continue
        print(f"DEBUG: Attempting {target} via {t_url} ({i+1}/{max_t})...")
        h = {"Authorization": f"Bearer {t_key}", "Content-Type": "application/json"}
        payload = b.copy(); payload["model"] = target
        try:
            req = http_client.build_request("POST", f"{t_url}/chat/completions", json=payload, headers=h)
            res = await http_client.send(req, stream=True)
            if res.status_code != 200:
                err_body = await res.aread()
                print(f"DEBUG: {target} failed with {res.status_code}: {err_body.decode()[:150]}")
                if res.status_code in [403, 429]: stats.model_usage[target]["cooldown_until"] = time.time() + 60
                await res.aclose(); await asyncio.sleep(0.5); continue
            async def gen():
                full, found_usage = "", False
                p_tokens, c_tokens, ca_tokens = 0, 0, 0
                try:
                    stats.update_global("success_count"); stats.update_model(target, "success")
                    async for line in res.aiter_lines():
                        if not line: continue
                        if line.startswith("data: "):
                            ds = line[6:]
                            if ds == "[DONE]": 
                                yield f"{line}\n\n"
                                continue
                            try:
                                dj = json.loads(ds)
                                dj["model"] = target
                                yield f"data: {json.dumps(dj)}\n\n"
                                if "usage" in dj and dj["usage"]:
                                    u = dj["usage"]
                                    p_tokens = u.get("prompt_tokens", p_tokens)
                                    c_tokens = u.get("completion_tokens", c_tokens)
                                    ca_tokens = u.get("cached_tokens", ca_tokens)
                                    found_usage = True
                                choices = dj.get("choices", [])
                                if choices: full += choices[0].get("delta", {}).get("content", "")
                            except: pass
                finally:
                    await res.aclose()
                    # 强制估算补丁：如果官方给的是 0 或者没给，且我们确实有回复内容，则启动本地估算
                    if (p_tokens == 0 or c_tokens == 0) and full:
                        c_tokens = int(len(full) * 0.8) if c_tokens == 0 else c_tokens
                        if p_tokens == 0:
                            all_input = "".join([m.get("content", "") for m in b.get("messages", [])])
                            p_tokens = int(len(all_input) * 0.8)
                    
                    print(f"DEBUG Stats: Model={target}, FullLen={len(full)}, P={p_tokens}, C={c_tokens}")
                    
                    # 更新统计数据
                    stats.add_usage(target, p_tokens, c_tokens, ca_tokens)
                    stats.add_to_history(target, "Success", time.time()-start, p_tokens, c_tokens, ca_tokens)
                    
                    if sid and full: 
                        stats.save_message(sid, "assistant", full, target)
            return StreamingResponse(gen(), media_type="text/event-stream")
        except: continue
    # 如果走到这里，说明所有尝试都失败了
    error_summary = ", ".join([f"{m}" for m in tried])
    print(f"CRITICAL: All attempts failed. Tried models: {error_summary}")
    raise HTTPException(status_code=503, detail=f"All models failed or exhausted. Tried: {len(tried)} models.")

if __name__ == "__main__":
    uvicorn.run("aihubmix_router:app", host="0.0.0.0", port=8000, reload=True)
