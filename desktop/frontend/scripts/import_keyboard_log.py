"""Backfill app-wise keyboard sessions from keyboard_monitor.log into Postgres."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Iterable

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[1]))
    from app.auth import load_auth_session
    from app.env import writable_runtime_path
else:  # pragma: no cover - import path depends on launch style
    from app.auth import load_auth_session
    from app.env import writable_runtime_path

IST = timezone(timedelta(hours=5, minutes=30))
DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"), "data")
DEFAULT_LOG_FILE = DATA_ROOT.parent / "logs" / "keyboard_monitor.log"
DEFAULT_BACKEND_URL = os.getenv("DESKTOP_BACKEND_URL", "https://rigweda-monitor-backend.vercel.app/api").rstrip("/")
REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ENV_FILE = REPO_ROOT / "desktop" / "backend" / ".env"
HRMS_ENV_FILE = REPO_ROOT / "hrms" / "back-end" / ".env"

HEADER_PREFIX = "APP:"
SEPARATOR_LINE = "=" * 40
WINDOW_TITLE_PREFIX = "VISITING SITE:"
MONITOR_LOG_LINE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[ T].*")


@dataclass
class ParsedSession:
    index: int
    started_at: datetime
    app_name: str
    process_name: str
    window_title: str | None = None
    body_lines: list[str] = field(default_factory=list)
    ended_at: datetime | None = None

    def stable_key(self, device_id: str) -> str:
        body_hash = hashlib.sha1("\n".join(self.body_lines).encode("utf-8", "replace")).hexdigest()
        title_part = self.window_title or ""
        ended_part = self.ended_at.isoformat() if self.ended_at else ""
        return "|".join(
            [
                device_id,
                str(self.index),
                self.started_at.isoformat(),
                ended_part,
                self.process_name,
                self.app_name,
                title_part,
                body_hash,
            ]
        )


def _parse_timestamp(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=IST)


def _normalize_process_name(raw_value: str) -> str:
    value = str(raw_value or "").strip().upper()
    return value or "UNKNOWN.EXE"


def _normalize_app_name(process_name: str) -> str:
    stem = Path(process_name).stem.strip().lower()
    return stem or process_name.lower()


def _normalize_key_name(raw_token: str) -> str:
    token = str(raw_token or "").strip().upper()
    token = token.replace("KEY.", "")
    token = token.replace("LEFT", "").replace("RIGHT", "")
    token = token.replace("_L", "").replace("_R", "")
    token = token.replace("__", "_").strip("_")

    aliases = {
        "CTRL": "CTRL",
        "SHIFT": "SHIFT",
        "ALT": "ALT",
        "META": "META",
        "WINDOWS": "META",
        "CMD": "META",
        "SPACE": "SPACE",
        "TAB": "TAB",
        "ENTER": "ENTER",
        "RETURN": "ENTER",
        "BACKSPACE": "BACKSPACE",
        "DELETE": "DELETE",
        "DEL": "DELETE",
        "ESC": "ESC",
        "ESCAPE": "ESC",
        "UP": "UP",
        "DOWN": "DOWN",
        "LEFT": "LEFT",
        "RIGHT": "RIGHT",
        "HOME": "HOME",
        "END": "END",
        "PAGEUP": "PAGEUP",
        "PAGEDOWN": "PAGEDOWN",
        "INSERT": "INSERT",
        "NUMLOCK": "NUMLOCK",
        "SCROLLLOCK": "SCROLLLOCK",
    }
    if token in aliases:
        return aliases[token]
    if token.startswith("F") and token[1:].isdigit():
        return token
    if token.startswith("VK_"):
        return token
    return token or "UNKNOWN"


def _char_key_name(char: str) -> str:
    if char == " ":
        return "SPACE"
    if char == "\t":
        return "TAB"
    if char == "\n" or char == "\r":
        return "ENTER"
    if len(char) == 1 and char.isalpha():
        return char.upper()
    if len(char) == 1 and char.isdigit():
        return char
    code_point = ord(char)
    if code_point < 32:
        return f"CTRL_{code_point:02X}"
    return char.upper()


def _scan_key_text(text: str) -> tuple[int, list[str]]:
    key_count = 0
    key_names: list[str] = []
    index = 0

    while index < len(text):
        char = text[index]
        if char == "[":
            closing = text.find("]", index + 1)
            if closing != -1:
                token = text[index + 1 : closing]
                key_count += 1
                key_name = _normalize_key_name(token)
                if key_name not in key_names:
                    key_names.append(key_name)
                index = closing + 1
                continue

        if char in {"\n", "\r"}:
            index += 1
            continue

        key_count += 1
        key_name = _char_key_name(char)
        if key_name not in key_names:
            key_names.append(key_name)
        index += 1

    return key_count, key_names


def _scan_typed_text(text: str) -> str:
    typed_chars: list[str] = []
    index = 0

    while index < len(text):
        char = text[index]
        if char == "[":
            closing = text.find("]", index + 1)
            if closing != -1:
                token = _normalize_key_name(text[index + 1 : closing])
                if token == "BACKSPACE":
                    if typed_chars:
                        typed_chars.pop()
                elif token == "TAB":
                    typed_chars.append("\t")
                elif token == "ENTER":
                    typed_chars.append("\n")
                index = closing + 1
                continue

        if char == "\r":
            index += 1
            continue

        if char == "\b":
            if typed_chars:
                typed_chars.pop()
        else:
            typed_chars.append(char)
        index += 1

    return "".join(typed_chars)


def _scan_key_stream_text(text: str) -> str:
    stream_parts: list[str] = []
    index = 0

    while index < len(text):
        char = text[index]
        if char == "[":
            closing = text.find("]", index + 1)
            if closing != -1:
                token = _normalize_key_name(text[index + 1 : closing])
                if token == "SPACE":
                    stream_parts.append(" ")
                elif token in {"ENTER", "RETURN"}:
                    stream_parts.append("\n")
                elif token == "TAB":
                    stream_parts.append("\t")
                elif token == "BACKSPACE":
                    stream_parts.append("[BACKSPACE]")
                else:
                    stream_parts.append(f"[{token}]")
                index = closing + 1
                continue

        if char == "\r":
            index += 1
            continue

        stream_parts.append(char)
        index += 1

    return "".join(stream_parts)


def _is_monitor_log_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    if MONITOR_LOG_LINE_RE.match(stripped):
        return True
    if stripped.startswith(("Traceback ", "File ", "ConnectionRefusedError", "URLError", "TimeoutError", "OSError")):
        return True
    return False


def _load_log_lines(log_file: Path) -> list[str]:
    try:
        return log_file.read_text(encoding="utf-8", errors="replace").splitlines()
    except FileNotFoundError as error:
        raise FileNotFoundError(f"Keyboard log not found: {log_file}") from error


def parse_keyboard_log(log_file: Path) -> list[ParsedSession]:
    lines = _load_log_lines(log_file)
    sessions: list[ParsedSession] = []
    current: ParsedSession | None = None

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped == SEPARATOR_LINE or stripped == "--- App & Website Aware Monitor Online ---" or stripped == "--- Standalone Testing Mode Active ---":
            continue

        if stripped.startswith("[") and "] APP:" in stripped:
            timestamp_text, remainder = stripped.split("] ", 1)
            timestamp_text = timestamp_text.lstrip("[")
            if current is not None:
                current.ended_at = _parse_timestamp(timestamp_text)
                sessions.append(current)

            app_text = remainder.split(HEADER_PREFIX, 1)[1].strip()
            process_name = _normalize_process_name(app_text)
            current = ParsedSession(
                index=len(sessions),
                started_at=_parse_timestamp(timestamp_text),
                app_name=_normalize_app_name(process_name),
                process_name=process_name,
            )
            continue

        if current is None:
            continue

        if stripped.startswith(WINDOW_TITLE_PREFIX):
            current.window_title = stripped[len(WINDOW_TITLE_PREFIX) :].strip() or current.window_title
            continue

        if _is_monitor_log_line(line):
            continue

        current.body_lines.append(line)

    if current is not None:
        sessions.append(current)

    for position, session in enumerate(sessions):
        session.index = position
        if session.ended_at is None:
            session.ended_at = session.started_at

    return sessions


def build_payload(sessions: Iterable[ParsedSession], *, device_id: str) -> dict:
    events = []
    for session in sessions:
        body_text = "\n".join(session.body_lines)
        key_press_count, key_names = _scan_key_text(body_text)
        typed_text = _scan_typed_text(body_text)
        key_stream_text = _scan_key_stream_text(body_text)
        active_seconds = max(int((session.ended_at - session.started_at).total_seconds()), 0) if session.ended_at else 0
        session_id = "app_" + uuid.uuid5(uuid.NAMESPACE_URL, session.stable_key(device_id)).hex

        events.append(
            {
                "sessionId": session_id,
                "deviceId": device_id,
                "observedAt": session.started_at.isoformat(),
                "appName": session.app_name,
                "processName": session.process_name,
                "startedAt": session.started_at.isoformat(),
                "endedAt": session.ended_at.isoformat() if session.ended_at else session.started_at.isoformat(),
                "activeSeconds": active_seconds,
                "keyPressCount": key_press_count,
                "keyNames": key_names,
                "typedText": typed_text,
                "keyStreamText": key_stream_text,
            }
        )

    return {"events": events}


def upload_payload(payload: dict, *, backend_url: str, token: str) -> None:
    request = urllib.request.Request(
        f"{backend_url.rstrip('/')}/app-usage/batch",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60):
        pass


def _default_log_path() -> Path:
    configured = os.getenv("RIGWEDA_MONITOR_KEYBOARD_LOG", "").strip()
    return Path(configured).expanduser() if configured else DEFAULT_LOG_FILE


def _parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return values

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key and value and key not in values:
            values[key] = value
    return values


def _find_database_url() -> str:
    candidates = [
        os.getenv("MONITOR_DATABASE_URL", ""),
        os.getenv("DATABASE_URL", ""),
        os.getenv("PAYROLL_DATABASE_URL", ""),
        _parse_env_file(BACKEND_ENV_FILE).get("MONITOR_DATABASE_URL", ""),
        _parse_env_file(BACKEND_ENV_FILE).get("DATABASE_URL", ""),
        _parse_env_file(HRMS_ENV_FILE).get("MONITOR_DATABASE_URL", ""),
        _parse_env_file(HRMS_ENV_FILE).get("DATABASE_URL", ""),
    ]
    for candidate in candidates:
        value = str(candidate or "").strip()
        if value:
            return value
    return ""


def _read_auth_session_raw() -> dict:
    auth_file = DATA_ROOT / "auth.json"
    try:
        return json.loads(auth_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _extract_employee_context(session: dict) -> tuple[str, str | None]:
    employee = session.get("employee") if isinstance(session.get("employee"), dict) else {}
    organization_id = (
        str(session.get("organizationId") or "").strip()
        or str(employee.get("organizationId") or "").strip()
        or None
    )
    employee_id = (
        str(employee.get("employeeDbId") or "").strip()
        or str(employee.get("employeeId") or "").strip()
        or str(employee.get("id") or "").strip()
        or str(session.get("employeeId") or "").strip()
        or str(session.get("userId") or "").strip()
        or None
    )
    return employee_id or "", organization_id


def _upload_payload_direct(payload: dict, *, database_url: str, session: dict) -> None:
    employee_id, organization_id = _extract_employee_context(session)
    if not employee_id:
        raise RuntimeError("Could not determine employee id for direct Postgres import.")

    node_script = r"""
