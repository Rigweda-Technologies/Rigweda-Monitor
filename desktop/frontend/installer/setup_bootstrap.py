"""Single-file setup bootstrap for Rigweda Monitor.

The bootstrap carries the fresh-install zip as bundled data, extracts it to a
temporary directory, and runs the normal installer BAT from that extracted
release folder. The BAT/PS1 pair owns the UAC prompt and scheduled task setup.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path


APP_NAME = "RigwedaMonitor"
BUNDLE_ZIP_NAME = "RigwedaMonitorFreshInstall.zip"
INSTALLER_BAT_NAME = "install-fresh-rigweda-monitor.bat"
INSTALLER_PS1_NAME = "install-fresh-rigweda-monitor.ps1"
SETUP_LOG_PATH = Path(tempfile.gettempdir()) / "RigwedaMonitorSetup.log"


def _log(message: str) -> None:
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with SETUP_LOG_PATH.open("a", encoding="utf-8") as log_file:
        log_file.write(f"{timestamp} {message}\n")


def _resource_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent


def _find_bundle_zip() -> Path:
    candidates = [
        _resource_root() / BUNDLE_ZIP_NAME,
        Path(sys.executable).resolve().parent / BUNDLE_ZIP_NAME,
        Path.cwd() / BUNDLE_ZIP_NAME,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Bundled install archive not found: {BUNDLE_ZIP_NAME}")


def _extract_bundle(bundle_zip: Path) -> Path:
    timestamp = time.strftime("%Y%m%d%H%M%S")
    target_dir = Path(tempfile.gettempdir()) / f"{APP_NAME}Setup-{timestamp}-{os.getpid()}"
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True)
    with zipfile.ZipFile(bundle_zip) as archive:
        archive.extractall(target_dir)
    return target_dir


def _run_installer(extract_dir: Path) -> int:
    installer_ps1 = extract_dir / INSTALLER_PS1_NAME
    if not installer_ps1.exists():
        raise FileNotFoundError(f"Installer PS1 not found after extraction: {installer_ps1}")

    powershell = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    powershell_command = str(powershell if powershell.exists() else "powershell.exe")
    process = subprocess.run(
        [
            powershell_command,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(installer_ps1),
        ],
        cwd=str(extract_dir),
        capture_output=True,
        text=True,
        check=False,
    )
    output = "\n".join(part.strip() for part in (process.stdout, process.stderr) if part and part.strip())
    _log(f"Installer exited with code {process.returncode}.")
    if output:
        _log(output)
    return int(process.returncode)


def main() -> int:
    extract_dir: Path | None = None
    try:
        _log("Setup started.")
        bundle_zip = _find_bundle_zip()
        _log(f"Using bundle zip: {bundle_zip}")
        extract_dir = _extract_bundle(bundle_zip)
        _log(f"Extracted bundle to: {extract_dir}")
        return _run_installer(extract_dir)
    except Exception as error:
        _log(f"Setup failed: {type(error).__name__}: {error}")
        print(f"{APP_NAME} setup failed: {error}", file=sys.stderr)
        input("Press Enter to close...")
        return 1
    finally:
        if extract_dir:
            try:
                shutil.rmtree(extract_dir)
            except OSError:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
