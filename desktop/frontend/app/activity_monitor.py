"""Offline-first mouse activity monitor for the signed-in Windows user."""

from __future__ import annotations

import atexit
import ctypes
import json
import os
import sqlite3
import threading
import time
import traceback
import urllib.error
import urllib.request
import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.auth import load_auth_session
from app.env import HOSTED_DESKTOP_BACKEND_URL, prefer_hosted_backend_url, writable_runtime_path
from app.monitor_settings import get_monitor_feature_flags

DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"), "data")
QUEUE_DB = DATA_ROOT / "activity_queue.db"
LOCK_FILE = DATA_ROOT / "activity_monitor.lock"
LOG_FILE = DATA_ROOT.parent / "logs" / "activity_monitor.log"
DEVICE_ID_FILE = DATA_ROOT / "device_id.txt"
DEFAULT_IDLE_THRESHOLD_SECONDS = max(int(os.getenv("MOUSE_IDLE_THRESHOLD_SECONDS", "60")), 10)
DEFAULT_HEARTBEAT_SECONDS = max(int(os.getenv("ACTIVITY_HEARTBEAT_SECONDS", "30")), 10)
MAX_ACTIVITY_SECONDS = 3600
POLL_SECONDS = 1
STOP_EVENT = threading.Event()
SHUTDOWN_REASON = "running"
SHUTDOWN_REASON_LOGGED = False


def _backend_url_candidates() -> list[str]:
    """Prefer the configured desktop backend, then fall back to hosted service."""
    configured = prefer_hosted_backend_url(
        os.getenv("DESKTOP_BACKEND_URL", HOSTED_DESKTOP_BACKEND_URL),
        hosted_default=HOSTED_DESKTOP_BACKEND_URL,
    )
    hosted = HOSTED_DESKTOP_BACKEND_URL
    candidates = [configured]
    if configured != hosted and not configured.startswith(("http://localhost", "https://localhost", "http://127.0.0.1", "https://127.0.0.1")):
        candidates.append(hosted)
    return list(dict.fromkeys(candidates))


def log_message(message: object, *, exc_info: bool = False) -> None:
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as log_file:
            log_file.write(f"{utc_now()} {message}\n")
            if exc_info:
                traceback.print_exc(file=log_file)
    except OSError:
        pass


def log_exception(message: object, error: BaseException | None = None) -> None:
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as log_file:
            log_file.write(f"{utc_now()} {message}\n")
            if error is not None:
                log_file.write(f"{utc_now()} {type(error).__name__}: {error}\n")
                traceback.print_exception(type(error), error, error.__traceback__, file=log_file)
            else:
                traceback.print_exc(file=log_file)
    except OSError:
        pass


def _set_shutdown_reason(reason: str) -> None:
    global SHUTDOWN_REASON
    clean_reason = str(reason or "").strip() or "unspecified"
    if SHUTDOWN_REASON in ("running", ""):
        SHUTDOWN_REASON = clean_reason


def get_shutdown_reason() -> str:
    return SHUTDOWN_REASON


def _log_shutdown_once() -> None:
    global SHUTDOWN_REASON_LOGGED
    if SHUTDOWN_REASON_LOGGED:
        return
    SHUTDOWN_REASON_LOGGED = True
    log_message(f"Activity monitor exiting. reason={get_shutdown_reason()}")


def _log_shutdown_on_exit() -> None:
    if get_shutdown_reason() != "running":
        _log_shutdown_once()


atexit.register(_log_shutdown_on_exit)


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def get_device_id() -> str:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        value = DEVICE_ID_FILE.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        value = ""
    if not value:
        value = f"dev_{uuid.uuid4().hex}"
        DEVICE_ID_FILE.write_text(value, encoding="utf-8")
    return value


def get_cursor_position() -> tuple[int, int]:
    point = POINT()
    if not ctypes.windll.user32.GetCursorPos(ctypes.byref(point)):
        raise OSError("Windows could not read the mouse cursor position")
    return point.x, point.y


def get_heartbeat_seconds() -> int:
    flags = get_monitor_feature_flags()
    try:
        minutes = max(int(flags.get("mouseHeartbeatMinutes", 1)), 1)
        return minutes * 60
    except (TypeError, ValueError):
        return DEFAULT_HEARTBEAT_SECONDS


def get_idle_threshold_seconds() -> int:
    flags = get_monitor_feature_flags()
    try:
        minutes = max(int(flags.get("mouseIdleThresholdMinutes", 1)), 1)
        return minutes * 60
    except (TypeError, ValueError):
        return DEFAULT_IDLE_THRESHOLD_SECONDS


