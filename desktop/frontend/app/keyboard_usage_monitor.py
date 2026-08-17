"""Keyboard monitor that logs app-scoped key activity and syncs it to Postgres."""

from __future__ import annotations

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

import psutil
import win32gui
import win32process
from pynput import keyboard

from app.auth import load_auth_session
from app.env import writable_runtime_path
from app.monitor_settings import get_monitor_feature_flags

DATA_ROOT = writable_runtime_path(
    os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"),
    "data",
)
LOG_DIR = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_LOG_ROOT", str(DATA_ROOT.parent / "logs")), "logs")
QUEUE_DB = DATA_ROOT / "keyboard_app_usage_queue.db"
LOCK_FILE = DATA_ROOT / "keyboard_monitor.lock"
LOG_FILE = LOG_DIR / "keyboard_monitor.log"
DEVICE_ID_FILE = DATA_ROOT / "device_id.txt"
POLL_SECONDS = 0.05
SESSION_SNAPSHOT_SECONDS = 15
DESKTOP_BACKEND_URL = os.getenv("DESKTOP_BACKEND_URL", "https://rigweda-monitor-backend.vercel.app/api").rstrip("/")
TARGET_BROWSER_PROCESSES = {"chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe"}
ENABLE_LOCAL_KEY_TRACE = os.getenv("RIGWEDA_MONITOR_LOCAL_KEY_TRACE", "").strip().lower() in {"1", "true", "yes", "on"}


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def log_message(message: object, *, exc_info: bool = False) -> None:
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as log_file:
            log_file.write(f"{utc_now()} {message}\n")
            if exc_info:
                traceback.print_exc(file=log_file)
    except OSError:
        pass


def log_exception(message: object, error: BaseException | None = None) -> None:
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as log_file:
            log_file.write(f"{utc_now()} {message}\n")
            if error is not None:
                log_file.write(f"{utc_now()} {type(error).__name__}: {error}\n")
                traceback.print_exception(type(error), error, error.__traceback__, file=log_file)
            else:
                traceback.print_exc(file=log_file)
    except OSError:
        pass


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


def _query_foreground_window() -> tuple[str, str, str] | None:
    try:
        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return None

        title = win32gui.GetWindowText(hwnd).strip()
        _thread_id, pid = win32process.GetWindowThreadProcessId(hwnd)
        if not pid:
            return None

        process = psutil.Process(pid)
        process_name = (process.name() or f"pid_{pid}").lower()
        app_name = Path(process_name).stem.lower() or process_name
        return app_name, process_name, title
    except Exception:
        return None


def _key_label(key: object) -> str:
    if hasattr(key, "char") and getattr(key, "char"):
        char = str(getattr(key, "char"))
        if char == " ":
            return "SPACE"
        if char == "\n":
            return "ENTER"
        if len(char) == 1 and char.isalpha():
            return char.upper()
        return char

    name = str(key).replace("Key.", "").strip()
    if not name:
        return "UNKNOWN"

    normalized = name.replace("_l", "").replace("_r", "").replace("left", "").replace("right", "")
    normalized = normalized.replace("__", "_").strip("_").upper()
    return {
        "CTRL": "CTRL",
        "SHIFT": "SHIFT",
        "ALT": "ALT",
        "CMD": "META",
        "WINDOWS": "META",
    }.get(normalized, normalized)


def _key_to_log_text(key: object) -> str:
    if hasattr(key, "char") and getattr(key, "char"):
        return str(getattr(key, "char"))

    key_text = str(key).replace("Key.", "").upper()
    if key_text == "SPACE":
        return " "
    if key_text == "ENTER":
        return "\n[ENTER]\n"
    if key_text == "TAB":
        return "\t"
    if key_text == "BACKSPACE":
        return "[BACKSPACE]"
    return f"[{key_text}]"


