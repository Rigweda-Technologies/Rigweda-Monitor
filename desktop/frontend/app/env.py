"""Environment loading helpers for source and PyInstaller runs."""

from __future__ import annotations

import sys
import os
from pathlib import Path

from dotenv import load_dotenv


def load_app_env() -> None:
    base_dir = Path(__file__).resolve().parents[1]
    frozen_dir = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else None
    bundle_dir = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "_MEIPASS", None) else None

    candidates = [
        Path.cwd() / ".env",
        base_dir / ".env",
    ]

    if getattr(sys, "frozen", False):
        candidates.extend(path / ".env" for path in (frozen_dir, bundle_dir) if path)

    for path in candidates:
        if path.exists():
            # The app-specific .env must win over stale Windows environment values.
            load_dotenv(path, override=True)

    # APP_ENV is set by the workspace launcher.  It lets one installation use
    # different local and hosted-backend URLs without editing the shared .env.
    app_env = os.getenv("APP_ENV", "").strip()
    if not app_env and getattr(sys, "frozen", False):
        # Packaged builds should default to the hosted backend unless the
        # installer or a wrapper explicitly opts into local mode.
        app_env = os.getenv("RIGWEDA_MONITOR_DEFAULT_ENV", "server").strip()
    if app_env:
        mode_candidates = [base_dir / f".env.{app_env}"]
        if getattr(sys, "frozen", False):
            mode_candidates.extend(path / f".env.{app_env}" for path in (frozen_dir, bundle_dir) if path)
        for mode_path in mode_candidates:
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
