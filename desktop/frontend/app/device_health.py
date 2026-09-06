"""Periodic laptop health snapshots for the Rigweda Monitor agent."""

from __future__ import annotations

import json
import os
import platform
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import psutil

from app.auth import _hrms_api_url, load_auth_session
from app.env import writable_runtime_path

DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"%LOCALAPPDATA%\rigweda-monitor\data"), "data")
DEVICE_ID_FILE = DATA_ROOT / "device_id.txt"
REPORT_INTERVAL_SECONDS = max(int(os.getenv("LAPTOP_HEALTH_INTERVAL_SECONDS", "300")), 60)
STOP_EVENT = threading.Event()
REPORT_THREAD: threading.Thread | None = None


def _device_id() -> str:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        value = DEVICE_ID_FILE.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        value = ""
    if not value:
        value = f"dev_{uuid.uuid4().hex}"
        DEVICE_ID_FILE.write_text(value, encoding="utf-8")
    return value


def _agent_version() -> str | None:
    roots = [Path(__file__).resolve().parents[1]]
    if getattr(sys, "frozen", False):
        roots.insert(0, Path(sys.executable).resolve().parent)
    for root in roots:
        for filename in ("version.json", "VERSION"):
            path = root / filename
            try:
                raw = path.read_text(encoding="utf-8").strip()
            except OSError:
                continue
            if filename == "version.json":
                try:
                    raw = str(json.loads(raw).get("version") or "").strip()
                except (TypeError, ValueError):
                    raw = ""
            if raw:
                return raw
    return None


def _temperature() -> float | None:
    try:
        readings = psutil.sensors_temperatures()
    except (AttributeError, OSError):
        return None
    values = [entry.current for items in readings.values() for entry in items if entry.current is not None]
    return round(max(values), 1) if values else None


def _health_payload() -> dict:
    memory = psutil.virtual_memory()
    disks = []
    seen_mounts: set[str] = set()
    for partition in psutil.disk_partitions(all=False):
        mount = str(partition.mountpoint or "").strip()
        if not mount or mount in seen_mounts:
            continue
        seen_mounts.add(mount)
        try:
            usage = psutil.disk_usage(mount)
        except OSError:
            continue
        disks.append({
            "mount": mount,
            "filesystem": partition.fstype or None,
            "totalBytes": usage.total,
            "usedBytes": usage.used,
            "freeBytes": usage.free,
            "usedPercent": usage.percent
        })

    battery = None
    try:
        battery = psutil.sensors_battery()
    except (AttributeError, OSError):
        pass

    return {
        "deviceId": _device_id(),
        "hostname": platform.node(),
        "platform": platform.system(),
        "platformVersion": platform.platform(),
        "agentVersion": _agent_version(),
        "cpuModel": platform.processor() or None,
        "cpuPercent": psutil.cpu_percent(interval=0.5),
        "memoryTotalBytes": memory.total,
        "memoryUsedBytes": memory.used,
        "memoryPercent": memory.percent,
        "disks": disks,
        "temperatureC": _temperature(),
        "batteryPercent": round(battery.percent, 1) if battery else None,
        "batteryCharging": bool(battery.power_plugged) if battery else None,
        "uptimeSeconds": max(0, int(time.time() - psutil.boot_time())),
        "reportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }


def report_health(session: dict | None = None) -> bool:
    session = session or load_auth_session()
    token = str((session or {}).get("token") or "").strip()
    if not token:
        return False
    payload = json.dumps(_health_payload()).encode("utf-8")
    request = urllib.request.Request(
        _hrms_api_url("/agents/health"),
        data=payload,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return 200 <= response.status < 300
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
        return False


def _run(session: dict | None) -> None:
    while not STOP_EVENT.is_set():
        report_health(session)
        STOP_EVENT.wait(REPORT_INTERVAL_SECONDS)


def start_health_reporter(session: dict | None = None) -> None:
    global REPORT_THREAD
    if REPORT_THREAD and REPORT_THREAD.is_alive():
        return
    STOP_EVENT.clear()
    REPORT_THREAD = threading.Thread(target=_run, args=(session,), name="LaptopHealthReporter", daemon=True)
    REPORT_THREAD.start()


def stop_health_reporter() -> None:
    STOP_EVENT.set()