def _key_to_typed_text(key: object) -> str | None:
    if hasattr(key, "char") and getattr(key, "char"):
        return str(getattr(key, "char"))

    key_text = str(key).replace("Key.", "").upper()
    if key_text == "SPACE":
        return " "
    if key_text in {"ENTER", "RETURN"}:
        return "\n"
    if key_text == "TAB":
        return "\t"
    if key_text == "BACKSPACE":
        return "\b"
    return None


def _key_to_stream_text(key: object) -> str:
    if hasattr(key, "char") and getattr(key, "char"):
        return str(getattr(key, "char"))

    key_text = str(key).replace("Key.", "").upper()
    if key_text == "SPACE":
        return " "
    if key_text in {"ENTER", "RETURN"}:
        return "\n"
    if key_text == "TAB":
        return "\t"
    if key_text == "BACKSPACE":
        return "[BACKSPACE]"

    normalized = key_text.replace("_L", "").replace("_R", "").replace("LEFT", "").replace("RIGHT", "").strip("_")
    normalized = normalized or key_text
    return f"[{normalized}]"


def _append_unique(values: list[str], item: str) -> None:
    normalized = str(item or "").strip()
    if normalized and normalized not in values:
        values.append(normalized)


def _sanitize_key_names(key_names: object) -> list[str]:
    cleaned: list[str] = []
    for raw_name in key_names if isinstance(key_names, list) else []:
        normalized = str(raw_name or "").strip()
        if normalized and normalized not in cleaned:
            cleaned.append(normalized)
    return cleaned


def _summarize_sessions(rows: list[sqlite3.Row]) -> str:
    if not rows:
        return "count=0"
    app_counts: dict[str, int] = {}
    for row in rows:
        app_name = str(row["app_name"] or "unknown")
        app_counts[app_name] = app_counts.get(app_name, 0) + 1
    return f"count={len(rows)} app_counts={app_counts}"


