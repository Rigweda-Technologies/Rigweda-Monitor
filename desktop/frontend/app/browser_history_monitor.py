import os
import time
import threading
from pathlib import Path

# Low-level Windows hooks for processes and keyboard simulation
import win32gui
import win32process
import win32api
import win32con
import win32clipboard
import psutil

# Pull the path framework matching the rest of your app
from app.env import writable_runtime_path
from app.monitor_settings import get_monitor_feature_flags

# Separate path targets exactly matching your project architecture
DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"), "data")
LOG_DIR = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_LOG_ROOT", str(DATA_ROOT.parent / "logs")), "logs")

# Assign files to their respective target folders
HISTORY_FILE = Path(DATA_ROOT) / "browser_history.log"  # Direct full URLs save here
STATUS_LOG_FILE = Path(LOG_DIR) / "browser_monitor.log"  # Thread status logs here

# Global states to track changes dynamically
last_active_app = None
last_active_title = None
last_active_url = None
_STOP_EVENT = threading.Event()
_MONITOR_THREAD: threading.Thread | None = None


def _get_clipboard_text() -> str:
    try:
        win32clipboard.OpenClipboard()
        try:
            if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):
                return win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)
            if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_TEXT):
                data = win32clipboard.GetClipboardData(win32clipboard.CF_TEXT)
                if isinstance(data, bytes):
                    return data.decode("utf-8", "ignore")
                return str(data)
        finally:
            win32clipboard.CloseClipboard()
    except Exception:
        return ""
    return ""


def _set_clipboard_text(value: str) -> None:
    try:
        win32clipboard.OpenClipboard()
        try:
            win32clipboard.EmptyClipboard()
            win32clipboard.SetClipboardText(value, win32clipboard.CF_UNICODETEXT)
        finally:
            win32clipboard.CloseClipboard()
    except Exception:
        pass


def get_active_window_info() -> tuple[str, str, int]:
    """Returns a tuple containing (executable_name, window_title, window_handle)."""
    try:
        hwnd = win32gui.GetForegroundWindow()
        if hwnd:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            process = psutil.Process(pid)
            return process.name().lower(), win32gui.GetWindowText(hwnd), hwnd
    except Exception:
        pass
    return "unknown_app.exe", "Unknown Application Window", 0


def fetch_full_url_via_shortcut(hwnd) -> str:
    """
    Simulates a rapid, sub-millisecond shortcut query to copy the literal active URL.
    Instantly returns focus to the web page body so user typing isn't interrupted.
    """
    try:
        # Save whatever text the user currently has in their clipboard
        old_clipboard = _get_clipboard_text()
        _set_clipboard_text("")  # Flush buffer

        # 1. Focus the browser address bar (Ctrl + L)
        win32api.keybd_event(win32con.VK_CONTROL, 0, 0, 0)
        win32api.keybd_event(0x4C, 0, 0, 0)  # 'L' key
        time.sleep(0.01)
        win32api.keybd_event(0x4C, 0, win32con.KEYEVENTF_KEYUP, 0)
        win32api.keybd_event(win32con.VK_CONTROL, 0, win32con.KEYEVENTF_KEYUP, 0)

        # 2. Copy the full focused address text string (Ctrl + C)
        win32api.keybd_event(win32con.VK_CONTROL, 0, 0, 0)
        win32api.keybd_event(0x43, 0, 0, 0)  # 'C' key
        time.sleep(0.01)
        win32api.keybd_event(0x43, 0, win32con.KEYEVENTF_KEYUP, 0)
        win32api.keybd_event(win32con.VK_CONTROL, 0, win32con.KEYEVENTF_KEYUP, 0)

        # 3. Instantly drop focus back down to the webpage layout (Escape)
        win32api.keybd_event(win32con.VK_ESCAPE, 0, 0, 0)
        time.sleep(0.005)
        win32api.keybd_event(win32con.VK_ESCAPE, 0, win32con.KEYEVENTF_KEYUP, 0)

        # 4. Extract the literal text string caught inside the clipboard buffer
        copied_url = _get_clipboard_text().strip()

        # Restore the user's original clipboard content immediately
        _set_clipboard_text(old_clipboard)

        if copied_url and ("http" in copied_url or "." in copied_url or "/" in copied_url):
            if not copied_url.startswith(("http://", "https://")):
                copied_url = "https://" + copied_url
            return copied_url
    except Exception:
        pass
    return ""


def write_to_data_folder(text_to_log: str) -> None:
    """Saves raw URL navigation events directly into the data folder."""
    try:
        HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        with HISTORY_FILE.open("a", encoding="utf-8") as f:
            f.write(text_to_log)
    except Exception:
        pass


def write_to_log_folder(text_to_log: str) -> None:
    """Saves thread activity metrics into the log folder."""
    try:
        STATUS_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with STATUS_LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(text_to_log)
    except Exception:
        pass


def check_browser_history():
    """Checks foreground window state and commits literal full URLs to the data file destination."""
    global last_active_app, last_active_title, last_active_url
    
    current_app, current_title, current_hwnd = get_active_window_info()
    target_browsers = ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe"]
    
    if current_app in target_browsers and current_hwnd > 0:
        is_app_changed = current_app != last_active_app
        is_tab_changed = current_title != last_active_title
        
        if is_app_changed or is_tab_changed:
            # Add a slight sleep buffer to let the browser paint the new URL completely before copying
            time.sleep(0.15)
            
            # Fetch the actual, complete URL string sequence with all parameter data
            current_url = fetch_full_url_via_shortcut(current_hwnd)
            
            if current_url:
                last_active_url = current_url
            else:
                last_active_url = "https://browser.internal"

            last_active_app = current_app
            last_active_title = current_title

            timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
            
            # Formats the explicit output structure block matching your requirement
            header = f"\n========================================\n"
            header += f"[{timestamp}] BROWSER: {current_app.upper()}\n"
            if current_title:
                header += f"TITLE: {current_title}\n"
            header += f"URL: {last_active_url}\n"
            header += f"========================================\n"
            
            write_to_data_folder(header)


# --- EXPOSED HOOK FOR BACKGROUND DISPATCH ---

def start_browser_monitor() -> tuple[bool, str]:
    """Runs a background thread monitoring browser urls while keeping separation boundaries clean."""
    try:
        flags = get_monitor_feature_flags()
        if not flags.get("browserHistoryEnabled", False):
            return False, "Browser history monitor is disabled by Employee Monitor settings."

        global _MONITOR_THREAD
        if _MONITOR_THREAD is not None and _MONITOR_THREAD.is_alive():
            return True, "Browser monitor is already running."

        _STOP_EVENT.clear()
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        write_to_log_folder(f"\n[{timestamp}] --- Complete URL Extraction Monitor Thread Initialized ---\n")
        
        def monitor_loop():
            while not _STOP_EVENT.is_set():
                check_browser_history()
                _STOP_EVENT.wait(0.5)

        _MONITOR_THREAD = threading.Thread(target=monitor_loop, name="BrowserHistoryMonitor", daemon=True)
        _MONITOR_THREAD.start()
        return True, "Browser monitor started successfully."
    except Exception as e:
        return False, f"Failed to start browser monitor: {str(e)}"


def stop_browser_monitor() -> None:
    global _MONITOR_THREAD, last_active_app, last_active_title, last_active_url

    _STOP_EVENT.set()
    thread = _MONITOR_THREAD
    if thread is not None and thread.is_alive():
        try:
            thread.join(timeout=2)
        except Exception:
            pass
    _MONITOR_THREAD = None
    last_active_app = None
    last_active_title = None
    last_active_url = None

