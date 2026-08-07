"""Entry point for the MyApp login front-end."""

from __future__ import annotations

import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[1]))
    from app.login_view import LoginApp
else:  # pragma: no cover - import path depends on launch style
    from .login_view import LoginApp


def main() -> None:
    """Launch the login window."""
    app = LoginApp()
    app.run()


if __name__ == "__main__":
    main()

