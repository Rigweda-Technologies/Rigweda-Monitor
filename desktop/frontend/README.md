# Rigweda Monitor Desktop Agent

Windows desktop client for the Workforce Monitoring HRMS platform. The agent signs an employee in through the HRMS API, stores the returned access token locally, and starts background workers that report monitoring data to the desktop/HRMS backends.

The app is built with Python and `CustomTkinter`. Packaged Windows builds are produced with PyInstaller.

## What It Does

- Authenticates employees against the HRMS backend.
- Registers an elevated interactive Windows Scheduled Task for startup after sign-in or install.
- Runs background monitoring workers after login or saved-session resume.
- Reports activity, app usage, keyboard activity summaries, browser history, laptop health, screenshots, and USB policy status depending on organization monitor settings.
- Listens for monitor setting changes and applies enabled/disabled feature flags at runtime.
- Uses hosted backend URLs by default for packaged builds, while source runs can use local `.env` values.

## Project Layout

```text
desktop/frontend/
|-- app/
|   |-- main.py                    # UI entry point and background host
|   |-- login_view.py              # CustomTkinter login/profile window
|   |-- auth.py                    # HRMS login, session storage, startup registration
|   |-- env.py                     # .env loading and hosted/local URL selection
|   |-- monitor_settings.py        # Feature flag polling/listening
|   |-- activity_monitor.py        # Mouse/activity summaries
|   |-- foreground_app_monitor.py  # Foreground app usage
|   |-- keyboard_monitor.py        # Keyboard worker launcher
|   |-- keyboard_usage_monitor.py  # Keyboard activity summaries
|   |-- browser_history_monitor.py # Browser history sync
|   |-- device_health.py           # Laptop health reports
|   |-- screenshot_monitor.py      # Screenshot worker launcher
|   `-- usb_controller.py          # Windows USB policy enforcement
|-- src/screenshots/               # Screenshot capture/upload implementation
|-- services/background_service.py # Optional legacy Windows service wrapper
|-- installer/                     # Service install and cleanup helpers
|-- tests/                         # Screenshot-focused unit tests
|-- requirements.txt
|-- RigwedaMonitor.spec            # PyInstaller one-file build
|-- RigwedaMonitorFolder.spec      # PyInstaller folder build
|-- build_server_exe.bat
|-- update.ps1
`-- VERSION
```

## Prerequisites

- Windows for the full monitoring experience.
- Python 3.
- Node.js if you use the optional `RigwedaMonitorService` wrapper to run `desktop/backend`.
- A running HRMS backend and desktop monitor backend, or access to the hosted endpoints.

Install Python dependencies:

```sh
pip install -r requirements.txt
```

## Configuration

Create `desktop/frontend/.env` when running from source. Packaged builds can also load `.env`, `.env.server`, or an environment-specific file next to the executable.

Common local development values:

```env
APP_ENV=local
HRMS_BACKEND_URL=http://localhost:8000/api
DESKTOP_BACKEND_URL=http://localhost:3001/api
DESKTOP_START_WINDOWS_SERVICE=false
```

Useful optional values:

```env
RIGWEDA_MONITOR_DATA_ROOT=%LOCALAPPDATA%\rigweda-monitor\data
RIGWEDA_MONITOR_LOG_ROOT=%LOCALAPPDATA%\rigweda-monitor\logs
RIGWEDA_MONITOR_SCREENSHOT_ROOT=%LOCALAPPDATA%\rigweda-monitor\screenshots
SCREENSHOT_INTERVAL_MS=60000
SCREENSHOT_UPLOAD_BATCH_SIZE=5
SCREENSHOT_UPLOAD_CONCURRENCY=2
MOUSE_IDLE_THRESHOLD_SECONDS=60
ACTIVITY_HEARTBEAT_SECONDS=30
APP_USAGE_HEARTBEAT_SECONDS=60
KEYBOARD_SESSION_SNAPSHOT_SECONDS=15
LAPTOP_HEALTH_INTERVAL_SECONDS=300
USB_CONTROL_POLL_SECONDS=60
```

