"""Install the report publisher into the explicitly selected sibling engine checkout."""
from pathlib import Path
import shutil
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--engine-root", required=True)
args = parser.parse_args()
root = Path(args.engine_root).resolve()
if not (root / "main.py").is_file():
    raise SystemExit("Engine checkout not found")
shutil.copyfile(Path(__file__).with_name("report_publisher.py"), root / "services/report_publisher.py")
p = root / "main.py"
s = p.read_text(encoding="utf-8")
if "from services.report_publisher import" not in s:
    s = "from services.report_publisher import build_envelope, publish_envelope\n" + s
    # Single-hotel runs must carry the same explicit ID as multi-hotel runs.
    s = s.replace("_persist_result(result)\n", "_persist_result(result, hotel_id=app.config.hotel_id)\n")
    marker = "    app = None\n    try:\n        hotel_ids = _parse_hotel_ids()"
    if marker not in s:
        raise SystemExit("Cannot locate persistence hook")
    hook = """        # Publish structured data only after preserving the existing JSON/PDF artifacts.
        if os.getenv("CONNECT_REPORTS_URL"):
            envelope = build_envelope(result, hotel_id)
            if envelope:
                snapshot = f"{reports_dir}/connect_{hotel_tag}{timestamp}_{envelope['run_id']}.json"
                with open(snapshot, "w", encoding="utf-8") as handle:
                    json.dump(envelope, handle, default=str)
                _upload_to_gcs(snapshot)
                publish_envelope(envelope)

"""
    s = s.replace(marker, hook + marker)
    # Avoid silent all-clear on partial billing failures when publishing operational data.
    begin = s.index("    async def run_departure_bills_check")
    end = s.index("    async def run_daily_operations", begin)
    section = s[begin:end].replace("category_mapping=self._get_category_mapping(),", "category_mapping=self._get_category_mapping(),\n                strict=bool(os.getenv('CONNECT_REPORTS_URL')),")
    # Only the general departure report needs strict: the separate OTA helper has a different signature.
    first, rest = section.split("ota_balance_items =", 1)
    rest = rest.replace("\n                strict=bool(os.getenv('CONNECT_REPORTS_URL')),", "")
    s = s[:begin] + first + "ota_balance_items =" + rest + s[end:]
    s = s.replace("skip_repeat_guest_lookup=True,", "skip_repeat_guest_lookup=True,\n                strict=bool(os.getenv('CONNECT_REPORTS_URL')),")
    s = s.replace("self.mews_adapter.get_vip_data(target_date)", "self.mews_adapter.get_vip_data(target_date, strict=bool(os.getenv('CONNECT_REPORTS_URL')))")
    # Use the hotel's business date when no explicit report date was supplied.
    s = s.replace("target_date = date.today()", "target_date = self._hotel_today()")
    p.write_text(s, encoding="utf-8")
p = root / "engine/accounting.py"
s = p.read_text(encoding="utf-8")
begin = s.index("async def departure_bills_check(")
end = s.index("async def ota_departure_bills_check(", begin)
section = s[begin:end]
if "strict: bool" not in section:
    section = section.replace("category_mapping: Optional[CategoryMapping] = None,", "category_mapping: Optional[CategoryMapping] = None,\n    strict: bool = False,")
    section = section.replace('        logger.info(\n            "departure_bills_check:', '        if strict and folio_errors:\n            raise RuntimeError("Departure report incomplete: one or more folios could not be checked")\n        logger.info(\n            "departure_bills_check:')
    section = section.replace('logger.error(f"Error in departure_bills_check: {e}")', 'logger.error(f"Error in departure_bills_check: {e}")\n        if strict:\n            raise')
    p.write_text(s[:begin] + section + s[end:], encoding="utf-8")
p = root / "engine/vips.py"
s = p.read_text(encoding="utf-8")
if "strict: bool" not in s:
    s = s.replace("exclude_reservation_ids: list[str] | None = None,", "exclude_reservation_ids: list[str] | None = None,\n    strict: bool = False,")
    s = s.replace("    for account_id in unique_account_ids:\n        result.setdefault", "    if strict and any(account_id not in result for account_id in unique_account_ids):\n        raise RuntimeError('VIP repeat-guest lookup incomplete')\n    for account_id in unique_account_ids:\n        result.setdefault")
    s = s.replace("skip_repeat_guest_lookup: bool = False,", "skip_repeat_guest_lookup: bool = False,\n    strict: bool = False,")
    s = s.replace('logger.error(f"Error generating VIP list: {e}")', 'logger.error(f"Error generating VIP list: {e}")\n        if strict:\n            raise')
    p.write_text(s, encoding="utf-8")
# Forward strict lookup checking for standalone VIP generation too.
p = root / "engine/vips.py"
s = p.read_text(encoding="utf-8")
s = s.replace('exclude_reservation_ids=[r.get("Id") for r in arrivals_raw if r.get("Id")],\n            )', 'exclude_reservation_ids=[r.get("Id") for r in arrivals_raw if r.get("Id")],\n                strict=strict,\n            )')
p.write_text(s, encoding="utf-8")
p = root / "adapters/mews_engine_adapter.py"
s = p.read_text(encoding="utf-8")
if "get_vip_data(self, target_date: date = None, *, strict=False)" not in s:
    s = s.replace("get_vip_data(self, target_date: date = None)", "get_vip_data(self, target_date: date = None, *, strict=False)")
    s = s.replace('logger.warning("Failed to enrich VIP guest names: %s", e)', 'logger.warning("Failed to enrich VIP guest names: %s", e)\n            if strict:\n                raise')
    s = s.replace('exclude_reservation_ids=[r.get("Id") for r in arrivals if r.get("Id")],', 'exclude_reservation_ids=[r.get("Id") for r in arrivals if r.get("Id")],\n            strict=strict,')
    p.write_text(s, encoding="utf-8")
print("Installed report publishing and strict report checks; no production workflows executed.")