class KeyboardUsageMonitor:
    def __init__(self) -> None:
        self._stop_event = threading.Event()
        self._state_lock = threading.Lock()
        self._listener: keyboard.Listener | None = None
        self._writer_thread: threading.Thread | None = None
        self._foreground_lock = threading.Lock()
        self._foreground_context: tuple[str, str, str] | None = None
        self._foreground_thread: threading.Thread | None = None
        self._device_id = get_device_id()

        self._current_app: tuple[str, str] | None = None
        self._current_title: str = ""
        self._current_session_id: str | None = None
        self._session_started_at: datetime | None = None
        self._session_last_event_at: datetime | None = None
        self._session_last_snapshot_at: datetime | None = None
        self._session_key_presses = 0
        self._session_key_names: list[str] = []
        self._session_typed_chars: list[str] = []
        self._session_key_stream: list[str] = []
        self._session_header_written = False

    def start(self) -> bool:
        if self._listener is not None and self._listener.is_alive():
            return True

        try:
            DATA_ROOT.mkdir(parents=True, exist_ok=True)
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            self._listener = keyboard.Listener(on_press=self._on_press, on_release=self._on_release)
            self._listener.start()
            self._foreground_thread = threading.Thread(target=self._track_foreground_window, daemon=True)
            self._foreground_thread.start()
            self._writer_thread = threading.Thread(target=self._flush_loop, daemon=True)
            self._writer_thread.start()
            log_message(f"Keyboard app usage monitor started. device={self._device_id}")
            return True
        except Exception as error:
            log_exception("Keyboard app usage monitor failed to start.", error)
            return False

    def stop(self) -> None:
        self._stop_event.set()
        try:
            self._flush_session(ended_reason="shutdown")
        except Exception as error:
            log_exception("Keyboard app usage flush failed during shutdown.", error)

        listener = self._listener
        self._listener = None
        if listener is not None:
            try:
                listener.stop()
            except Exception:
                pass

        foreground_thread = self._foreground_thread
        self._foreground_thread = None
        if foreground_thread is not None and foreground_thread.is_alive():
            try:
                foreground_thread.join(timeout=2)
            except Exception:
                pass

        writer_thread = self._writer_thread
        self._writer_thread = None
        if writer_thread is not None and writer_thread.is_alive():
            try:
                writer_thread.join(timeout=2)
            except Exception:
                pass

    def wait(self) -> None:
        listener = self._listener
        if listener is not None:
            listener.join()

    def _get_connection(self) -> sqlite3.Connection:
        DATA_ROOT.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(QUEUE_DB)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS app_usage_sessions (
              session_id TEXT PRIMARY KEY,
              device_id TEXT NOT NULL,
              observed_at TEXT NOT NULL,
              app_name TEXT NOT NULL,
              process_name TEXT NOT NULL,
              started_at TEXT NOT NULL,
              ended_at TEXT NOT NULL,
              active_seconds INTEGER NOT NULL DEFAULT 0,
              key_press_count INTEGER NOT NULL DEFAULT 0,
              key_names TEXT NOT NULL DEFAULT '[]',
              typed_text TEXT NOT NULL DEFAULT '',
              key_stream_text TEXT NOT NULL DEFAULT '',
              sync_status TEXT NOT NULL DEFAULT 'pending',
              retry_count INTEGER NOT NULL DEFAULT 0,
              last_error TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        columns = {row[1] for row in connection.execute("PRAGMA table_info(app_usage_sessions)")}
        if "key_press_count" not in columns:
            connection.execute("ALTER TABLE app_usage_sessions ADD COLUMN key_press_count INTEGER NOT NULL DEFAULT 0")
        if "key_names" not in columns:
            connection.execute("ALTER TABLE app_usage_sessions ADD COLUMN key_names TEXT NOT NULL DEFAULT '[]'")
            connection.execute("UPDATE app_usage_sessions SET key_names = '[]' WHERE key_names IS NULL")
        if "typed_text" not in columns:
            connection.execute("ALTER TABLE app_usage_sessions ADD COLUMN typed_text TEXT NOT NULL DEFAULT ''")
            connection.execute("UPDATE app_usage_sessions SET typed_text = '' WHERE typed_text IS NULL")
        if "key_stream_text" not in columns:
            connection.execute("ALTER TABLE app_usage_sessions ADD COLUMN key_stream_text TEXT NOT NULL DEFAULT ''")
            connection.execute("UPDATE app_usage_sessions SET key_stream_text = '' WHERE key_stream_text IS NULL")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_sync ON app_usage_sessions (sync_status, created_at)")
        return connection

    def _queue_session(
        self,
        *,
        session_id: str,
        app_name: str,
        process_name: str,
        started_at: str,
        ended_at: str,
        active_seconds: int,
        key_press_count: int,
        key_names: list[str],
        typed_text: str,
        key_stream_text: str,
    ) -> None:
        with self._get_connection() as connection:
            connection.execute(
                """
                INSERT INTO app_usage_sessions (
                  session_id, device_id, observed_at, app_name, process_name,
                  started_at, ended_at, active_seconds, key_press_count, key_names, typed_text, key_stream_text
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                  observed_at = excluded.observed_at,
                  app_name = excluded.app_name,
                  process_name = excluded.process_name,
                  started_at = excluded.started_at,
                  ended_at = excluded.ended_at,
                  active_seconds = excluded.active_seconds,
                  key_press_count = excluded.key_press_count,
                  key_names = excluded.key_names,
                  typed_text = excluded.typed_text,
                  key_stream_text = excluded.key_stream_text,
                  sync_status = 'pending',
                  retry_count = 0,
                  last_error = NULL
                """,
                (
                    session_id,
                    self._device_id,
                    utc_now(),
                    app_name,
                    process_name,
                    started_at,
                    ended_at,
                    active_seconds,
                    key_press_count,
                    json.dumps(key_names, ensure_ascii=False),
                    typed_text,
                    key_stream_text,
                ),
            )

    def _pending_sessions(self, limit: int = 100) -> list[sqlite3.Row]:
        with self._get_connection() as connection:
            return connection.execute(
                "SELECT * FROM app_usage_sessions WHERE sync_status IN ('pending', 'failed') ORDER BY created_at LIMIT ?",
                (limit,),
            ).fetchall()

    def _mark_sessions(self, session_ids: list[str], *, status: str, error: str | None = None) -> None:
        if not session_ids:
            return

        with self._get_connection() as connection:
            if status == "synced":
                connection.executemany(
                    "DELETE FROM app_usage_sessions WHERE session_id = ?",
                    [(session_id,) for session_id in session_ids],
                )
                return

            connection.executemany(
                "UPDATE app_usage_sessions SET sync_status = ?, retry_count = retry_count + ?, last_error = ? WHERE session_id = ?",
                [(status, 1, error, session_id) for session_id in session_ids],
            )

    def _sync_pending_sessions(self) -> bool:
        rows = self._pending_sessions()
        if not rows:
            return True

        session = load_auth_session()
        token = str((session or {}).get("token") or "").strip()
        if not token:
            log_message("Keyboard app usage sync skipped: no saved token.")
            return False

        endpoint = f"{DESKTOP_BACKEND_URL}/app-usage/batch"
        payload = {
            "events": [
                {
                    "sessionId": row["session_id"],
                    "deviceId": row["device_id"],
                    "observedAt": row["observed_at"],
                    "appName": row["app_name"],
                    "processName": row["process_name"],
                    "startedAt": row["started_at"],
                    "endedAt": row["ended_at"],
                    "activeSeconds": row["active_seconds"],
                    "keyPressCount": row["key_press_count"],
                    "keyNames": _sanitize_key_names(json.loads(row["key_names"] or "[]")),
                    "typedText": row["typed_text"] or "",
                    "keyStreamText": row["key_stream_text"] or "",
                }
                for row in rows
            ]
        }

        request = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
            method="POST",
        )
        session_ids = [row["session_id"] for row in rows]

        try:
            with urllib.request.urlopen(request, timeout=30):
                pass
        except urllib.error.HTTPError as error:
            error_body = ""
            try:
                error_body = error.read().decode("utf-8", "replace").strip()
            except Exception:
                error_body = ""
            detail = f"{error} {error_body}".strip()
            self._mark_sessions(session_ids, status="failed", error=detail[:1000])
            log_exception(
                f"Keyboard app usage sync failed for {len(rows)} session(s) to {endpoint}. {_summarize_sessions(rows)}",
                error,
            )
            if error_body:
                log_message(f"Keyboard app usage sync response body: {error_body[:2000]}")
            return False
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            self._mark_sessions(session_ids, status="failed", error=str(error)[:1000])
            log_exception(
                f"Keyboard app usage sync failed for {len(rows)} session(s) to {endpoint}. {_summarize_sessions(rows)}",
                error,
            )
            return False

        try:
            self._mark_sessions(session_ids, status="synced")
        except Exception as error:
            log_exception("Keyboard app usage sync succeeded but local cleanup failed.", error)
            return False
        log_message(f"Keyboard app usage sync completed: {len(session_ids)} session(s).")
        return True

    def _write_header(self, *, app_name: str, process_name: str, title: str) -> None:
        if not ENABLE_LOCAL_KEY_TRACE:
            return
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        header = "\n\n========================================\n"
        header += f"[{timestamp}] APP: {process_name.upper()}\n"
        if process_name in TARGET_BROWSER_PROCESSES and title:
            header += f"VISITING SITE: {title}\n"
        header += "========================================\n"
        try:
            LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
            with LOG_FILE.open("a", encoding="utf-8") as log_file:
                log_file.write(header)
        except OSError:
            pass

    def _write_key(self, key_text: str) -> None:
        if not ENABLE_LOCAL_KEY_TRACE:
            return
        try:
            LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
            with LOG_FILE.open("a", encoding="utf-8") as log_file:
                log_file.write(key_text)
        except OSError:
            pass

    def _start_new_session(self, app_context: tuple[str, str, str], event_time: datetime) -> None:
        self._current_app = (app_context[0], app_context[1])
        self._current_title = app_context[2]
        self._current_session_id = f"app_{uuid.uuid4().hex}"
        self._session_started_at = event_time
        self._session_last_event_at = event_time
        self._session_last_snapshot_at = None
        self._session_key_presses = 0
        self._session_key_names = []
        self._session_typed_chars = []
        self._session_key_stream = []
        self._session_header_written = False

    def _persist_current_session(self, *, force: bool = False) -> bool:
        if not self._current_app or not self._current_session_id or not self._session_started_at or not self._session_last_event_at:
            return False

        if not force and self._session_last_snapshot_at is not None:
            elapsed = (self._session_last_event_at - self._session_last_snapshot_at).total_seconds()
            if elapsed < SESSION_SNAPSHOT_SECONDS:
                return False

        started_at_text = self._session_started_at.isoformat().replace("+00:00", "Z")
        ended_at_text = self._session_last_event_at.isoformat().replace("+00:00", "Z")
        active_seconds = max(int((self._session_last_event_at - self._session_started_at).total_seconds()), 0)
        key_press_count = max(int(self._session_key_presses), 0)
        key_names = list(dict.fromkeys(self._session_key_names))
        typed_text = "".join(self._session_typed_chars)
        key_stream_text = "".join(self._session_key_stream)

        self._queue_session(
            session_id=self._current_session_id,
            app_name=self._current_app[0],
            process_name=self._current_app[1],
            started_at=started_at_text,
            ended_at=ended_at_text,
            active_seconds=active_seconds,
            key_press_count=key_press_count,
            key_names=key_names,
            typed_text=typed_text,
            key_stream_text=key_stream_text,
        )
        self._session_last_snapshot_at = self._session_last_event_at
        self._sync_pending_sessions()
        return True

    def _flush_session(self, *, ended_reason: str) -> None:
        if not self._current_app or not self._session_started_at or not self._session_last_event_at:
            return

        started_at_text = self._session_started_at.isoformat().replace("+00:00", "Z")
        ended_at_text = self._session_last_event_at.isoformat().replace("+00:00", "Z")
        active_seconds = max(int((self._session_last_event_at - self._session_started_at).total_seconds()), 0)
        key_press_count = max(int(self._session_key_presses), 0)
        key_names = list(dict.fromkeys(self._session_key_names))
        typed_text = "".join(self._session_typed_chars)
        key_stream_text = "".join(self._session_key_stream)

        if active_seconds <= 0 and key_press_count <= 0 and not key_names and not typed_text and not key_stream_text:
            self._current_app = None
            self._current_title = ""
            self._session_started_at = None
            self._session_last_event_at = None
            self._session_key_presses = 0
            self._session_key_names = []
            self._session_typed_chars = []
            self._session_key_stream = []
            self._session_header_written = False
            return

        self._queue_session(
            session_id=self._current_session_id,
            app_name=self._current_app[0],
            process_name=self._current_app[1],
            started_at=started_at_text,
            ended_at=ended_at_text,
            active_seconds=active_seconds,
            key_press_count=key_press_count,
            key_names=key_names,
            typed_text=typed_text,
            key_stream_text=key_stream_text,
        )
        log_message(
            f"Keyboard app usage queued: app={self._current_app[0]} process={self._current_app[1]} "
            f"seconds={active_seconds} keys={key_press_count} reason={ended_reason}"
        )
        self._sync_pending_sessions()

        self._current_app = None
        self._current_title = ""
        self._current_session_id = None
        self._session_started_at = None
        self._session_last_event_at = None
        self._session_last_snapshot_at = None
        self._session_key_presses = 0
        self._session_key_names = []
        self._session_typed_chars = []
        self._session_key_stream = []
        self._session_header_written = False

    def _handle_active_app_change(self, app_context: tuple[str, str, str], event_time: datetime) -> None:
        if self._current_app is None:
            self._start_new_session(app_context, event_time)
            return

        current_context = (*self._current_app, self._current_title)
        if app_context[:2] != current_context[:2] or (
            app_context[0] in TARGET_BROWSER_PROCESSES and app_context[2] != self._current_title
        ):
            self._flush_session(ended_reason="app_changed")
            self._start_new_session(app_context, event_time)

    def _track_foreground_window(self) -> None:
        while not self._stop_event.is_set():
            app_context = _query_foreground_window()
            if app_context is not None:
                with self._foreground_lock:
                    self._foreground_context = app_context
            time.sleep(POLL_SECONDS)

    def _flush_loop(self) -> None:
        while not self._stop_event.wait(2):
            try:
                with self._state_lock:
                    if self._current_app is not None:
                        self._persist_current_session()
            except Exception as error:
                log_exception("Keyboard app usage background flush error.", error)

    def _get_foreground_context(self) -> tuple[str, str, str] | None:
        with self._foreground_lock:
            return self._foreground_context

    def _on_press(self, key: object) -> None:
        if self._stop_event.is_set():
            return

        try:
            event_time = datetime.now(UTC)
            key_label = _key_label(key)
            typed_text = _key_to_typed_text(key)
            stream_text = _key_to_stream_text(key)
            log_text = _key_to_log_text(key)
            app_context = self._get_foreground_context() or _query_foreground_window()
            if app_context is None:
                with self._state_lock:
                    if self._current_app is None:
                        return
                    app_context = (*self._current_app, self._current_title)

            header_to_write: tuple[str, str, str] | None = None
            with self._state_lock:
                self._handle_active_app_change(app_context, event_time)
                if self._current_app is None:
                    self._start_new_session(app_context, event_time)

                if not self._session_header_written:
                    self._session_header_written = True
                    header_to_write = app_context

                self._session_last_event_at = event_time
                self._session_key_presses += 1
                _append_unique(self._session_key_names, key_label)
                self._session_key_stream.append(stream_text)
                if typed_text == "\b":
                    if self._session_typed_chars:
                        self._session_typed_chars.pop()
                elif typed_text is not None:
                    self._session_typed_chars.append(typed_text)
            if header_to_write is not None:
                self._write_header(app_name=header_to_write[0], process_name=header_to_write[1], title=header_to_write[2])
            self._write_key(log_text)
        except Exception as error:
            log_exception("Keyboard app usage monitor error.", error)

    def _on_release(self, key: object) -> None:
        return

    def run(self) -> int:
        try:
            while not self._stop_event.is_set():
                time.sleep(POLL_SECONDS)
        finally:
            self.stop()
        return 0


