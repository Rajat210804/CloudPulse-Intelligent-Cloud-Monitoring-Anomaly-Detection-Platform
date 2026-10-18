"""Add a small, clearly named sample server to the dashboard."""
import os
import random

import httpx


def main():
    randomizer = random.Random(42)
    url = os.getenv("CLOUDPULSE_URL", "http://127.0.0.1:8000").rstrip("/")
    with httpx.Client(timeout=10, headers={"X-API-Key": os.getenv("API_KEY", "")}) as client:
        for index in range(45):
            reading = {
                "server": "demo.server",
                "cpu": 97 if index == 40 else round(randomizer.uniform(18, 42), 1),
                "memory": round(randomizer.uniform(40, 52), 1),
                "disk": round(randomizer.uniform(28, 32), 1),
            }
            client.post(f"{url}/api/metrics", json=reading).raise_for_status()
    print("Added 45 demo readings, including a CPU spike.")


if __name__ == "__main__":
    main()
