"""Screenshot monitor for the desktop frontend."""

from __future__ import annotations

import argparse
import os
import signal
import sys
import threading
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from mss import MSS
from mss.tools import to_png


DEFAULT_INTERVAL_MS = 30_000
SCREENSHOT_ROOT = Path(r"C:\Rigweda_monitor\screenshots")

stop_event = threading.Event()
capture_lock = threading.Lock()


def get_interval_ms() -> int:
    configured_interval = os.getenv("SCREENSHOT_INTERVAL_MS", "")

    try:
        interval_ms = int(configured_interval)
    except ValueError:
        return DEFAULT_INTERVAL_MS

    if interval_ms > 0:
        return interval_ms

    return DEFAULT_INTERVAL_MS


def format_date_parts(date: datetime) -> tuple[str, str]:
    date_folder = date.strftime("%Y_%m_%d")
    milliseconds = f"{date.microsecond // 1000:03d}"
    file_timestamp = date.strftime("%Y_%m_%d_%H_%M_%S") + f"_{milliseconds}"

    return date_folder, file_timestamp


def capture_screenshot() -> Path | None:
    if not capture_lock.acquire(blocking=False):
        return None

    try:
        now = datetime.now()
        date_folder, file_timestamp = format_date_parts(now)
        folder_path = SCREENSHOT_ROOT / date_folder
        file_path = folder_path / f"screenshot_{file_timestamp}.png"

        folder_path.mkdir(parents=True, exist_ok=True)

        with MSS() as screen_capture:
            monitor = screen_capture.monitors[0]
            image = screen_capture.grab(monitor)
            to_png(image.rgb, image.size, output=str(file_path))

        print("Screenshot saved:", flush=True)
        print(file_path, flush=True)
        return file_path
    except Exception as error:
        print("Failed to capture screenshot:", file=sys.stderr, flush=True)
        print(error, file=sys.stderr, flush=True)
        return None
    finally:
        capture_lock.release()


def start_screenshot_monitor() -> None:
    interval_seconds = get_interval_ms() / 1000
    print("Screenshot monitor started", flush=True)

    while not stop_event.wait(interval_seconds):
        capture_screenshot()


def stop_screenshot_monitor(*_: object) -> None:
    stop_event.set()


def listen_for_stop_command() -> None:
    for line in sys.stdin:
        if line.strip().lower() == "stop":
            stop_screenshot_monitor()
            break


def main() -> int:
    load_dotenv()

    parser = argparse.ArgumentParser(description="Capture desktop screenshots.")
    parser.add_argument("--once", action="store_true", help="Capture one screenshot and exit.")
    args = parser.parse_args()

    if args.once:
        return 0 if capture_screenshot() else 1

    signal.signal(signal.SIGINT, stop_screenshot_monitor)
    signal.signal(signal.SIGTERM, stop_screenshot_monitor)

    stdin_thread = threading.Thread(target=listen_for_stop_command, daemon=True)
    stdin_thread.start()

    start_screenshot_monitor()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