Packaged builds prefer the hosted defaults unless a non-local backend URL is explicitly configured:

- HRMS API: `https://rigweda-hrms-backend.onrender.com/api`
- Desktop monitor API: `https://rigweda-monitor-backend.vercel.app/api`

## Run From Source

From `desktop/frontend`:

```sh
python -m app.main
```

The login window authenticates with HRMS credentials. On success, the agent saves the session under the monitor data directory and launches the background monitor host.

On Windows, the first successful login also verifies that the `RigwedaMonitor` Scheduled Task exists. If the task is missing and the app is not already elevated, Windows shows one UAC prompt for a scoped `--register-startup-task` relaunch. That elevated relaunch registers the task and exits.

To run only the background resume flow:

```sh
python -m app.main --background-start
```

This mode is used by the Scheduled Task at Windows logon. It reads `auth.json` and starts the background workers directly. If no valid saved session exists, it logs the problem and exits without opening the login window.

To manually register the startup task from an elevated shell:

```sh
python -m app.main --register-startup-task
```

Worker-only entry points used internally:

```sh
python -m app.main --screenshot-monitor
python -m app.main --activity-monitor
python -m app.main --keyboard-monitor
```

## Runtime Files

By default, runtime files are written under:

- `%LOCALAPPDATA%\rigweda-monitor\data`
- `%LOCALAPPDATA%\rigweda-monitor\logs`
- `%LOCALAPPDATA%\rigweda-monitor\screenshots`

Important files include:

- `auth.json` - saved email, access token, employee profile, and organization info.
- `startup.log` - startup, monitor, feature flag, and service messages.
- `crash.log` - unhandled exceptions.
- `background_host.lock` - prevents duplicate background monitor hosts.

If the configured runtime directory is not writable, the app falls back to `.monitor_runtime` inside this folder.

## Windows Startup and Privileges

- The app uses a Windows Scheduled Task named `RigwedaMonitor`, not the current user's `Run` registry key.
- The task runs at user logon with the current interactive user, `/IT`, and highest privileges so screenshots, keyboard/activity monitoring, foreground app tracking, and USB policy enforcement stay in the desktop session.
- The task action launches the packaged executable with `--background-start`.
- `register_startup_task()` is idempotent. It first checks `schtasks /Query /TN RigwedaMonitor` and skips when the existing task already points to the current app with `--background-start`.
- If the task is missing after first login, the app requests one scoped UAC elevation using `--register-startup-task`. This elevated process only registers the task and exits.
- Subsequent Windows boots do not show UAC. Task Scheduler starts the app already elevated.
- USB control no longer self-relaunches. If the process is not elevated, USB policy enforcement is skipped and a warning is written to `startup.log` and `usb_control.log`.

Useful task commands:

```bat
schtasks /Query /TN RigwedaMonitor
schtasks /Delete /TN RigwedaMonitor /F
```

The fresh install bundle also registers this task during install:

```bat
scripts\install-fresh-rigweda-monitor.bat
```

The uninstaller removes it:

```bat
scripts\uninstall-rigweda-monitor.bat
```

## Optional Windows Service

`services/background_service.py` is a legacy Windows service wrapper for starting `desktop/backend/src/server.js`.

It is disabled by default. Enable it only when you want the desktop client to start the local desktop backend service:

```env
DESKTOP_START_WINDOWS_SERVICE=true
```

Install the service from an elevated Command Prompt:

```bat
installer\install_service.bat
```

The service requires `pywin32` and Node.js.

## Build

Build scripts/specs are included for PyInstaller:

```bat
build_server_exe.bat
```

Or run PyInstaller directly:

```sh
pyinstaller RigwedaMonitor.spec
pyinstaller RigwedaMonitorFolder.spec
```

Update the version in `VERSION` before producing a release build.

## Tests

Run the desktop frontend tests from the repository root or from this folder:

```sh
python -m pytest desktop/frontend/tests
```

The current tests focus on screenshot identity, commit, and recovery behavior.
