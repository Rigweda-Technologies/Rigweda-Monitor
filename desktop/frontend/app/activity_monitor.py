"""Offline-first mouse activity monitor for the signed-in Windows user."""

from __future__ import annotations

import ctypes
import json
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.auth import load_auth_session
from app.env import writable_runtime_path

DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"C:\Rigweda_monitor\data"), "data")
QUEUE_DB = DATA_ROOT / "activity_queue.db"
LOCK_FILE = DATA_ROOT / "activity_monitor.lock"
DEVICE_ID_FILE = DATA_ROOT / "device_id.txt"
IDLE_THRESHOLD_SECONDS = max(int(os.getenv("MOUSE_IDLE_THRESHOLD_SECONDS", "300")), 10)
HEARTBEAT_SECONDS = max(int(os.getenv("ACTIVITY_HEARTBEAT_SECONDS", "60")), 10)
POLL_SECONDS = 1


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
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO activity_events (event_id, device_id, observed_at, status, active_seconds, idle_seconds)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (f"act_{uuid.uuid4().hex}", device_id, utc_now(), status, active_seconds, idle_seconds),
        )


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
        return False
    backend_url = os.getenv("DESKTOP_BACKEND_URL", "https://rigweda-monitor-backend.vercel.app/api").rstrip("/")
    payload = {"events": [{
        "eventId": row["event_id"], "deviceId": row["device_id"], "observedAt": row["observed_at"],
        "status": row["status"], "activeSeconds": row["active_seconds"], "idleSeconds": row["idle_seconds"],
    } for row in rows]}
    request = urllib.request.Request(
        f"{backend_url}/activity-events/batch", data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"}, method="POST",
    )
    ids = [row["event_id"] for row in rows]
    try:
        with urllib.request.urlopen(request, timeout=30):
            pass
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as error:
        mark_events(ids, status="failed", error=str(error)[:1000])
        return False
    mark_events(ids, status="synced")
    return True


def start_activity_monitor() -> None:
    """Record one-minute activity heartbeats; every record remains durable until the API accepts it."""
    device_id = get_device_id()
    last_position = get_cursor_position()
    last_moved_at = time.monotonic()
    last_tick = last_moved_at
    last_heartbeat = last_moved_at
    active_seconds = 0.0
    idle_seconds = 0.0
    current_status = "offline"

    try:
        while True:
            time.sleep(POLL_SECONDS)
            now = time.monotonic()
            elapsed = max(now - last_tick, 0)
            last_tick = now
            position = get_cursor_position()
            if position != last_position:
                last_position = position
                last_moved_at = now

            next_status = "active" if now - last_moved_at < IDLE_THRESHOLD_SECONDS else "idle"
            if next_status == "active":
                active_seconds += elapsed
            else:
                idle_seconds += elapsed

            state_changed = next_status != current_status
            heartbeat_due = now - last_heartbeat >= HEARTBEAT_SECONDS
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
                sync_pending_events()
    finally:
        # The next app launch will replace a stale PID file if this monitor exits unexpectedly.
        pass


def main() -> int:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        lock_handle = LOCK_FILE.open("x", encoding="utf-8")
    except FileExistsError:
        return 0

    lock_handle.write(str(os.getpid()))
    lock_handle.flush()
    try:
        start_activity_monitor()
    except KeyboardInterrupt:
        return 0
    finally:
        lock_handle.close()
        LOCK_FILE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
