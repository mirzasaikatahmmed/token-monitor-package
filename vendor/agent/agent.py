#!/usr/bin/env python3
"""
Token Monitor Agent — collects AI usage from this device and ships it to the backend.

Sources (auto-discovered on this machine):
  • Claude Code     — ~/.claude/projects/**/*.jsonl
  • Puku CLI        — ~/.puku-cli/projects/**/*.jsonl
  • Cursor          — ~/.cursor/ai-tracking/ai-code-tracking.db (+ transcripts)
  • Codex CLI       — ~/.codex/sessions/**/*.jsonl  (real token_count events)
  • Antigravity     — ~/.gemini/antigravity/brain/**/overview.txt (estimated)
  • Copilot IDE     — VS Code / Antigravity github.copilot-chat session-store.db
  • Copilot CLI     — ~/.copilot/logs (session estimates)
"""

from __future__ import annotations

import atexit
import json
import os
import platform
import signal
import sqlite3
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

# ---------------------------------------------------------------------------
# Paths — user/system data dir (NOT the project folder)
#   Linux:  ~/.config/token-monitor-agent/
#   macOS:  ~/Library/Application Support/token-monitor-agent/
#   Windows: %APPDATA%\token-monitor-agent\
# Config is Fernet-encrypted on disk (agentToken never stored as plaintext).
# ---------------------------------------------------------------------------

AGENT_DIR = Path(__file__).resolve().parent
LEGACY_CONFIG = AGENT_DIR / "agent.config.json"


def data_dir() -> Path:
    override = os.environ.get("TOKEN_MONITOR_DATA_DIR")
    if override:
        d = Path(override).expanduser()
    elif sys.platform == "win32":
        d = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "token-monitor-agent"
    elif sys.platform == "darwin":
        d = Path.home() / "Library" / "Application Support" / "token-monitor-agent"
    else:
        xdg = os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))
        d = Path(xdg) / "token-monitor-agent"
    d.mkdir(parents=True, exist_ok=True)
    return d


DATA_DIR     = data_dir()
CONFIG_ENC   = DATA_DIR / "config.enc"
KEY_FILE     = DATA_DIR / "secret.key"
STATE_DB     = DATA_DIR / "agent_state.db"
LOG_FILE     = DATA_DIR / "agent.log"
HOME = Path.home()
CLAUDE_PROJECTS = HOME / ".claude" / "projects"
PUKU_PROJECTS   = HOME / ".puku-cli" / "projects"
CURSOR_AI_DIR   = HOME / ".cursor" / "ai-tracking"
CURSOR_AI_DB    = CURSOR_AI_DIR / "ai-code-tracking.db"
CURSOR_PROJECTS = HOME / ".cursor" / "projects"
CODEX_SESSIONS  = HOME / ".codex" / "sessions"
ANTIGRAVITY_BRAIN = HOME / ".gemini" / "antigravity" / "brain"
COPILOT_DIR     = HOME / ".copilot"
COPILOT_LOGS    = COPILOT_DIR / "logs"

DEFAULT_SOURCES = [
    "claude_code",
    "puku_cli",
    "cursor",
    "codex",
    "antigravity",
    "copilot_ide",
    "copilot_cli",
]


def merge_sources(configured: list | None) -> list[str]:
    """Keep configured order; append any newly added default sources."""
    if not configured:
        return list(DEFAULT_SOURCES)
    out = [str(s) for s in configured]
    for s in DEFAULT_SOURCES:
        if s not in out:
            out.append(s)
    return out


def _vscode_style_copilot_dbs() -> list[Path]:
    """Copilot Chat session DBs across VS Code–family editors."""
    bases: list[Path] = []
    if sys.platform == "darwin":
        app_support = HOME / "Library" / "Application Support"
        bases = [
            app_support / "Code" / "User" / "globalStorage" / "github.copilot-chat",
            app_support / "Antigravity" / "User" / "globalStorage" / "github.copilot-chat",
            app_support / "Code - Insiders" / "User" / "globalStorage" / "github.copilot-chat",
        ]
    elif sys.platform == "win32":
        appdata = Path(os.environ.get("APPDATA", HOME / "AppData" / "Roaming"))
        bases = [
            appdata / "Code" / "User" / "globalStorage" / "github.copilot-chat",
            appdata / "Antigravity" / "User" / "globalStorage" / "github.copilot-chat",
        ]
    else:
        cfg = Path(os.environ.get("XDG_CONFIG_HOME", HOME / ".config"))
        bases = [
            cfg / "Code" / "User" / "globalStorage" / "github.copilot-chat",
            cfg / "Antigravity" / "User" / "globalStorage" / "github.copilot-chat",
            cfg / "Code - Insiders" / "User" / "globalStorage" / "github.copilot-chat",
        ]
    out: list[Path] = []
    for b in bases:
        db = b / "session-store.db"
        if db.exists():
            out.append(db)
    return out


def _chmod_private(path: Path) -> None:
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _fernet():
    try:
        from cryptography.fernet import Fernet
    except ImportError as exc:
        raise SystemExit(
            "Missing dependency 'cryptography'. Run: pip install -r requirements.txt"
        ) from exc
    if KEY_FILE.exists():
        key = KEY_FILE.read_bytes().strip()
    else:
        key = Fernet.generate_key()
        KEY_FILE.write_bytes(key)
        _chmod_private(KEY_FILE)
    return Fernet(key)


