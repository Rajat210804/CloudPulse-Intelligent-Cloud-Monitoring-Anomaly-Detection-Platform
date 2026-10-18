"""Send this machine's resource usage to CloudPulse."""
import os
import socket
import time

import httpx
import psutil


def collect():
    return {
        "server": socket.gethostname(),
        "cpu": psutil.cpu_percent(interval=1),
        "memory": psutil.virtual_memory().percent,
        "disk": psutil.disk_usage("/").percent,
    }


def main():
    url = os.getenv("CLOUDPULSE_URL", "http://127.0.0.1:8000").rstrip("/")
    with httpx.Client(timeout=10, headers={"X-API-Key": os.getenv("API_KEY", "")}) as client:
        while True:
            try:
                response = client.post(f"{url}/api/metrics", json=collect())
                response.raise_for_status()
                print("Reading saved", flush=True)
            except httpx.HTTPError as error:
                print(f"Could not send reading: {type(error).__name__}", flush=True)
            time.sleep(10)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Collector stopped")
