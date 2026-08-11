"""Environment loading helpers for source and PyInstaller runs."""

from __future__ import annotations

import sys
import os
from pathlib import Path

from dotenv import load_dotenv


def load_app_env() -> None:
    candidates = [
        Path.cwd() / ".env",
        Path(__file__).resolve().parents[1] / ".env",
    ]

    if getattr(sys, "frozen", False):
        candidates.extend(
            [
                Path(sys.executable).resolve().parent / ".env",
                Path(getattr(sys, "_MEIPASS", "")) / ".env",
            ]
        )

    for path in candidates:
        if path.exists():
            # The app-specific .env must win over stale Windows environment values.
            load_dotenv(path, override=True)

    # APP_ENV is set by the workspace launcher.  It lets one installation use
    # different local and hosted-backend URLs without editing the shared .env.
    app_env = os.getenv("APP_ENV", "").strip()
    if app_env:
        mode_path = Path(__file__).resolve().parents[1] / f".env.{app_env}"
        if mode_path.exists():
            load_dotenv(mode_path, override=True)


def writable_runtime_path(configured_value: str, fallback_name: str) -> Path:
    """Return a writable runtime directory without requiring administrator access."""
    configured_path = Path(os.path.expandvars(configured_value)).expanduser()
    try:
        configured_path.mkdir(parents=True, exist_ok=True)
        probe = configured_path / f".rigweda-write-probe-{os.getpid()}"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return configured_path
    except OSError:
        fallback = Path(__file__).resolve().parents[1] / ".monitor_runtime" / fallback_name
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback
