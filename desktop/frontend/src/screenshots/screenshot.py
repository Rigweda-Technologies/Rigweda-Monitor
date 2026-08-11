"""Durable screenshot capture and direct Cloudinary batch upload agent."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import signal
import sqlite3
import sys
import threading
import traceback
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv
from mss import MSS
from mss.tools import to_png
from PIL import ImageGrab

try:
    from app.env import load_app_env, writable_runtime_path
except ImportError:
    load_dotenv()
    writable_runtime_path = None
else:
    load_app_env()

DEFAULT_INTERVAL_MS = 60_000
DEFAULT_BATCH_SIZE = 30
DEFAULT_UPLOAD_CONCURRENCY = 4
if writable_runtime_path:
    SCREENSHOT_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_SCREENSHOT_ROOT", r"C:\Rigweda_monitor\screenshots"), "screenshots")
    DATA_ROOT = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"C:\Rigweda_monitor\data"), "data")
    LOG_DIR = writable_runtime_path(os.getenv("RIGWEDA_MONITOR_LOG_ROOT", str(DATA_ROOT.parent / "logs")), "logs")
else:
    SCREENSHOT_ROOT = Path(os.path.expandvars(os.getenv("RIGWEDA_MONITOR_SCREENSHOT_ROOT", r"C:\Rigweda_monitor\screenshots")))
    DATA_ROOT = Path(os.path.expandvars(os.getenv("RIGWEDA_MONITOR_DATA_ROOT", r"C:\Rigweda_monitor\data")))
    LOG_DIR = Path(os.path.expandvars(os.getenv("RIGWEDA_MONITOR_LOG_ROOT", str(DATA_ROOT.parent / "logs"))))
QUEUE_DB = DATA_ROOT / "screenshot_queue.db"
DEVICE_ID_FILE = DATA_ROOT / "device_id.txt"
AUTH_FILE = DATA_ROOT / "auth.json"
LEGACY_SCREENSHOT_ROOT = Path(r"C:\Rigweda_monitor\screenshots")
LEGACY_DATA_ROOT = Path(r"C:\Rigweda_monitor\data")
MONITOR_LOCK_FILE = DATA_ROOT / "screenshot_monitor.lock"
AGENT_LOG_FILE = LOG_DIR / "screenshot_agent.log"

stop_event = threading.Event()
capture_lock = threading.Lock()
upload_lock = threading.Lock()
process_lock_handle = None


def _can_write_to_console(stream: object) -> bool:
    try:
        return bool(stream) and hasattr(stream, "isatty") and stream.isatty()
    except Exception:
        return False


def log_message(message: object, *, error: bool = False, exc_info: bool = False) -> None:
    """Write monitor output without crashing windowed PyInstaller builds."""
    text = str(message)
    stream = sys.stderr if error else sys.stdout
    try:
        if _can_write_to_console(stream):
            print(text, file=stream, flush=True)
            if exc_info:
                traceback.print_exc(file=stream)
            return
    except Exception:
        pass

    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with AGENT_LOG_FILE.open("a", encoding="utf-8") as log_file:
            log_file.write(f"{datetime.now(UTC).isoformat()} {text}\n")
            if exc_info:
                traceback.print_exc(file=log_file)
    except OSError:
        pass


def _decode_jwt_payload(token: str) -> dict:
    try:
        payload_part = token.split(".")[1]
        payload_part += "=" * (-len(payload_part) % 4)
        return json.loads(base64.urlsafe_b64decode(payload_part.encode("ascii")).decode("utf-8"))
    except Exception:
        return {}


def _token_expiry(token: str) -> int:
    payload = _decode_jwt_payload(token)
    try:
        return int(payload.get("exp") or 0)
    except (TypeError, ValueError):
        return 0


def get_interval_ms() -> int:
    configured_interval = os.getenv("SCREENSHOT_INTERVAL_MS", "")

    try:
        interval_ms = int(configured_interval)
    except ValueError:
        return DEFAULT_INTERVAL_MS

    return interval_ms if interval_ms > 0 else DEFAULT_INTERVAL_MS


def get_batch_size() -> int:
    try:
        batch_size = int(os.getenv("SCREENSHOT_UPLOAD_BATCH_SIZE", ""))
    except ValueError:
        return DEFAULT_BATCH_SIZE

    return min(max(batch_size, 1), 100)


def get_upload_concurrency() -> int:
    try:
        concurrency = int(os.getenv("SCREENSHOT_UPLOAD_CONCURRENCY", ""))
    except ValueError:
        return DEFAULT_UPLOAD_CONCURRENCY

    return min(max(concurrency, 1), 8)


def get_backend_base_url() -> str:
    hrms_url = os.getenv("HRMS_BACKEND_URL", "https://rigweda-hrms-backend.onrender.com/api").strip().rstrip("/")
    if hrms_url.endswith("/api"):
        return f"{hrms_url}/agents"
    return f"{hrms_url}/api/agents"


def get_screenshot_scan_roots() -> list[Path]:
    configured_roots = [
        Path(item.strip())
        for item in os.getenv("RIGWEDA_MONITOR_SCAN_ROOTS", "").split(";")
        if item.strip()
    ]
    roots = [SCREENSHOT_ROOT, LEGACY_SCREENSHOT_ROOT, *configured_roots]
    unique_roots: list[Path] = []
    seen: set[str] = set()

    for root in roots:
        key = str(root).lower()
        if key not in seen:
            seen.add(key)
            unique_roots.append(root)

    return unique_roots


def get_access_token() -> str | None:
    for key in ("MONITOR_ACCESS_TOKEN", "RIGWEDA_ACCESS_TOKEN", "JWT_ACCESS_TOKEN", "ACCESS_TOKEN"):
        value = os.getenv(key, "").strip()
        if value:
            return value

    auth_files = [
        AUTH_FILE,
        LEGACY_DATA_ROOT / "auth.json",
        DATA_ROOT / "auth.json",
    ]
    candidates: list[tuple[int, float, str, Path]] = []

    for auth_file in dict.fromkeys(auth_files):
        try:
            payload = json.loads(auth_file.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            continue

        token = str(payload.get("token") or "").strip()
        if token.lower().startswith("bearer "):
            token = token.split(" ", 1)[1].strip()
        if not token:
            continue

        try:
            modified_at = auth_file.stat().st_mtime
        except OSError:
            modified_at = 0
        candidates.append((_token_expiry(token), modified_at, token, auth_file))

    if not candidates:
        log_message(
            f"No auth token found. Checked: {', '.join(str(path) for path in dict.fromkeys(auth_files))}",
            error=True,
        )
        return None

    candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    expiry, _modified_at, token, auth_file = candidates[0]
    now = int(datetime.now(UTC).timestamp())
    if expiry and expiry <= now:
        log_message(f"Saved auth token is expired in {auth_file}. Please log in again.", error=True)
        return None

    return token


def acquire_process_lock() -> bool:
    global process_lock_handle

    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        process_lock_handle = MONITOR_LOCK_FILE.open("x", encoding="utf-8")
        process_lock_handle.write(str(os.getpid()))
        process_lock_handle.flush()
        return True
    except FileExistsError:
        try:
            pid = int(MONITOR_LOCK_FILE.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            pid = 0

        if pid:
            result = subprocess_run_process_exists(pid)
            if result:
                log_message(f"Screenshot monitor is already running with PID {pid}.")
                return False

        MONITOR_LOCK_FILE.unlink(missing_ok=True)
        process_lock_handle = MONITOR_LOCK_FILE.open("x", encoding="utf-8")
        process_lock_handle.write(str(os.getpid()))
        process_lock_handle.flush()
        return True


def subprocess_run_process_exists(pid: int) -> bool:
    import subprocess

    result = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            f"$p = Get-Process -Id {pid} -ErrorAction SilentlyContinue; if ($p) {{ 'yes' }}",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return "yes" in result.stdout.lower()


def release_process_lock() -> None:
    global process_lock_handle
    if process_lock_handle:
        process_lock_handle.close()
        process_lock_handle = None
    MONITOR_LOCK_FILE.unlink(missing_ok=True)


def get_device_id() -> str:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        existing = DEVICE_ID_FILE.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        existing = ""

    if existing:
        return existing

    device_id = f"dev_{uuid.uuid4().hex}"
    DEVICE_ID_FILE.write_text(device_id, encoding="utf-8")
    return device_id


def get_connection() -> sqlite3.Connection:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(QUEUE_DB)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS screenshots (
          id TEXT PRIMARY KEY,
          captured_at TEXT NOT NULL,
          local_path TEXT NOT NULL,
          original_file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          batch_id TEXT,
          cloudinary_public_id TEXT,
          cloudinary_asset_id TEXT,
          cloudinary_version INTEGER,
          cloudinary_format TEXT,
          cloudinary_url TEXT,
          duplicate_of TEXT,
          local_deleted_at TEXT,
          local_delete_error TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_screenshots_status_created ON screenshots (status, created_at)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_screenshots_local_path ON screenshots (local_path)"
    )
    for column_sql in (
        "ALTER TABLE screenshots ADD COLUMN local_deleted_at TEXT",
        "ALTER TABLE screenshots ADD COLUMN local_delete_error TEXT",
    ):
        try:
            connection.execute(column_sql)
        except sqlite3.OperationalError as error:
            if "duplicate column name" not in str(error).lower():
                raise
    return connection


def read_png_dimensions(path: Path) -> tuple[int, int]:
    try:
        with path.open("rb") as file:
            header = file.read(24)
        if header[:8] == b"\x89PNG\r\n\x1a\n":
            return int.from_bytes(header[16:20], "big"), int.from_bytes(header[20:24], "big")
    except OSError:
        pass
    return 1, 1


def queue_existing_screenshots() -> int:
    """Import old local screenshots so upload order includes the disk backlog."""
    candidates: list[Path] = []
    for root in get_screenshot_scan_roots():
        if root.exists():
            candidates.extend(path for path in root.rglob("*.png") if path.is_file())

    candidates.sort(key=lambda path: path.stat().st_mtime)
    inserted = 0

    with get_connection() as connection:
        for file_path in candidates:
            existing = connection.execute(
                "SELECT 1 FROM screenshots WHERE local_path = ? LIMIT 1",
                (str(file_path),),
            ).fetchone()
            if existing:
                continue

            width, height = read_png_dimensions(file_path)
            captured_at = datetime.fromtimestamp(file_path.stat().st_mtime, UTC).isoformat().replace("+00:00", "Z")
            connection.execute(
                """
                INSERT INTO screenshots (
                  id, captured_at, local_path, original_file_name, mime_type,
                  width, height, sha256, size_bytes
                ) VALUES (?, ?, ?, ?, 'image/png', ?, ?, ?, ?)
                """,
                (
                    f"shot_{uuid.uuid4().hex}",
                    captured_at,
                    str(file_path),
                    file_path.name,
                    width,
                    height,
                    hash_file(file_path),
                    file_path.stat().st_size,
                ),
            )
            inserted += 1

    if inserted:
        log_message(f"Queued {inserted} existing local screenshot(s).")
    return inserted


def format_date_parts(date: datetime) -> tuple[str, str]:
    date_folder = date.strftime("%Y_%m_%d")
    milliseconds = f"{date.microsecond // 1000:03d}"
    file_timestamp = date.strftime("%Y_%m_%d_%H_%M_%S") + f"_{milliseconds}"

    return date_folder, file_timestamp


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def insert_queue_record(
    *,
    screenshot_id: str,
    captured_at: str,
    file_path: Path,
    width: int,
    height: int,
    sha256: str,
    size_bytes: int,
) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO screenshots (
              id, captured_at, local_path, original_file_name, mime_type,
              width, height, sha256, size_bytes
            ) VALUES (?, ?, ?, ?, 'image/png', ?, ?, ?, ?)
            """,
            (
                screenshot_id,
                captured_at,
                str(file_path),
                file_path.name,
                width,
                height,
                sha256,
                size_bytes,
            ),
        )