_keyboard_monitor: KeyboardUsageMonitor | None = None


def start_keyboard_monitor() -> tuple[bool, str]:
    global _keyboard_monitor

    flags = get_monitor_feature_flags()
    if not flags.get("keyboardEnabled", True):
        return False, "Keyboard monitor is disabled by Employee Monitor settings."

    if _keyboard_monitor is not None and _keyboard_monitor._listener is not None and _keyboard_monitor._listener.is_alive():
        return True, "Keyboard monitor is already running."

    _keyboard_monitor = KeyboardUsageMonitor()
    if _keyboard_monitor.start():
        return True, "Keyboard monitor started and syncing to Postgres."
    return False, "Keyboard monitor failed to start."


def stop_keyboard_monitor() -> None:
    global _keyboard_monitor

    monitor = _keyboard_monitor
    if monitor is None:
        return
    try:
        monitor.stop()
    except Exception:
        pass


def main() -> int:
    global _keyboard_monitor

    flags = get_monitor_feature_flags()
    if not flags.get("keyboardEnabled", True):
        log_message("Keyboard monitor is disabled by Employee Monitor settings.")
        return 0

    _keyboard_monitor = KeyboardUsageMonitor()
    if not _keyboard_monitor.start():
        return 1

    try:
        _keyboard_monitor.wait()
    except KeyboardInterrupt:
        return 0
    finally:
        _keyboard_monitor.stop()
    return 0