def get_connection() -> sqlite3.Connection:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(QUEUE_DB)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS activity_events (
          event_id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          status TEXT NOT NULL,
          active_seconds INTEGER NOT NULL DEFAULT 0,
          idle_seconds INTEGER NOT NULL DEFAULT 0,
          sync_status TEXT NOT NULL DEFAULT 'pending',
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.execute("CREATE INDEX IF NOT EXISTS idx_activity_events_sync ON activity_events (sync_status, created_at)")
    return connection


def queue_event(*, device_id: str, status: str, active_seconds: int, idle_seconds: int) -> None:
    active_seconds = max(0, min(int(active_seconds), MAX_ACTIVITY_SECONDS))
    idle_seconds = max(0, min(int(idle_seconds), MAX_ACTIVITY_SECONDS))
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO activity_events (event_id, device_id, observed_at, status, active_seconds, idle_seconds)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (f"act_{uuid.uuid4().hex}", device_id, utc_now(), status, active_seconds, idle_seconds),
        )


def _sanitize_event_row(row: sqlite3.Row) -> dict[str, object]:
    """Keep legacy local rows compatible with the backend validation rules."""
    return {
        "eventId": row["event_id"],
        "deviceId": row["device_id"],
        "observedAt": row["observed_at"],
        "status": row["status"],
        "activeSeconds": max(0, min(int(row["active_seconds"] or 0), MAX_ACTIVITY_SECONDS)),
        "idleSeconds": max(0, min(int(row["idle_seconds"] or 0), MAX_ACTIVITY_SECONDS)),
    }


def _summarize_events(rows: list[sqlite3.Row]) -> str:
    if not rows:
        return "count=0"
    status_counts: dict[str, int] = {}
    for row in rows:
        status = str(row["status"] or "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
    first_seen = rows[0]["observed_at"]
    last_seen = rows[-1]["observed_at"]
    return f"count={len(rows)} status_counts={status_counts} observed_range={first_seen}..{last_seen}"


def pending_events(limit: int = 100) -> list[sqlite3.Row]:
    with get_connection() as connection:
        return connection.execute(
            "SELECT * FROM activity_events WHERE sync_status IN ('pending', 'failed') ORDER BY created_at LIMIT ?", (limit,)
        ).fetchall()


def mark_events(event_ids: list[str], *, status: str, error: str | None = None) -> None:
    if not event_ids:
        return
    with get_connection() as connection:
        if status == "synced":
            connection.executemany("DELETE FROM activity_events WHERE event_id = ?", [(event_id,) for event_id in event_ids])
            return
        connection.executemany(
            "UPDATE activity_events SET sync_status = ?, retry_count = retry_count + ?, last_error = ? WHERE event_id = ?",
            [(status, 1, error, event_id) for event_id in event_ids],
        )


def sync_pending_events() -> bool:
    rows = pending_events()
    if not rows:
        return True
    session = load_auth_session()
    token = str((session or {}).get("token") or "").strip()
    if not token:
        log_message("Activity sync skipped: no saved token.")
        return False
    payload = {"events": [_sanitize_event_row(row) for row in rows]}
    ids = [row["event_id"] for row in rows]
    errors: list[str] = []
    candidates = _backend_url_candidates()

    for backend_url in candidates:
        endpoint = f"{backend_url}/activity-events/batch"
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30):
                pass
            try:
                mark_events(ids, status="synced")
            except Exception as error:
                log_exception("Activity sync succeeded but local cleanup failed.", error)
                return False
            if backend_url != candidates[0]:
                log_message(f"Activity sync completed via fallback backend {backend_url}: {len(ids)} event(s).")
            else:
                log_message(f"Activity sync completed: {len(ids)} event(s).")
            return True
        except urllib.error.HTTPError as error:
            response_body = ""
            try:
                response_body = error.read().decode("utf-8", "replace").strip()
            except Exception:
                response_body = ""
            detail = f"{error} {response_body}".strip()
            errors.append(f"{backend_url}: {detail}")
            if response_body:
                log_message(f"Activity sync response body: {response_body[:2000]}")
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            errors.append(f"{backend_url}: {error}")

    mark_events(ids, status="failed", error=(" | ".join(errors) or "sync failed")[:1000])
    log_exception(
        f"Activity sync failed for {len(rows)} event(s) to any backend. {_summarize_events(rows)}",
        RuntimeError(" | ".join(errors) or "Activity sync failed"),
    )
    return False


