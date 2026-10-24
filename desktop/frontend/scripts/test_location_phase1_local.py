import json
import logging
import os
import sys
from datetime import datetime, timezone

# Adjust the Python system path to find the core app components relative to this script.
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.utils.location import fetch_current_location


logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("rigweda.monitor.test_location")


def run_phase1_diagnostic():
    logger.info("=== Starting Rigweda Location Monitor Phase 1 Diagnostic ===")

    logger.info("Polling local location subsystem (Windows native with IP fallback)...")
    location_data = fetch_current_location()

    print("\n--- Discovery Phase Result ---")
    print(json.dumps(location_data, indent=2))
    print("------------------------------\n")

    if location_data["source"] == "failed":
        logger.error("Diagnostic Failed: Both Windows CoreLocation and IP fallbacks returned 0.0 coordinates.")
        sys.exit(1)

    logger.info("Location resolution succeeded via mechanism: '%s'", location_data["source"])

    mock_payload = {
        "device_id": "DIAGNOSTIC_TEST_HOST_01",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "latitude": location_data["latitude"],
        "longitude": location_data["longitude"],
        "source": location_data["source"],
        "metadata": {
            "city": location_data["city"],
            "region": location_data["region"],
        },
    }

    server_url = os.environ.get("SERVER_URL", "http://localhost:3000").rstrip("/")
    endpoint_target = f"{server_url}/api/agents/location"

    logger.info("Simulating network worker post request targeting: %s", endpoint_target)

    try:
        import requests

        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer DIAGNOSTIC_MOCK_TOKEN",
        }

        response = requests.post(endpoint_target, json=mock_payload, headers=headers, timeout=5)

        print("\n--- Network Transmission Phase Result ---")
        print(f"HTTP Return Status Code : {response.status_code}")
        print(f"Server Response Body     : {response.text}")
        print("------------------------------------------\n")

        if response.status_code == 200:
            logger.info("E2E Phase 1 integration verification passed successfully!")
        else:
            logger.error(
                "Transport Failure: Ingestion point rejected the transaction with code %s",
                response.status_code,
            )

    except ImportError:
        logger.warning("Skipping transport phase test: 'requests' module not found in this environment layer.")
    except requests.RequestException as error:
        logger.error(
            "Transport Failure: Target backend server at %s is unreachable. "
            "Ensure 'npm run dev' is running. Detail: %s",
            server_url,
            error,
        )


if __name__ == "__main__":
    run_phase1_diagnostic()
