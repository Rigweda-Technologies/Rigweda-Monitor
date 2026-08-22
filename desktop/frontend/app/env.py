"""Environment loading helpers for source and PyInstaller runs."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

HOSTED_HRMS_BACKEND_URL = "https://rigweda-hrms-backend.onrender.com/api"
HOSTED_DESKTOP_BACKEND_URL = "https://rigweda-monitor-backend.vercel.app/api"


def load_app_env() -> None:
    base_dir = Path(__file__).resolve().parents[1]
    frozen_dir = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else None
    bundle_dir = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "_MEIPASS", None) else None

    if getattr(sys, "frozen", False):
        # Packaged builds must not inherit the workspace .env, otherwise a local
        # checkout can override the URLs bundled into the EXE.
        candidates = [path / ".env" for path in (frozen_dir, bundle_dir) if path]
        candidates.extend(path / ".env.server" for path in (frozen_dir, bundle_dir) if path)
    else:
        candidates = [
            Path.cwd() / ".env",
            base_dir / ".env",
        ]

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


def is_frozen_app() -> bool:
    return bool(getattr(sys, "frozen", False))


def _is_local_backend_url(url: str) -> bool:
    normalized = url.strip().lower().rstrip("/")
    return normalized.startswith(
        (
            "http://localhost",
            "https://localhost",
            "http://127.0.0.1",
            "https://127.0.0.1",
        )
    )


def prefer_hosted_backend_url(configured_value: str | None, *, hosted_default: str) -> str:
    """Use hosted endpoints for packaged builds unless a non-local override is explicit."""
    configured = str(configured_value or "").strip().rstrip("/")
    if is_frozen_app():
        if configured and not _is_local_backend_url(configured):
            return configured
        return hosted_default
    return configured or hosted_default


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