def capture_screenshot() -> Path | None:
    if not capture_lock.acquire(blocking=False):
        return None

    try:
        now = datetime.now(UTC)
        date_folder, file_timestamp = format_date_parts(now)
        folder_path = SCREENSHOT_ROOT / date_folder
        screenshot_id = f"shot_{uuid.uuid4().hex}"
        file_path = folder_path / f"screenshot_{file_timestamp}_{screenshot_id}.png"

        folder_path.mkdir(parents=True, exist_ok=True)

        try:
            with MSS() as screen_capture:
                monitor = screen_capture.monitors[0]
                raw_image = screen_capture.grab(monitor)
                to_png(raw_image.rgb, raw_image.size, output=str(file_path))
                width = raw_image.width
                height = raw_image.height
        except Exception:
            log_message("MSS screenshot capture failed; retrying with Pillow ImageGrab.", error=True, exc_info=True)
            image = ImageGrab.grab(all_screens=True)
            image.save(file_path)
            width, height = image.size

        sha256 = hash_file(file_path)
        insert_queue_record(
            screenshot_id=screenshot_id,
            captured_at=now.isoformat().replace("+00:00", "Z"),
            file_path=file_path,
            width=width,
            height=height,
            sha256=sha256,
            size_bytes=file_path.stat().st_size,
        )

        log_message(f"Screenshot queued: {file_path}")
        return file_path
    except Exception as error:
        log_message("Failed to capture screenshot:", error=True)
        log_message(error, error=True, exc_info=True)
        return None
    finally:
        capture_lock.release()