const fs = require('fs');
const { Pool } = require('pg');

const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const databaseUrl = process.env.DATABASE_URL || '';
const employeeId = process.env.EMPLOYEE_ID || '';
const organizationId = process.env.ORGANIZATION_ID || '';

const normalizedUrl = new URL(databaseUrl);
normalizedUrl.searchParams.delete('sslmode');
normalizedUrl.searchParams.delete('ssl');

const pool = new Pool({
  connectionString: normalizedUrl.toString(),
  ssl: /sslmode=require/i.test(databaseUrl) || /ssl=true/i.test(databaseUrl)
    ? { rejectUnauthorized: false }
    : undefined,
  application_name: 'rigweda-monitor-keyboard-backfill'
});

const run = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const event of payload.events || []) {
      await client.query(
        `
          INSERT INTO monitor_app_usage_sessions (
            session_id, organization_id, employee_id, employee_name, device_id, observed_at,
            app_name, process_name, started_at, ended_at, active_seconds, key_press_count, key_names, typed_text, key_stream_text, upload_status, uploaded_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, 'uploaded', NOW())
          ON CONFLICT (device_id, session_id) DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            employee_id = EXCLUDED.employee_id,
            employee_name = COALESCE(EXCLUDED.employee_name, monitor_app_usage_sessions.employee_name),
            observed_at = EXCLUDED.observed_at,
            app_name = EXCLUDED.app_name,
            process_name = EXCLUDED.process_name,
            started_at = EXCLUDED.started_at,
            ended_at = EXCLUDED.ended_at,
            active_seconds = EXCLUDED.active_seconds,
            key_press_count = EXCLUDED.key_press_count,
            key_names = EXCLUDED.key_names,
            typed_text = EXCLUDED.typed_text,
            key_stream_text = EXCLUDED.key_stream_text,
            upload_status = 'uploaded',
            last_error = NULL,
            uploaded_at = NOW()
        `,
        [
          event.sessionId,
          organizationId || null,
          employeeId,
          event.employeeName || null,
          event.deviceId,
          event.observedAt,
          event.appName,
          event.processName,
          event.startedAt,
          event.endedAt,
          Number(event.activeSeconds || 0),
          Number(event.keyPressCount || 0),
          JSON.stringify(Array.isArray(event.keyNames) ? event.keyNames : []),
          String(event.typedText || ""),
          String(event.keyStreamText || ""),
        ]
      );
    }
    await client.query('COMMIT');
    process.stdout.write(JSON.stringify({ received: (payload.events || []).length }));
  } catch (error) {
    await client.query('ROLLBACK');
    process.stderr.write(String(error && error.stack ? error.stack : error));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
};

