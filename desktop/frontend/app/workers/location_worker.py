"""Background location reporting worker for Rigweda Monitor."""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone

import requests

from app.auth import DEFAULT_DESKTOP_BACKEND_URL, load_auth_session
from app.device_health import _device_id
from app.utils.location import fetch_current_location

LOGGER = logging.getLogger("rigweda.monitor.location")

DEFAULT_LOCATION_REPORTING_INTERVAL_SECS = 1800
POST_TIMEOUT_SECS = 15


def _reporting_interval_seconds() -> int:
    raw_value = os.getenv("LOCATION_REPORTING_INTERVAL_SECS", str(DEFAULT_LOCATION_REPORTING_INTERVAL_SECS))
    try:
        return max(1, int(raw_value))
    except (TypeError, ValueError):
        LOGGER.warning(
            "Invalid LOCATION_REPORTING_INTERVAL_SECS=%r; using default %s",
            raw_value,
            DEFAULT_LOCATION_REPORTING_INTERVAL_SECS,
        )
        return DEFAULT_LOCATION_REPORTING_INTERVAL_SECS


def _server_url(value: str | None = None) -> str:
    return (
        value
        or os.getenv("SERVER_URL")
        or os.getenv("DESKTOP_BACKEND_URL")
        or os.getenv("MONITOR_BACKEND_URL")
        or DEFAULT_DESKTOP_BACKEND_URL
    ).strip().rstrip("/")


def _token_from_session(session: dict | None) -> str | None:
    token = str((session or {}).get("token") or os.getenv("MONITOR_ACCESS_TOKEN") or "").strip()
    if token.lower().startswith("bearer "):
        token = token.split(" ", 1)[1].strip()
    return token or None


class LocationReportingWorker(threading.Thread):
    """Poll device location and report it to the monitor backend."""

    daemon = True

    def __init__(
        self,
        *,
        device_id: str | None = None,
        server_url: str | None = None,
        session: dict | None = None,
        stop_event: threading.Event | None = None,
    ) -> None:
        super().__init__(name="LocationReportingWorker", daemon=True)
        self.device_id = device_id or os.getenv("CURRENT_AGENT_DEVICE_ID") or _device_id()
        self.server_url = _server_url(server_url)
        self.session = session
        self.stop_event = stop_event or threading.Event()
        self.interval_seconds = _reporting_interval_seconds()

    def _payload(self) -> dict:
        location = fetch_current_location()
        return {
            "device_id": self.device_id,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "latitude": float(location.get("latitude") or 0.0),
            "longitude": float(location.get("longitude") or 0.0),
            "source": str(location.get("source") or "failed"),
            "metadata": {
                "city": location.get("city"),
                "region": location.get("region"),
            },
        }

    def _headers(self) -> dict[str, str]:
        session = self.session or load_auth_session(validate_token=False, hydrate_details=False)
        token = _token_from_session(session)
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def report_once(self) -> bool:
        payload = self._payload()
        try:
            response = requests.post(
                f"{self.server_url}/agents/location",
                json=payload,
                headers=self._headers(),
                timeout=POST_TIMEOUT_SECS,
            )
            response.raise_for_status()
            LOGGER.info("Location report submitted. device_id=%s source=%s", self.device_id, payload["source"])
            return True
        except requests.RequestException as error:
            LOGGER.warning("Location report failed: %s", error)
            return False

    def run(self) -> None:
        LOGGER.info(
            "Location reporting worker started. device_id=%s interval=%ss server=%s",
            self.device_id,
            self.interval_seconds,
            self.server_url,
        )
        while not self.stop_event.is_set():
            try:
                self.report_once()
            except Exception as error:
                LOGGER.exception("Unexpected location worker failure: %s", error)
            self.stop_event.wait(self.interval_seconds)