def fetch_upload_candidates(limit: int) -> list[sqlite3.Row]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT * FROM screenshots
            WHERE status IN ('pending', 'failed', 'uploading')
            ORDER BY captured_at ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return rows


def mark_rows_failed(rows: list[sqlite3.Row], error: Exception) -> None:
    if not rows:
        return

    with get_connection() as connection:
        connection.executemany(
            """
            UPDATE screenshots
            SET status = 'failed',
                retry_count = retry_count + 1,
                last_error = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            [(str(error)[:1000], row["id"]) for row in rows],
        )


def mark_batch_id(rows: list[sqlite3.Row], batch_id: str) -> None:
    with get_connection() as connection:
        connection.executemany(
            "UPDATE screenshots SET batch_id = ?, status = 'uploading', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [(batch_id, row["id"]) for row in rows],
        )


def mark_rows_invalid(items: list[tuple[str, Exception]]) -> None:
    if not items:
        return

    with get_connection() as connection:
        connection.executemany(
            """
            UPDATE screenshots
            SET status = 'invalid',
                last_error = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            [(str(error)[:1000], screenshot_id) for screenshot_id, error in items],
        )


def post_json(url: str, payload: dict, *, token: str | None = None, timeout: int = 60) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
      headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8")
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} from {url}: {body}") from error


