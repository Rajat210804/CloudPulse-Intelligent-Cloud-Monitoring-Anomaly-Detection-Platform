"""Read EC2 CPU usage through your existing AWS credentials."""
import argparse
import os
import time
from datetime import datetime, timedelta, timezone

import boto3
import httpx
from botocore.exceptions import BotoCoreError, ClientError


def latest_cpu(client, instance_id):
    end = datetime.now(timezone.utc)
    result = client.get_metric_statistics(
        Namespace="AWS/EC2", MetricName="CPUUtilization",
        Dimensions=[{"Name": "InstanceId", "Value": instance_id}],
        StartTime=end - timedelta(minutes=20), EndTime=end,
        Period=300, Statistics=["Average"],
    )
    return max(result["Datapoints"], key=lambda row: row["Timestamp"], default=None)


def main():
    parser = argparse.ArgumentParser(description="Send EC2 CPU readings to CloudPulse")
    parser.add_argument("instance_id")
    parser.add_argument("--region", default="us-east-1")
    args = parser.parse_args()
    cloudwatch = boto3.client("cloudwatch", region_name=args.region)
    url = os.getenv("CLOUDPULSE_URL", "http://127.0.0.1:8000").rstrip("/")
    last_sent = None
    with httpx.Client(timeout=10, headers={"X-API-Key": os.getenv("API_KEY", "")}) as client:
        while True:
            try:
                point = latest_cpu(cloudwatch, args.instance_id)
                if point and point["Timestamp"] != last_sent:
                    response = client.post(f"{url}/api/metrics", json={
                        "server": args.instance_id, "cpu": point["Average"],
                    })
                    response.raise_for_status()
                    last_sent = point["Timestamp"]
                    print("EC2 reading saved", flush=True)
                elif not point:
                    print("Waiting for CloudWatch data", flush=True)
            except (BotoCoreError, ClientError, httpx.HTTPError) as error:
                print(f"Could not send reading: {type(error).__name__}", flush=True)
            time.sleep(60)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("AWS collector stopped")
