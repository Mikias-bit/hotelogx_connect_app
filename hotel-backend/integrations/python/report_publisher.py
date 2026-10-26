"""Publish daily engine snapshots to Hotelogx Connect; no database credentials required."""
import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
import requests

KINDS = {"housekeeping": "tasks", "vip": "vips", "departure_bills": "bills"}

def build_envelope(result, hotel_id, *, run_id=None, generated_at=None):
    if not hotel_id:
        raise ValueError("An explicit engine hotel ID is required")
    operations = result.get("operations")
    if operations is None:
        operations = {kind: result for kind, key in KINDS.items() if key in result}
    if "operations" not in result and (not operations or not any(kind in operations for kind in KINDS)):
        return None
    reports = []
    for kind, key in KINDS.items():
        section = operations.get(kind)
        if section is None and "operations" not in result:
            continue
        date = (section or {}).get("date") or result.get("date")
        if not date:
            raise ValueError("Report date is required; it must not default to upload day")
        valid = isinstance(section, dict) and isinstance(section.get(key), list) and not section.get("error") and section.get("status") != "failed"
        reports.append({"kind": kind, "date": str(date), "status": "complete" if valid else "failed", "rows": section[key] if valid else []})
    return json.loads(json.dumps({"schema_version": 1, "hotel_id": hotel_id, "run_id": run_id or uuid.uuid4().hex,
            "generated_at": generated_at or datetime.now(timezone.utc).isoformat(), "reports": reports}, default=str))

def publish_envelope(envelope, *, env=None, post=None, sleep=time.sleep):
    env = os.environ if env is None else env
    url = env.get("CONNECT_REPORTS_URL", "").strip()
    if not url:
        return False
    if not url.startswith("https://") or not url.endswith("/api/reports/ingest"):
        raise ValueError("CONNECT_REPORTS_URL must be the HTTPS Connect report ingestion endpoint")
    tokens = json.loads(env.get("CONNECT_REPORTS_TOKENS", "{}"))
    token = tokens.get(envelope["hotel_id"]) if isinstance(tokens, dict) else None
    if not token and env.get("CONNECT_REPORTS_HOTEL_ID") == envelope["hotel_id"]:
        token = env.get("CONNECT_REPORTS_TOKEN")
    if not token:
        raise ValueError("No Connect report credential configured for this engine hotel ID")
    post = post or requests.post
    # The identical envelope is retried, so the backend unique run key prevents duplicates.
    for attempt in range(3):
        try:
            response = post(url, json=envelope, headers={"Authorization": "Bearer " + token}, timeout=(10, 45), allow_redirects=False)
        except requests.RequestException:
            if attempt == 2:
                raise RuntimeError("Connect report upload failed; replay the saved snapshot") from None
        else:
            if 200 <= response.status_code < 300:
                return True
            if response.status_code != 429 and response.status_code < 500:
                raise RuntimeError(f"Connect rejected the report (HTTP {response.status_code}); check hotel mapping and report fields")
            if attempt == 2:
                raise RuntimeError(f"Connect report upload failed (HTTP {response.status_code}); replay the saved snapshot")
        sleep(2 ** attempt)
    return False

def persist_and_publish(result, hotel_id, output_path):
    if not os.getenv("CONNECT_REPORTS_URL"):
        return None
    envelope = build_envelope(result, hotel_id)
    if envelope is None:
        return None
    path = Path(output_path)
    path.write_text(json.dumps(envelope, default=str), encoding="utf-8")
    publish_envelope(envelope)
    return path

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--replay", required=True, help="Saved Connect snapshot JSON; retain its run ID")
    args = parser.parse_args()
    envelope = json.loads(Path(args.replay).read_text(encoding="utf-8"))
    if not publish_envelope(envelope):
        raise SystemExit("CONNECT_REPORTS_URL is not configured")
    print("Daily report snapshot accepted")