def encode_multipart_form(fields: dict, file_field: str, file_path: Path, mime_type: str) -> tuple[bytes, str]:
    boundary = f"----RigwedaMonitor{uuid.uuid4().hex}"
    chunks: list[bytes] = []

    for key, value in fields.items():
        if value is None:
            continue
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"),
                str(value).encode("utf-8"),
                b"\r\n",
            ]
        )

    file_bytes = file_path.read_bytes()
    chunks.extend(
        [
            f"--{boundary}\r\n".encode("utf-8"),
            f'Content-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"\r\n'.encode("utf-8"),
            f"Content-Type: {mime_type}\r\n\r\n".encode("utf-8"),
            file_bytes,
            b"\r\n",
            f"--{boundary}--\r\n".encode("utf-8"),
        ]
    )

    return b"".join(chunks), boundary


def upload_to_cloudinary(upload_instruction: dict, local_path: Path) -> dict:
    params = upload_instruction["params"]
    body, boundary = encode_multipart_form(
        {"api_key": upload_instruction["apiKey"], **params},
        "file",
        local_path,
        "image/png",
    )
    request = urllib.request.Request(
        upload_instruction["uploadUrl"],
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Cloudinary upload failed with HTTP {error.code}: {body}") from error

    return {
        "clientScreenshotId": upload_instruction["clientScreenshotId"],
        "cloudinaryPublicId": payload.get("public_id") or upload_instruction["cloudinaryPublicId"],
        "cloudinaryAssetId": payload.get("asset_id"),
        "cloudinaryVersion": payload.get("version"),
        "cloudinaryFormat": payload.get("format"),
        "cloudinaryUrl": payload["secure_url"],
        "sizeBytes": payload.get("bytes"),
    }


def update_local_uploaded(upload: dict) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            UPDATE screenshots
            SET status = 'cloudinary_uploaded',
                cloudinary_public_id = ?,
                cloudinary_asset_id = ?,
                cloudinary_version = ?,
                cloudinary_format = ?,
                cloudinary_url = ?,
                last_error = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                upload["cloudinaryPublicId"],
                upload.get("cloudinaryAssetId"),
                upload.get("cloudinaryVersion"),
                upload.get("cloudinaryFormat"),
                upload["cloudinaryUrl"],
                upload["clientScreenshotId"],
            ),
        )


