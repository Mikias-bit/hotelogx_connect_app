import unittest
from decimal import Decimal
from report_publisher import build_envelope, publish_envelope

class PublisherTests(unittest.TestCase):
    def test_daily_missing_sections_are_failed_not_empty_success(self):
        body = build_envelope({"date": "2026-05-31", "operations": {"vip": {"date": "2026-05-31", "vips": []}}}, "Mercier0001")
        self.assertEqual([r["status"] for r in body["reports"]], ["failed", "complete", "failed"])
        all_failed = build_envelope({"date": "2026-05-31", "operations": {}}, "Mercier0001")
        self.assertTrue(all(r["status"] == "failed" for r in all_failed["reports"]))
    def test_money_is_preserved_as_decimal_text(self):
        body = build_envelope({"date": "2026-05-31", "bills": [{"amount": Decimal("123.4500")}]}, "Mercier0001")
        self.assertEqual(body["reports"][0]["rows"][0]["amount"], "123.4500")
    def test_hotel_scope_must_match_credentials(self):
        body = build_envelope({"date": "2026-05-31", "vips": []}, "Mercier0001")
        with self.assertRaisesRegex(ValueError, "credential"):
            publish_envelope(body, env={"CONNECT_REPORTS_URL": "https://connect.example/api/reports/ingest", "CONNECT_REPORTS_HOTEL_ID": "other", "CONNECT_REPORTS_TOKEN": "secret"})
    def test_retry_reuses_identical_run_and_never_follows_redirects(self):
        body = build_envelope({"date": "2026-05-31", "vips": []}, "Mercier0001")
        calls = []
        def post(url, **kwargs):
            calls.append(kwargs)
            return type("Response", (), {"status_code": 503 if len(calls) == 1 else 200})()
        self.assertTrue(publish_envelope(body, env={"CONNECT_REPORTS_URL": "https://connect.example/api/reports/ingest", "CONNECT_REPORTS_TOKENS": '{"Mercier0001":"secret"}'}, post=post, sleep=lambda _: None))
        self.assertEqual(calls[0]["json"], calls[1]["json"])
        self.assertFalse(calls[0]["allow_redirects"])
    def test_nonretryable_validation_errors_are_reported(self):
        body = build_envelope({"date": "2026-05-31", "tasks": []}, "Mercier0001")
        with self.assertRaisesRegex(RuntimeError, "HTTP 400"):
            publish_envelope(body, env={"CONNECT_REPORTS_URL": "https://connect.example/api/reports/ingest", "CONNECT_REPORTS_TOKENS": '{"Mercier0001":"secret"}'}, post=lambda *a, **k: type("Response", (), {"status_code":400})())

if __name__ == '__main__': unittest.main()
