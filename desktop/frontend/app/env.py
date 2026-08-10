"""Environment loading helpers for source and PyInstaller runs."""

from __future__ import annotations

import sys
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
            load_dotenv(path, override=False)
