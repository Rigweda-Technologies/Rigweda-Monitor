"""Run pywin32's post-install step for Windows service support."""

from __future__ import annotations

import os
import site
import subprocess
import sys


def _candidate_scripts() -> list[str]:
    roots = [
        *site.getsitepackages(),
        site.getusersitepackages(),
        os.path.dirname(sys.executable),
        os.path.join(os.path.dirname(sys.executable), "Scripts"),
    ]
    candidates: list[str] = []
    for root in roots:
        candidates.append(os.path.join(root, "win32", "scripts", "pywin32_postinstall.py"))
        candidates.append(os.path.join(root, "pywin32_postinstall.py"))
    return candidates


def _remove_stale_root_dlls() -> None:
    python_root = os.path.dirname(sys.executable)
    version = f"{sys.version_info.major}{sys.version_info.minor}"
    for name in (f"pywintypes{version}.dll", f"pythoncom{version}.dll"):
        path = os.path.join(python_root, name)
        if not os.path.exists(path):
            continue
        try:
            os.unlink(path)
            print(f"Removed stale {path}")
        except OSError as exc:
            print(f"Warning: could not remove stale {path}: {exc}")


def _service_imports_work() -> bool:
    try:
        import pythoncom  # noqa: F401
        import pywintypes  # noqa: F401
        import servicemanager  # noqa: F401
        import win32serviceutil  # noqa: F401
    except Exception as exc:
        print(f"pywin32 service import check failed: {exc}")
        return False
    return True


def main() -> int:
    _remove_stale_root_dlls()

    script = next((path for path in _candidate_scripts() if os.path.exists(path)), None)
    if script is None:
        print("pywin32_postinstall.py was not found")
        return 1

    result = subprocess.run([sys.executable, script, "-install"], check=False)
    if result.returncode == 0:
        return 0

    if _service_imports_work():
        print("pywin32 post-install returned an error, but service modules import correctly. Continuing.")
        return 0

    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