def commit_batch(
    *,
    batch_id: str,
    device_id: str,
    uploaded: list[dict],
    duplicates: list[dict],
    token: str,
) -> None:
    post_json(
        f"{get_backend_base_url()}/screenshot-batches/{batch_id}/complete",
        {"deviceId": device_id, "uploaded": uploaded, "duplicates": duplicates},
        token=token,
        timeout=60,
    )

    completed_ids = [item["clientScreenshotId"] for item in uploaded]
    completed_ids.extend(item["clientScreenshotId"] for item in duplicates)

    with get_connection() as connection:
        local_rows = connection.execute(
            f"SELECT id, local_path FROM screenshots WHERE id IN ({','.join('?' for _ in completed_ids)})",
            completed_ids,
        ).fetchall() if completed_ids else []

        connection.executemany(
            "UPDATE screenshots SET status = 'uploaded', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [(item_id,) for item_id in completed_ids],
        )

        for row in local_rows:
            try:
                Path(row["local_path"]).unlink(missing_ok=True)
                connection.execute(
                    """
                    UPDATE screenshots
                    SET local_deleted_at = CURRENT_TIMESTAMP,
                        local_delete_error = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (row["id"],),
                )
            except OSError as error:
                connection.execute(
                    """
                    UPDATE screenshots
                    SET local_delete_error = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (str(error)[:1000], row["id"]),
                )