def save_config(cfg: dict) -> Path:
    """Encrypt and write config to the system data directory."""
    f = _fernet()
    payload = json.dumps(cfg, indent=2, sort_keys=True).encode("utf-8")
    CONFIG_ENC.write_bytes(f.encrypt(payload))
    _chmod_private(CONFIG_ENC)
    _chmod_private(KEY_FILE)
    return CONFIG_ENC


def _read_encrypted_config() -> dict | None:
    if not CONFIG_ENC.exists():
        return None
    f = _fernet()
    raw = f.decrypt(CONFIG_ENC.read_bytes())
    return json.loads(raw.decode("utf-8"))


def _migrate_legacy_plaintext() -> dict | None:
    """Move old project-folder agent.config.json into encrypted system storage."""
    candidates = [LEGACY_CONFIG, DATA_DIR / "agent.config.json"]
    for path in candidates:
        if not path.exists():
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                cfg = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        save_config(cfg)
        bak = path.with_suffix(path.suffix + ".bak")
        try:
            path.replace(bak)
        except OSError:
            try:
                path.unlink()
            except OSError:
                pass
        print(f"[config] migrated plaintext → encrypted {CONFIG_ENC}", flush=True)
        print(f"[config] removed plaintext (backup: {bak.name})", flush=True)
        return cfg
    return None


def _migrate_legacy_state() -> None:
    legacy_db = AGENT_DIR / "agent_state.db"
    if legacy_db.exists() and not STATE_DB.exists():
        try:
            import shutil
            shutil.copy2(legacy_db, STATE_DB)
            print(f"[config] migrated state db → {STATE_DB}", flush=True)
        except OSError as exc:
            print(f"[config] state migrate skipped: {exc}", flush=True)


def load_config() -> dict:
    defaults = {
        "backendUrl":           "http://localhost:3001",
        "agentToken":           "",
        "deviceId":             platform.node().lower().replace(" ", "-"),
        "hostname":             platform.node(),
        "pushIntervalSeconds":  30,
        "sources":              list(DEFAULT_SOURCES),
    }
    env_override = {
        "backendUrl":  os.environ.get("BACKEND_URL"),
        "agentToken":  os.environ.get("AGENT_TOKEN"),
        "deviceId":    os.environ.get("DEVICE_ID"),
        "hostname":    os.environ.get("HOSTNAME_OVERRIDE"),
    }
    cfg = {**defaults}
    _migrate_legacy_state()
    loaded = _read_encrypted_config()
    if loaded is None:
        loaded = _migrate_legacy_plaintext()
    if loaded:
        cfg.update(loaded)
    cfg["sources"] = merge_sources(cfg.get("sources"))
    for k, v in env_override.items():
        if v:
            cfg[k] = v
    return cfg


def _cli_write_config_from_stdin() -> int:
    raw = sys.stdin.read()
    data = json.loads(raw)
    path = save_config(data)
    print(f"[config] encrypted config written → {path}")
    print(f"[config] data dir → {DATA_DIR}")
    return 0


def _cli_set_token(token: str) -> int:
    token = (token or "").strip()
    if not token:
        print("[config] error: token is empty", file=sys.stderr)
        return 1
    cfg = load_config()
    cfg["agentToken"] = token
    # Drop env-only noise; persist the working fields
    path = save_config({
        "backendUrl": cfg.get("backendUrl", ""),
        "agentToken": token,
        "deviceId": cfg.get("deviceId", ""),
        "hostname": cfg.get("hostname", ""),
        "pushIntervalSeconds": int(cfg.get("pushIntervalSeconds") or 30),
        "sources": merge_sources(cfg.get("sources")),
    })
    print(f"[config] agentToken updated → {path}")
    print(f"[config] restart agent to apply: systemctl --user restart token-monitor-agent")
    return 0


def _cli_print_paths() -> int:
    print(f"data_dir={DATA_DIR}")
    print(f"config={CONFIG_ENC}")
    print(f"key={KEY_FILE}")
    print(f"state={STATE_DB}")
    print(f"log={LOG_FILE}")
    return 0


# Early CLI (before loading secrets into memory for long-running mode)
if __name__ == "__main__" and len(sys.argv) > 1:
    if sys.argv[1] == "--write-config":
        raise SystemExit(_cli_write_config_from_stdin())
    if sys.argv[1] == "--set-token":
        tok = sys.argv[2] if len(sys.argv) > 2 else ""
        if not tok and not sys.stdin.isatty():
            tok = sys.stdin.read()
        raise SystemExit(_cli_set_token(tok))
    if sys.argv[1] in ("--paths", "--show-paths"):
        raise SystemExit(_cli_print_paths())
    if sys.argv[1] in ("-h", "--help"):
        print("Usage: agent.py [--paths | --write-config | --set-token TOKEN]")
        raise SystemExit(0)


CFG = load_config()
BACKEND   = CFG["backendUrl"].rstrip("/")
TOKEN     = CFG["agentToken"]
DEVICE_ID = CFG["deviceId"]
HOSTNAME  = CFG["hostname"]
INTERVAL  = int(CFG["pushIntervalSeconds"])
SOURCES   = set(merge_sources(CFG.get("sources")))
OS_STR    = f"{platform.system()} {platform.release()}"