def process_exists(pid: int) -> bool:
    try:
        import subprocess

        result = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                (
                    "$p = Get-CimInstance Win32_Process -Filter \"ProcessId = "
                    f"{pid}\" -ErrorAction SilentlyContinue; if ($p) {{ $p.CommandLine }}"
                ),
            ],
            capture_output=True,
            text=True,
            check=False,
            creationflags=0x08000000 if os.name == "nt" else 0,
        )
    except Exception:
        return False

    command_line = result.stdout.lower()
    return "rigwedamonitor" in command_line or "activity_monitor" in command_line


def start_activity_monitor() -> None:
    """Record one-minute activity heartbeats; every record remains durable until the API accepts it."""
    device_id = get_device_id()
    heartbeat_seconds = get_heartbeat_seconds()
    idle_threshold_seconds = get_idle_threshold_seconds()
    log_message(
        f"Activity monitor started. idle_threshold={idle_threshold_seconds}s heartbeat={heartbeat_seconds}s device={device_id}"
    )
    while True:
        try:
            last_position = get_cursor_position()
            break
        except OSError as error:
            log_message(f"Activity monitor waiting for cursor position: {error}")
            time.sleep(2)
    last_moved_at = time.monotonic()
    last_tick = last_moved_at
    last_heartbeat = last_moved_at
    active_seconds = 0.0
    idle_seconds = 0.0
    current_status = "offline"

    try:
        while not STOP_EVENT.is_set():
            if STOP_EVENT.wait(POLL_SECONDS):
                break
            now = time.monotonic()
            elapsed = max(now - last_tick, 0)
            last_tick = now
            try:
                position = get_cursor_position()
            except OSError as error:
                log_message(f"Activity monitor retrying cursor position read: {error}")
                continue
            if position != last_position:
                last_position = position
                last_moved_at = now

            idle_threshold_seconds = get_idle_threshold_seconds()
            next_status = "active" if now - last_moved_at < idle_threshold_seconds else "idle"
            heartbeat_seconds = get_heartbeat_seconds()
            if next_status == "active":
                active_seconds += elapsed
            else:
                idle_seconds += elapsed

            state_changed = next_status != current_status
            heartbeat_due = now - last_heartbeat >= heartbeat_seconds
            if state_changed or heartbeat_due:
                queue_event(
                    device_id=device_id,
                    status=next_status,
                    active_seconds=round(active_seconds),
                    idle_seconds=round(idle_seconds),
                )
                current_status = next_status
                active_seconds = 0.0
                idle_seconds = 0.0
                last_heartbeat = now
                log_message(f"Activity event queued: status={next_status}")
                sync_pending_events()
    finally:
        # The next app launch will replace a stale PID file if this monitor exits unexpectedly.
        if get_shutdown_reason() == "running":
            _set_shutdown_reason("stop event set or loop ended")


def stop_activity_monitor(reason: str = "stop requested") -> None:
    _set_shutdown_reason(reason)
    STOP_EVENT.set()


def main() -> int:
    global SHUTDOWN_REASON, SHUTDOWN_REASON_LOGGED
    SHUTDOWN_REASON = "running"
    SHUTDOWN_REASON_LOGGED = False
    STOP_EVENT.clear()
    flags = get_monitor_feature_flags()
    if not flags.get("mouseEnabled", True):
        log_message("Activity monitor is disabled by Employee Monitor settings.")
        _set_shutdown_reason("disabled by Employee Monitor settings")
        _log_shutdown_once()
        return 0

    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        lock_handle = LOCK_FILE.open("x", encoding="utf-8")
    except FileExistsError:
        try:
            pid = int(LOCK_FILE.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            pid = 0
        if pid and process_exists(pid):
            log_message(f"Activity monitor already running with PID {pid}.")
            return 0
        log_message("Removing stale activity monitor lock.")
        LOCK_FILE.unlink(missing_ok=True)
        lock_handle = LOCK_FILE.open("x", encoding="utf-8")

    lock_handle.write(str(os.getpid()))
    lock_handle.flush()
    try:
        start_activity_monitor()
    except KeyboardInterrupt:
        _set_shutdown_reason("KeyboardInterrupt")
        _log_shutdown_once()
        return 0
    except Exception:
        _set_shutdown_reason("crashed")
        log_exception("Activity monitor crashed.")
        raise
    finally:
        lock_handle.close()
        LOCK_FILE.unlink(missing_ok=True)
        _log_shutdown_once()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