run().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
"""

    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    env["EMPLOYEE_ID"] = employee_id
    env["ORGANIZATION_ID"] = organization_id or ""

    result = subprocess.run(
        ["node", "-e", node_script],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        cwd=str(REPO_ROOT / "desktop" / "backend"),
        env=env,
        timeout=120,
        check=False,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip() or result.stdout.strip() or "Direct database import failed."
        raise RuntimeError(stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill keyboard app sessions into Postgres.")
    parser.add_argument("--log-path", default=str(_default_log_path()), help="Path to keyboard_monitor.log")
    parser.add_argument("--backend-url", default=DEFAULT_BACKEND_URL, help="Desktop backend base URL")
    parser.add_argument("--dry-run", action="store_true", help="Parse the log and print a summary without uploading")
    args = parser.parse_args()

    log_path = Path(args.log_path).expanduser()
    sessions = parse_keyboard_log(log_path)
    if not sessions:
        print(f"No app sessions found in {log_path}.")
        return 0

    session = load_auth_session()
    token = str((session or {}).get("token") or "").strip()
    if not token and not args.dry_run:
        print("No saved HRMS auth token was found. Sign in on the desktop app first, or run with --dry-run.")
        return 1

    device_id_file = DATA_ROOT / "device_id.txt"
    try:
        device_id = device_id_file.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        device_id = ""
    if not device_id:
        device_id = f"dev_{uuid.uuid4().hex}"
        device_id_file.parent.mkdir(parents=True, exist_ok=True)
        device_id_file.write_text(device_id, encoding="utf-8")

    payload = build_payload(sessions, device_id=device_id)
    total_keys = sum(int(event["keyPressCount"]) for event in payload["events"])

    print(f"Parsed {len(sessions)} session(s) from {log_path}.")
    print(f"Total key presses: {total_keys}.")

    if args.dry_run:
        first = payload["events"][0]
        print(f"Dry run only. First session: {first['appName']} / {first['processName']} at {first['startedAt']}")
        return 0

    try:
        upload_payload(payload, backend_url=args.backend_url, token=token)
    except urllib.error.HTTPError as error:
        body = ""
        try:
            body = error.read().decode("utf-8", "replace").strip()
        except Exception:
            body = ""
        print(f"Upload failed: HTTP {error.code} {error.reason}")
        if body:
            print(body)
        database_url = _find_database_url()
        if not database_url:
            return 1

        raw_session = _read_auth_session_raw()
        try:
            _upload_payload_direct(payload, database_url=database_url, session=raw_session)
        except Exception as direct_error:
            print(f"Direct database import failed: {direct_error}")
            return 1

        print(f"Imported {len(payload['events'])} session(s) directly into Postgres.")
        return 0
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        print(f"Upload failed: {error}")
        database_url = _find_database_url()
        if not database_url:
            return 1

        raw_session = _read_auth_session_raw()
        try:
            _upload_payload_direct(payload, database_url=database_url, session=raw_session)
        except Exception as direct_error:
            print(f"Direct database import failed: {direct_error}")
            return 1

        print(f"Imported {len(payload['events'])} session(s) directly into Postgres.")
        return 0

    print(f"Imported {len(payload['events'])} session(s) into Postgres via {args.backend_url}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