HEADERS = {
    "Content-Type": "application/json",
    **({"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}),
}

# ---------------------------------------------------------------------------
# State DB — file offsets + key/value watermarks
# ---------------------------------------------------------------------------

def init_state_db():
    conn = sqlite3.connect(str(STATE_DB), check_same_thread=False)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS file_offsets "
        "(path TEXT PRIMARY KEY, offset INTEGER NOT NULL DEFAULT 0)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS kv "
        "(key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    )
    conn.commit()
    return conn


STATE_CONN = init_state_db()
STATE_LOCK = threading.Lock()


def get_offset(path: str) -> int:
    with STATE_LOCK:
        row = STATE_CONN.execute(
            "SELECT offset FROM file_offsets WHERE path = ?", (path,)
        ).fetchone()
        return row[0] if row else 0


def set_offset(path: str, offset: int):
    with STATE_LOCK:
        STATE_CONN.execute(
            "INSERT INTO file_offsets(path, offset) VALUES(?,?) "
            "ON CONFLICT(path) DO UPDATE SET offset=excluded.offset",
            (path, offset),
        )
        STATE_CONN.commit()


def kv_get(key: str, default: str = "") -> str:
    with STATE_LOCK:
        row = STATE_CONN.execute(
            "SELECT value FROM kv WHERE key = ?", (key,)
        ).fetchone()
        return row[0] if row else default


def kv_set(key: str, value: str):
    with STATE_LOCK:
        STATE_CONN.execute(
            "INSERT INTO kv(key, value) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )
        STATE_CONN.commit()


# ---------------------------------------------------------------------------
# Record queue + push-now event
# ---------------------------------------------------------------------------

_queue: list[dict] = []
_queue_lock = threading.Lock()
_push_now = threading.Event()


def enqueue(record: dict):
    with _queue_lock:
        _queue.append(record)


def drain_queue() -> list[dict]:
    with _queue_lock:
        batch, _queue[:] = _queue[:], []
        return batch


def ms_to_iso(ms: int | float) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def chars_to_tokens(n: int) -> int:
    """Rough estimate when official counts are unavailable (~4 chars/token)."""
    return max(0, int(n) // 4)


# ---------------------------------------------------------------------------
# Shared usage extraction (Claude / future JSONL with usage)
# ---------------------------------------------------------------------------

def usage_from_obj(obj: dict, source: str) -> dict | None:
    if not isinstance(obj, dict):
        return None

    usage = obj.get("usage")
    if not usage and isinstance(obj.get("message"), dict):
        usage = obj["message"].get("usage")
    if not isinstance(usage, dict):
        return None

    # snake_case (Claude) or camelCase
    input_tokens  = int(usage.get("input_tokens")  or usage.get("inputTokens")  or 0)
    output_tokens = int(usage.get("output_tokens") or usage.get("outputTokens") or 0)
    cache_read    = int(
        usage.get("cache_read_input_tokens")
        or usage.get("cacheReadTokens")
        or usage.get("cache_read_tokens")
        or 0
    )
    cache_write   = int(
        usage.get("cache_creation_input_tokens")
        or usage.get("cacheWriteTokens")
        or usage.get("cache_write_tokens")
        or 0
    )
    if not (input_tokens or output_tokens or cache_read or cache_write):
        return None

    msg = obj.get("message") if isinstance(obj.get("message"), dict) else {}
    model = (
        obj.get("model")
        or msg.get("model")
        or ""
    )
    request_id = (
        obj.get("requestId")
        or obj.get("request_id")
        or obj.get("uuid")          # puku-cli / some Claude lines omit requestId
        or obj.get("id")
        or msg.get("id")
    )
    session_id = obj.get("sessionId") or obj.get("session_id") or obj.get("conversationId")
    timestamp = obj.get("timestamp") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if isinstance(timestamp, (int, float)):
        timestamp = ms_to_iso(timestamp if timestamp > 1e12 else timestamp * 1000)

    prompt_text = ""
    # Claude Code sometimes embeds user turns elsewhere; keep best-effort extract
    for msg_item in obj.get("messages") or []:
        if isinstance(msg_item, dict) and msg_item.get("role") == "user":
            content = msg_item.get("content", "")
            if isinstance(content, str):
                prompt_text = content[:500]
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        prompt_text = str(block.get("text", ""))[:500]
                        break
            break

    return {
        "source":           source,
        "model":            model,
        "promptText":       prompt_text,
        "inputTokens":      input_tokens,
        "outputTokens":     output_tokens,
        "cacheReadTokens":  cache_read,
        "cacheWriteTokens": cache_write,
        "requestId":        request_id,
        "sessionId":        session_id,
        "timestamp":        timestamp,
    }


def parse_jsonl_line(line: str, source: str) -> dict | None:
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None
    return usage_from_obj(obj, source)


# ---------------------------------------------------------------------------
# Claude Code — JSONL logs
# ---------------------------------------------------------------------------

def find_claude_logs() -> list[Path]:
    if not CLAUDE_PROJECTS.exists():
        return []
    return list(CLAUDE_PROJECTS.rglob("*.jsonl"))


def find_puku_logs() -> list[Path]:
    if not PUKU_PROJECTS.exists():
        return []
    return list(PUKU_PROJECTS.rglob("*.jsonl"))


def scan_jsonl_file(path: Path, source: str, from_start: bool = False) -> int:
    str_path = str(path)
    offset = 0 if from_start else get_offset(str_path)
    count = 0
    try:
        if path.stat().st_size <= offset and not from_start:
            return 0
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            fh.seek(offset)
            for raw in fh:
                record = parse_jsonl_line(raw, source)
                if record:
                    enqueue(record)
                    count += 1
            set_offset(str_path, fh.tell())
        if count:
            print(f"[scan:{source}] {path.name}: +{count}", flush=True)
    except (OSError, PermissionError) as exc:
        print(f"[scan] skipped {path}: {exc}", flush=True)
    return count


def scan_claude(from_start: bool = False) -> int:
    if "claude_code" not in SOURCES:
        return 0
    total = 0
    for p in find_claude_logs():
        # First time we see a file, read from start; otherwise resume offset
        first = get_offset(str(p)) == 0
        total += scan_jsonl_file(p, "claude_code", from_start=from_start or first)
    return total


def scan_puku(from_start: bool = False) -> int:
    if "puku_cli" not in SOURCES:
        return 0
    total = 0
    for p in find_puku_logs():
        first = get_offset(str(p)) == 0
        total += scan_jsonl_file(p, "puku_cli", from_start=from_start or first)
    return total


# ---------------------------------------------------------------------------
# Cursor — ai-code-tracking.db
# ---------------------------------------------------------------------------

def scan_cursor_ai_tracking() -> int:
    """
    Cursor does not persist official per-request token counts on disk.
    We ingest each distinct AI requestId from ai-code-tracking.db and estimate
    output tokens from AI-tracked file content written around that request.
    """
    if "cursor" not in SOURCES:
        return 0
    if not CURSOR_AI_DB.exists():
        return 0

    watermark = int(kv_get("cursor_ai_ts", "0") or "0")
    count = 0
    max_ts = watermark

    try:
        con = sqlite3.connect(f"file:{CURSOR_AI_DB}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
    except sqlite3.Error as exc:
        print(f"[cursor] open failed: {exc}", flush=True)
        return 0

    try:
        # One row per distinct request after watermark
        rows = con.execute(
            """
            SELECT requestId,
                   conversationId,
                   MAX(model) AS model,
                   MIN(timestamp) AS ts,
                   COUNT(*) AS chunks,
                   GROUP_CONCAT(DISTINCT fileName) AS files
            FROM ai_code_hashes
            WHERE timestamp > ?
              AND requestId IS NOT NULL
              AND requestId != ''
            GROUP BY requestId
            ORDER BY ts ASC
            """,
            (watermark,),
        ).fetchall()

        for row in rows:
            req_id = row["requestId"]
            conv   = row["conversationId"] or ""
            raw_model = (row["model"] or "default").strip()
            # Normalize Cursor tracking labels for pricing
            if raw_model.lower() in ("default", "auto", ""):
                model = "cursor-auto"
            else:
                model = raw_model
            ts     = int(row["ts"] or 0)
            files  = (row["files"] or "")[:400]
            chunks = int(row["chunks"] or 1)
            max_ts = max(max_ts, ts)

            # Estimate tokens from AI-written file content near this request
            out_chars = 0
            if conv and ts:
                try:
                    contents = con.execute(
                        """
                        SELECT content FROM tracked_file_content
                        WHERE conversationId = ?
                          AND createdAt BETWEEN ? AND ?
                        """,
                        (conv, ts - 180_000, ts + 180_000),
                    ).fetchall()
                    out_chars = sum(len(c[0] or "") for c in contents)
                except sqlite3.Error:
                    out_chars = 0

            output_tokens = chars_to_tokens(out_chars)
            # If we have no content, still count the request with a small
            # floor from edit chunk count so activity is visible.
            if output_tokens == 0:
                output_tokens = max(1, chunks * 40)
            # Agent turns are context-heavy; estimate input when Cursor
            # does not expose official token counts locally.
            input_tokens = max(output_tokens * 5, chunks * 600)

            enqueue({
                "source":           "cursor",
                "model":            model,
                "promptText":       files,
                "inputTokens":      input_tokens,
                "outputTokens":     output_tokens,
                "cacheReadTokens":  0,
                "cacheWriteTokens": 0,
                "requestId":        f"cursor:{req_id}",
                "sessionId":        conv or None,
                "timestamp":        ms_to_iso(ts) if ts else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
            count += 1
    finally:
        con.close()

    if max_ts > watermark:
        kv_set("cursor_ai_ts", str(max_ts))
    if count:
        print(f"[scan:cursor] ai-tracking: +{count} requests (tokens estimated)", flush=True)
    return count


def scan_cursor_transcripts() -> int:
    """Pick up any Cursor JSONL that happens to include usage blocks."""
    if "cursor" not in SOURCES:
        return 0
    if not CURSOR_PROJECTS.exists():
        return 0
    total = 0
    for p in CURSOR_PROJECTS.rglob("*.jsonl"):
        first = get_offset(str(p)) == 0
        total += scan_jsonl_file(p, "cursor", from_start=first)
    return total


# ---------------------------------------------------------------------------
# Codex CLI — ~/.codex/sessions/**/*.jsonl (real token_count events)
# ---------------------------------------------------------------------------

def find_codex_logs() -> list[Path]:
    if not CODEX_SESSIONS.exists():
        return []
    return list(CODEX_SESSIONS.rglob("*.jsonl"))


def scan_codex_file(path: Path) -> int:
    """Ingest Codex token_count events (last_token_usage per event)."""
    str_path = str(path)
    offset = get_offset(str_path)
    count = 0
    session_id = path.stem
    model = "gpt-5"
    try:
        if path.stat().st_size <= offset:
            return 0
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            fh.seek(offset)
            for raw in fh:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                typ = obj.get("type")
                payload = obj.get("payload") or {}
                # Track model from turn_context / world_state when present
                if typ == "turn_context" and isinstance(payload, dict) and payload.get("model"):
                    model = str(payload["model"])
                elif typ == "world_state" and isinstance(payload, dict):
                    state = payload.get("state") or {}
                    m = state.get("model") or (state.get("personality") or {}).get("model")
                    if m:
                        model = str(m)
                if typ == "event_msg" and isinstance(payload, dict) and payload.get("type") == "token_count":
                    info = payload.get("info") or {}
                    last = info.get("last_token_usage") or {}
                    raw_in = int(last.get("input_tokens") or 0)
                    out = int(last.get("output_tokens") or 0) + int(last.get("reasoning_output_tokens") or 0)
                    cache_r = int(last.get("cached_input_tokens") or 0)
                    cache_w = int(last.get("cache_write_input_tokens") or 0)
                    # Codex input_tokens usually includes cached; split for pricing
                    inp = max(0, raw_in - cache_r) if cache_r and raw_in >= cache_r else raw_in
                    if inp + out + cache_r + cache_w <= 0:
                        continue
                    ts = obj.get("timestamp") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    rid = f"codex:{session_id}:{ts}:{raw_in}:{out}"
                    enqueue({
                        "source": "codex",
                        "model": model,
                        "promptText": None,
                        "inputTokens": inp,
                        "outputTokens": out,
                        "cacheReadTokens": cache_r,
                        "cacheWriteTokens": cache_w,
                        "requestId": rid,
                        "sessionId": session_id,
                        "timestamp": ts if isinstance(ts, str) else ms_to_iso(int(ts)),
                    })
                    count += 1
            set_offset(str_path, fh.tell())
        if count:
            print(f"[scan:codex] {path.name}: +{count}", flush=True)
    except (OSError, PermissionError) as exc:
        print(f"[scan:codex] skipped {path}: {exc}", flush=True)
    return count


def scan_codex() -> int:
    if "codex" not in SOURCES:
        return 0
    total = 0
    for p in find_codex_logs():
        total += scan_codex_file(p)
    return total


# ---------------------------------------------------------------------------
# Antigravity IDE — brain overview.txt JSONL (estimated tokens)
# ---------------------------------------------------------------------------

def find_antigravity_overviews() -> list[Path]:
    if not ANTIGRAVITY_BRAIN.exists():
        return []
    return list(ANTIGRAVITY_BRAIN.glob("*/.system_generated/logs/overview.txt"))


def scan_antigravity_overview(path: Path) -> int:
    str_path = str(path)
    offset = get_offset(str_path)
    count = 0
    brain_id = path.parent.parent.parent.name  # .../brain/<id>/.system_generated/logs/overview.txt
    try:
        if path.stat().st_size <= offset:
            return 0
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            fh.seek(offset)
            for raw in fh:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                step = obj.get("step_index")
                typ = obj.get("type") or "step"
                # Count meaningful agent/user turns
                if typ not in (
                    "USER_INPUT",
                    "PLANNER_RESPONSE",
                    "MODEL",
                    "MODEL_RESPONSE",
                    "AGENT_RESPONSE",
                ) and not str(typ).endswith("RESPONSE"):
                    continue
                content = obj.get("content") or ""
                if isinstance(content, dict):
                    content = json.dumps(content)
                content = str(content)
                out_tokens = max(1, chars_to_tokens(len(content)))
                in_tokens = max(out_tokens, 200) if typ == "USER_INPUT" else max(out_tokens * 3, 400)
                if typ == "USER_INPUT":
                    in_tokens, out_tokens = out_tokens, max(1, out_tokens // 10)
                ts = obj.get("created_at") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                rid = f"antigravity:{brain_id}:{step}:{typ}"
                enqueue({
                    "source": "antigravity",
                    "model": "gemini",
                    "promptText": content[:400],
                    "inputTokens": in_tokens,
                    "outputTokens": out_tokens,
                    "cacheReadTokens": 0,
                    "cacheWriteTokens": 0,
                    "requestId": rid,
                    "sessionId": brain_id,
                    "timestamp": ts,
                })
                count += 1
            set_offset(str_path, fh.tell())
        if count:
            print(f"[scan:antigravity] {brain_id}: +{count}", flush=True)
    except (OSError, PermissionError) as exc:
        print(f"[scan:antigravity] skipped {path}: {exc}", flush=True)
    return count


def scan_antigravity() -> int:
    if "antigravity" not in SOURCES:
        return 0
    total = 0
    for p in find_antigravity_overviews():
        total += scan_antigravity_overview(p)
    return total


# ---------------------------------------------------------------------------
# Copilot IDE — session-store.db (VS Code / Antigravity)
# ---------------------------------------------------------------------------

def scan_copilot_ide_db(db_path: Path) -> int:
    if not db_path.exists():
        return 0
    key = f"copilot_ide_turn:{db_path}"
    last_id = int(kv_get(key, "0") or "0")
    count = 0
    max_id = last_id
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        rows = con.execute(
            """
            SELECT t.id, t.session_id, t.turn_index, t.user_message, t.assistant_response,
                   t.timestamp, s.agent_name, s.host_type
            FROM turns t
            LEFT JOIN sessions s ON s.id = t.session_id
            WHERE t.id > ?
            ORDER BY t.id ASC
            """,
            (last_id,),
        ).fetchall()
        for row in rows:
            tid = int(row["id"])
            max_id = max(max_id, tid)
            user = row["user_message"] or ""
            asst = row["assistant_response"] or ""
            in_tok = max(1, chars_to_tokens(len(user)))
            out_tok = max(1, chars_to_tokens(len(asst))) if asst else max(1, in_tok // 4)
            agent = (row["agent_name"] or "copilot").replace(" ", "-").lower()
            host = row["host_type"] or "vscode"
            ts = row["timestamp"] or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            enqueue({
                "source": "copilot_ide",
                "model": f"copilot-{agent}",
                "promptText": (user or "")[:400],
                "inputTokens": in_tok,
                "outputTokens": out_tok,
                "cacheReadTokens": 0,
                "cacheWriteTokens": 0,
                "requestId": f"copilot_ide:{host}:{tid}",
                "sessionId": row["session_id"],
                "timestamp": ts,
            })
            count += 1
        con.close()
    except sqlite3.Error as exc:
        print(f"[copilot_ide] {db_path}: {exc}", flush=True)
        return 0
    if max_id > last_id:
        kv_set(key, str(max_id))
    if count:
        print(f"[scan:copilot_ide] {db_path.parent.name}: +{count}", flush=True)
    return count


def scan_copilot_ide() -> int:
    if "copilot_ide" not in SOURCES:
        return 0
    total = 0
    for db in _vscode_style_copilot_dbs():
        total += scan_copilot_ide_db(db)
    return total


# ---------------------------------------------------------------------------
# Copilot CLI — ~/.copilot/logs (estimate per process session)
# ---------------------------------------------------------------------------

def scan_copilot_cli() -> int:
    if "copilot_cli" not in SOURCES:
        return 0
    if not COPILOT_LOGS.exists():
        return 0
    count = 0
    for path in sorted(COPILOT_LOGS.glob("process-*.log")):
        key = f"copilot_cli:{path.name}"
        if kv_get(key):
            # Re-scan if file grew a lot (new activity in same process)
            try:
                size = path.stat().st_size
            except OSError:
                continue
            prev = int(kv_get(f"{key}:size", "0") or "0")
            if size <= prev + 2048:
                continue
            kv_set(f"{key}:size", str(size))
            # Additional activity burst
            rid = f"copilot_cli:{path.stem}:sz{size}"
            enqueue({
                "source": "copilot_cli",
                "model": "copilot-cli",
                "promptText": path.name,
                "inputTokens": 800,
                "outputTokens": 200,
                "cacheReadTokens": 0,
                "cacheWriteTokens": 0,
                "requestId": rid,
                "sessionId": path.stem,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(path.stat().st_mtime)),
            })
            count += 1
            continue

        try:
            size = path.stat().st_size
            mtime = path.stat().st_mtime
        except OSError:
            continue
        # First sighting of a process log ≈ one CLI session
        est = max(500, chars_to_tokens(size))
        enqueue({
            "source": "copilot_cli",
            "model": "copilot-cli",
            "promptText": path.name,
            "inputTokens": est,
            "outputTokens": max(100, est // 5),
            "cacheReadTokens": 0,
            "cacheWriteTokens": 0,
            "requestId": f"copilot_cli:{path.stem}",
            "sessionId": path.stem,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(mtime)),
        })
        kv_set(key, "1")
        kv_set(f"{key}:size", str(size))
        count += 1
    if count:
        print(f"[scan:copilot_cli] +{count}", flush=True)
    return count


def scan_all_sources(initial: bool = False) -> int:
    total = 0
    total += scan_claude(from_start=False)
    total += scan_puku(from_start=False)
    total += scan_cursor_ai_tracking()
    total += scan_cursor_transcripts()
    total += scan_codex()
    total += scan_antigravity()
    total += scan_copilot_ide()
    total += scan_copilot_cli()
    return total


def source_for_path(path: str) -> str | None:
    """Map a filesystem path to an ingest source id."""
    norm = path.replace("\\", "/")
    if "/.puku-cli/" in norm:
        return "puku_cli"
    if "/.claude/" in norm:
        return "claude_code"
    if "/.cursor/" in norm:
        return "cursor"
    if "/.codex/" in norm:
        return "codex"
    if "/.gemini/antigravity/" in norm:
        return "antigravity"
    if "/github.copilot-chat/" in norm:
        return "copilot_ide"
    if "/.copilot/" in norm:
        return "copilot_cli"
    return None


# ---------------------------------------------------------------------------
# Watchdog — fire immediately when local AI tools write new usage
# ---------------------------------------------------------------------------

def request_push():
    """Wake the push loop so new records hit the backend ASAP."""
    _push_now.set()


class LogHandler(FileSystemEventHandler):
    def _handle(self, path: str, created: bool = False):
        source = source_for_path(path)
        if not source or source not in SOURCES:
            return
        p = Path(path)
        found = 0
        if source == "codex" and path.endswith(".jsonl"):
            found = scan_codex_file(p)
        elif source == "antigravity" and path.endswith("overview.txt"):
            found = scan_antigravity_overview(p)
        elif source in ("claude_code", "puku_cli", "cursor") and path.endswith(".jsonl"):
            found = scan_jsonl_file(p, source, from_start=created or get_offset(str(p)) == 0)
        elif source == "copilot_cli" and path.endswith(".log"):
            found = scan_copilot_cli()
        if found:
            request_push()

    def on_modified(self, event):
        if not event.is_directory:
            self._handle(str(event.src_path), created=False)

    def on_created(self, event):
        if not event.is_directory:
            self._handle(str(event.src_path), created=True)


class CursorDbHandler(FileSystemEventHandler):
    """Cursor writes SQLite (+ WAL). Any change → immediate scan+push."""

    def _maybe_trigger(self, path: str):
        name = Path(path).name.lower()
        if "ai-code-tracking" in name or name.endswith((".db", ".db-wal", ".db-shm")):
            request_push()

    def on_modified(self, event):
        if not event.is_directory:
            self._maybe_trigger(str(event.src_path))

    def on_created(self, event):
        if not event.is_directory:
            self._maybe_trigger(str(event.src_path))


class CopilotDbHandler(FileSystemEventHandler):
    """Copilot Chat session-store.db (+ WAL) → scan + push."""

    def _maybe_trigger(self, path: str):
        name = Path(path).name.lower()
        if "session-store" in name or name.endswith((".db", ".db-wal", ".db-shm")):
            request_push()

    def on_modified(self, event):
        if not event.is_directory:
            self._maybe_trigger(str(event.src_path))

    def on_created(self, event):
        if not event.is_directory:
            self._maybe_trigger(str(event.src_path))


def start_watchdogs():
    observer = Observer()
    watched = 0

    if CLAUDE_PROJECTS.exists() and "claude_code" in SOURCES:
        observer.schedule(LogHandler(), str(CLAUDE_PROJECTS), recursive=True)
        print(f"[watchdog] realtime: {CLAUDE_PROJECTS}", flush=True)
        watched += 1

    if PUKU_PROJECTS.exists() and "puku_cli" in SOURCES:
        observer.schedule(LogHandler(), str(PUKU_PROJECTS), recursive=True)
        print(f"[watchdog] realtime: {PUKU_PROJECTS}", flush=True)
        watched += 1

    if CURSOR_PROJECTS.exists() and "cursor" in SOURCES:
        observer.schedule(LogHandler(), str(CURSOR_PROJECTS), recursive=True)
        print(f"[watchdog] realtime: {CURSOR_PROJECTS}", flush=True)
        watched += 1

    if CURSOR_AI_DIR.exists() and "cursor" in SOURCES:
        observer.schedule(CursorDbHandler(), str(CURSOR_AI_DIR), recursive=False)
        print(f"[watchdog] realtime: {CURSOR_AI_DIR}", flush=True)
        watched += 1

    if CODEX_SESSIONS.exists() and "codex" in SOURCES:
        observer.schedule(LogHandler(), str(CODEX_SESSIONS), recursive=True)
        print(f"[watchdog] realtime: {CODEX_SESSIONS}", flush=True)
        watched += 1

    if ANTIGRAVITY_BRAIN.exists() and "antigravity" in SOURCES:
        observer.schedule(LogHandler(), str(ANTIGRAVITY_BRAIN), recursive=True)
        print(f"[watchdog] realtime: {ANTIGRAVITY_BRAIN}", flush=True)
        watched += 1

    if "copilot_ide" in SOURCES:
        for db in _vscode_style_copilot_dbs():
            parent = db.parent
            if parent.exists():
                observer.schedule(CopilotDbHandler(), str(parent), recursive=False)
                print(f"[watchdog] realtime: {parent}", flush=True)
                watched += 1

    if COPILOT_LOGS.exists() and "copilot_cli" in SOURCES:
        observer.schedule(LogHandler(), str(COPILOT_LOGS), recursive=False)
        print(f"[watchdog] realtime: {COPILOT_LOGS}", flush=True)
        watched += 1

    if watched:
        observer.daemon = True
        observer.start()
    else:
        print("[watchdog] no source dirs found — periodic poll only", flush=True)


# ---------------------------------------------------------------------------
# Backend communication
# ---------------------------------------------------------------------------

def send_heartbeat():
    payload = {
        "deviceId": DEVICE_ID,
        "hostname": HOSTNAME,
        "os":       OS_STR,
        "platform": platform.system().lower(),
    }
    try:
        r = requests.post(
            f"{BACKEND}/api/devices/heartbeat", json=payload, headers=HEADERS, timeout=10
        )
        if r.status_code == 401:
            print(
                "[heartbeat] 401 Unauthorized — agentToken is invalid. "
                "Open dashboard → Setup → Regenerate token, then re-run the installer "
                f"(or: python3 agent.py --write-config < config.json). Data dir: {DATA_DIR}",
                flush=True,
            )
            return
        r.raise_for_status()
    except Exception as exc:
        print(f"[heartbeat] failed: {exc}", flush=True)


_offline_sent = False
_offline_lock = threading.Lock()


def send_offline():
    global _offline_sent
    with _offline_lock:
        if _offline_sent:
            return
        _offline_sent = True
    try:
        r = requests.post(
            f"{BACKEND}/api/devices/offline", headers=HEADERS, timeout=5
        )
        r.raise_for_status()
        print("[offline] reported to backend", flush=True)
    except Exception as exc:
        print(f"[offline] failed: {exc}", flush=True)


CHUNK_SIZE = 200
_retry_buffer: list[dict] = []
_retry_lock   = threading.Lock()


def push_records(records: list[dict]) -> bool:
    if not records:
        return True
    total_inserted = total_skipped = 0
    for i in range(0, len(records), CHUNK_SIZE):
        chunk   = records[i : i + CHUNK_SIZE]
        payload = {"deviceId": DEVICE_ID, "records": chunk}
        try:
            r = requests.post(
                f"{BACKEND}/api/usage/ingest", json=payload, headers=HEADERS, timeout=120
            )
            r.raise_for_status()
            result = r.json()
            total_inserted += result.get("inserted", 0)
            total_skipped  += result.get("skipped",  0)
        except Exception as exc:
            print(f"[push] chunk failed: {exc}", flush=True)
            return False
    if total_inserted or total_skipped:
        print(f"[push] inserted={total_inserted} skipped={total_skipped}", flush=True)
    return True


def flush_queue():
    batch = drain_queue()
    with _retry_lock:
        if _retry_buffer:
            batch = _retry_buffer + batch
            _retry_buffer.clear()
    if not batch:
        return
    ok = push_records(batch)
    if not ok:
        with _retry_lock:
            _retry_buffer.extend(batch)
        print(f"[push] queued {len(batch)} records for retry", flush=True)


# ---------------------------------------------------------------------------
# Background loops
# ---------------------------------------------------------------------------

def _debounce_gather(seconds: float = 0.45):
    """Wait briefly so Claude/Cursor can finish a write burst, then settle."""
    time.sleep(seconds)
    # Collapse rapid re-triggers into one scan
    while _push_now.wait(timeout=0.15):
        _push_now.clear()
        time.sleep(0.15)


def push_loop():
    """
    Realtime path: filesystem/DB change → scan → POST /api/usage/ingest
    Backend emits usage:new over websocket → dashboard refreshes.

    Fallback: still poll every INTERVAL if no events (missed watches, etc.).
    """
    while True:
        triggered = _push_now.wait(timeout=INTERVAL)
        _push_now.clear()

        if triggered:
            _debounce_gather()
            print("[realtime] change detected — scanning & pushing", flush=True)

        # On event OR periodic tick: collect then push immediately
        scan_all_sources()
        flush_queue()


def cursor_fast_poll_loop():
    """
    Extra safety for SQLite sources: poll mtime every few seconds in case
    inotify misses WAL updates on some systems.
    """
    last: dict[str, float] = {}
    while True:
        time.sleep(3)
        paths: list[Path] = []
        if "cursor" in SOURCES and CURSOR_AI_DB.exists():
            paths.append(CURSOR_AI_DB)
        if "copilot_ide" in SOURCES:
            paths.extend(_vscode_style_copilot_dbs())
        for db in paths:
            try:
                mtime = db.stat().st_mtime
                wal = Path(str(db) + "-wal")
                if wal.exists():
                    mtime = max(mtime, wal.stat().st_mtime)
                key = str(db)
                prev = last.get(key, 0.0)
                if mtime > prev:
                    if prev > 0:
                        request_push()
                    last[key] = mtime
            except OSError:
                pass


def heartbeat_loop():
    while True:
        send_heartbeat()
        time.sleep(INTERVAL)


def _handle_stop(signum, _frame):
    print(f"\n[agent] received signal {signum}, stopping...", flush=True)
    send_offline()
    sys.exit(0)


def main():
    print(f"[agent] starting — device={DEVICE_ID} backend={BACKEND}", flush=True)
    print(f"[agent] data_dir={DATA_DIR} (encrypted config)", flush=True)
    print(f"[agent] sources={sorted(SOURCES)}", flush=True)
    print(
        f"[agent] claude={CLAUDE_PROJECTS.exists()} puku={PUKU_PROJECTS.exists()} "
        f"cursor_ai={CURSOR_AI_DB.exists()} codex={CODEX_SESSIONS.exists()} "
        f"antigravity={ANTIGRAVITY_BRAIN.exists()} "
        f"copilot_ide={bool(_vscode_style_copilot_dbs())} "
        f"copilot_cli={COPILOT_LOGS.exists()}",
        flush=True,
    )
    print("[agent] mode=realtime (watch → ingest → websocket dashboard)", flush=True)

    atexit.register(send_offline)
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, _handle_stop)
        except (ValueError, OSError):
            pass

    n = scan_all_sources(initial=True)
    print(f"[init] enqueued {n} records from local sources", flush=True)
    flush_queue()

    start_watchdogs()

    threading.Thread(target=heartbeat_loop, daemon=True).start()
    threading.Thread(target=push_loop, daemon=True).start()
    threading.Thread(target=cursor_fast_poll_loop, daemon=True).start()

    send_heartbeat()
    print(
        "[agent] running — live push on Claude / Puku / Cursor / Codex / "
        "Antigravity / Copilot writes. Ctrl-C to stop.",
        flush=True,
    )
    while True:
        time.sleep(60)


if __name__ == "__main__":
    main()