def upload_pending_screenshots() -> None:
    if not upload_lock.acquire(blocking=False):
        return

    rows: list[sqlite3.Row] = []
    try:
        token = get_access_token()
        if not token:
            return

        queue_existing_screenshots()
        rows = fetch_upload_candidates(get_batch_size())
        if not rows:
            return

        batch_id = f"batch_{uuid.uuid4().hex}"
        device_id = get_device_id()
        mark_batch_id(rows, batch_id)

        request_payload = {
            "batchId": batch_id,
            "deviceId": device_id,
            "screenshots": [
                {
                    "clientScreenshotId": row["id"],
                    "capturedAt": row["captured_at"],
                    "originalFileName": row["original_file_name"],
                    "mimeType": row["mime_type"],
                    "sha256": row["sha256"],
                    "sizeBytes": row["size_bytes"],
                    "width": row["width"],
                    "height": row["height"],
                }
                for row in rows
            ],
        }

        response_payload = post_json(
            f"{get_backend_base_url()}/screenshot-batches/uploads",
            request_payload,
            token=token,
            timeout=60,
        )
        upload_session = response_payload["data"]

        row_by_id = {row["id"]: row for row in rows}
        uploaded: list[dict] = []
        duplicates: list[dict] = []
        upload_jobs: list[tuple[dict, Path]] = []

        for instruction in upload_session["uploads"]:
            if instruction["status"] == "duplicate":
                duplicates.append(
                    {
                        "clientScreenshotId": instruction["clientScreenshotId"],
                        "duplicateOf": instruction["duplicateOf"],
                    }
                )
                continue

            upload_jobs.append(
                (
                    instruction,
                    Path(row_by_id[instruction["clientScreenshotId"]]["local_path"]),
                )
            )

        invalid_uploads: list[tuple[str, Exception]] = []
        retryable_upload_errors: list[tuple[str, Exception]] = []

        if upload_jobs:
            with ThreadPoolExecutor(max_workers=get_upload_concurrency()) as executor:
                future_to_instruction = {
                    executor.submit(upload_to_cloudinary, instruction, local_path): instruction
                    for instruction, local_path in upload_jobs
                }

                for future in as_completed(future_to_instruction):
                    instruction = future_to_instruction[future]
                    try:
                        upload_result = future.result()
                    except Exception as error:
                        if "Invalid image file" in str(error):
                            invalid_uploads.append((instruction["clientScreenshotId"], error))
                        else:
                            retryable_upload_errors.append((instruction["clientScreenshotId"], error))
                        continue

                    update_local_uploaded(upload_result)
                    uploaded.append(upload_result)

            uploaded.sort(key=lambda item: row_by_id[item["clientScreenshotId"]]["captured_at"])

        mark_rows_invalid(invalid_uploads)

        if uploaded or duplicates:
            commit_batch(
                batch_id=batch_id,
                device_id=device_id,
                uploaded=uploaded,
                duplicates=duplicates,
                token=token,
            )

        if retryable_upload_errors:
            failed_ids = ", ".join(item_id for item_id, _error in retryable_upload_errors)
            raise RuntimeError(f"Retryable upload failure for screenshot(s): {failed_ids}")

        log_message(
            (
                f"Uploaded screenshot batch {batch_id}: "
                f"{len(uploaded)} uploaded, {len(duplicates)} duplicates, "
                f"{len(invalid_uploads)} invalid, "
                f"concurrency={get_upload_concurrency()}"
            )
        )
    except Exception as error:
        log_message("Screenshot upload retry scheduled:", error=True)
        log_message(error, error=True)
        mark_rows_failed(rows, error)
    finally:
        upload_lock.release()


def start_screenshot_monitor() -> None:
    interval_seconds = get_interval_ms() / 1000
    log_message("Screenshot monitor started")
    log_message(f"Data root: {DATA_ROOT}")
    log_message(f"Screenshot root: {SCREENSHOT_ROOT}")
    log_message(f"Backend URL: {get_backend_base_url()}")

    queue_existing_screenshots()
    upload_pending_screenshots()
    capture_screenshot()
    upload_pending_screenshots()
    while not stop_event.wait(interval_seconds):
        upload_pending_screenshots()
        capture_screenshot()
        upload_pending_screenshots()


def stop_screenshot_monitor(*_: object) -> None:
    stop_event.set()


def listen_for_stop_command() -> None:
    for line in sys.stdin:
        if line.strip().lower() == "stop":
            stop_screenshot_monitor()
            break


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture desktop screenshots.")
    parser.add_argument("--once", action="store_true", help="Capture one screenshot and exit.")
    parser.add_argument("--upload-once", action="store_true", help="Upload one pending screenshot batch and exit.")
    args = parser.parse_args()

    if args.once:
        if not acquire_process_lock():
            return 0
        try:
            upload_pending_screenshots()
            captured = capture_screenshot()
            upload_pending_screenshots()
            return 0 if captured else 1
        finally:
            release_process_lock()

    if args.upload_once:
        if not acquire_process_lock():
            return 0
        try:
            upload_pending_screenshots()
            return 0
        finally:
            release_process_lock()

    if not acquire_process_lock():
        return 0

    signal.signal(signal.SIGINT, stop_screenshot_monitor)
    signal.signal(signal.SIGTERM, stop_screenshot_monitor)

    stdin_thread = threading.Thread(target=listen_for_stop_command, daemon=True)
    stdin_thread.start()

    try:
        start_screenshot_monitor()
        return 0
    finally:
        release_process_lock()


if __name__ == "__main__":
    raise SystemExit(main())
