"""Location lookup helpers for the Rigweda Monitor desktop agent using native WinRT bindings."""

from __future__ import annotations

import asyncio
import importlib
import logging
from typing import Any

import requests
from geopy.geocoders import Nominatim

LOGGER = logging.getLogger("rigweda.monitor.location")

WINDOWS_LOCATION_TIMEOUT_SECS = 15
IPINFO_URL = "https://ipinfo.io"
IPINFO_TIMEOUT_SECS = 5


def _empty_location(source: str = "failed") -> dict[str, float | str | None]:
    return {
        "latitude": 0.0,
        "longitude": 0.0,
        "source": source,
        "city": None,
        "region": None,
    }


def _status_name(value: Any) -> str:
    return str(getattr(value, "name", value)).lower()


def _coordinate_value(coordinate: Any, name: str) -> float | None:
    value = getattr(coordinate, name, None)
    if value is None and hasattr(coordinate, "point"):
        point = getattr(coordinate, "point", None)
        position = getattr(point, "position", None)
        value = getattr(position, name, None)
    if value is None:
        return None
    return float(value)


def _reverse_geocode_coordinates(latitude: float, longitude: float) -> tuple[str | None, str | None]:
    """Translates high-accuracy physical coordinates into readable city and region attributes via Nominatim."""
    try:
        geolocator = Nominatim(user_agent="rigweda_monitor_agent")
        location = geolocator.reverse(f"{latitude}, {longitude}", timeout=3)
        
        if location and hasattr(location, "raw"):
            address = location.raw.get("address", {})
            city = address.get("city") or address.get("town") or address.get("village") or address.get("suburb")
            region = address.get("state") or address.get("county")
            
            return (str(city).strip() if city else None, str(region).strip() if region else None)
    except Exception as error:
        LOGGER.debug("Reverse geocode translation skipped: %s", error)
        
    return None, None


async def _fetch_windows_location() -> dict[str, float | str | None]:
    try:
        geolocation = importlib.import_module("winrt.windows.devices.geolocation")
        Geolocator = geolocation.Geolocator
        PositionAccuracy = geolocation.PositionAccuracy
    except ImportError as error:
        raise RuntimeError("winrt geolocation support is not installed") from error

    access_status = await asyncio.wait_for(
        Geolocator.request_access_async(),
        timeout=WINDOWS_LOCATION_TIMEOUT_SECS,
    )
    if "allow" not in _status_name(access_status):
        raise PermissionError(f"Windows location access is not allowed: {access_status}")

    geolocator = Geolocator()
    # Explicitly demand high-accuracy positioning variables from the OS layers
    geolocator.desired_accuracy = PositionAccuracy.HIGH
    geolocator.report_interval = 0

    position = await asyncio.wait_for(
        geolocator.get_geoposition_async(),
        timeout=WINDOWS_LOCATION_TIMEOUT_SECS,
    )
    coordinate = getattr(position, "coordinate", None)
    if coordinate is None:
        raise RuntimeError("Windows location response did not include coordinates")

    latitude = _coordinate_value(coordinate, "latitude")
    longitude = _coordinate_value(coordinate, "longitude")
    if latitude is None or longitude is None:
        raise RuntimeError("Windows location response did not include latitude/longitude")

    city, region = _reverse_geocode_coordinates(latitude, longitude)

    return {
        "latitude": latitude,
        "longitude": longitude,
        "source": "windows_native",
        "city": city,
        "region": region,
    }


def _fetch_ipinfo_location() -> dict[str, float | str | None]:
    response = requests.get(IPINFO_URL, timeout=IPINFO_TIMEOUT_SECS)
    response.raise_for_status()
    payload = response.json()

    loc = str(payload.get("loc") or "").strip()
    if "," not in loc:
        raise ValueError("ipinfo.io response did not include a usable loc field")

    latitude_text, longitude_text = loc.split(",", 1)
    return {
        "latitude": float(latitude_text.strip()),
        "longitude": float(longitude_text.strip()),
        "source": "ip_fallback",
        "city": str(payload.get("city")).strip() if payload.get("city") else None,
        "region": str(payload.get("region")).strip() if payload.get("region") else None,
    }


def fetch_current_location() -> dict[str, float | str | None]:
    """Return true device location using native Windows APIs, falling back to network layers if unavailable."""
    # 1. Query High Accuracy Native Windows API
    try:
        windows_loc = asyncio.run(_fetch_windows_location())
        if windows_loc and windows_loc["latitude"] != 0.0:
            return windows_loc
    except Exception as error:
        LOGGER.debug("Windows native location check skipped: %s", error)

    # 2. Base IP Fallback
    try:
        return _fetch_ipinfo_location()
    except Exception as error:
        LOGGER.warning("All tracking pipelines exhausted: %s", error)

    return _empty_location()
