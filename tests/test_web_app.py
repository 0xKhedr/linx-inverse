import tempfile
import unittest
from pathlib import Path

from app.dashboard import create_connection, ensure_schema, get_daily_summary, get_series
from app.dashboard import get_dashboard_payload, get_report_payload, get_summary, parse_date_range
from app.web import create_app


SAMPLE_ROWS = [
    (
        "a1", "f1", "u1", "s1", 1, 0, "2026-05-18 00:00:00", "UTC", 0,
        60.0, 0, 99, 1, None, None, None, 1, 0, "2026-05-18 00:00:05", None, None, 0, None, None,
    ),
    (
        "a2", "f2", "u1", "s1", 2, 0, "2026-05-18 12:00:00", "UTC", 0,
        100.0, 0, 95, 1, None, None, None, 1, 0, "2026-05-18 12:00:05", None, None, 0, None, None,
    ),
    (
        "a3", "f3", "u1", "s1", 3, 0, "2026-05-19 00:00:00", "UTC", 0,
        190.0, 1, 88, 0, None, None, None, 0, 1, "2026-05-19 00:00:05", None, None, 1, None, None,
    ),
]

INSERT_SQL = """
INSERT INTO cgmRecords (
    cgmRecordId, frontRecordId, userId, sensorId, autoIncrementColumn, timeOffset,
    appTime, appTimeZone, dstOffset, glucose, status, quality, glucoseIsValid,
    rawOne, rawTwo, rawVc, rawIsValid, eventWarning, appCreateTime, trendValue,
    appTimeOffset, deviceStatus, smooth, smoothState
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


class DashboardQueryTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"
        conn = create_connection(self.db_path, read_only=False)
        ensure_schema(conn)
        conn.executemany(INSERT_SQL, SAMPLE_ROWS)
        conn.commit()
        conn.close()

    def tearDown(self):
        self.temp_dir.cleanup()

    def open_conn(self):
        return create_connection(self.db_path, read_only=True)

    def test_summary_calculations(self):
        conn = self.open_conn()
        try:
            date_range = parse_date_range("2026-05-18 00:00:00", "2026-05-19 00:00:00", conn)
            summary = get_summary(conn, date_range)
        finally:
            conn.close()

        self.assertEqual(summary["metrics"]["recordCount"], 3)
        self.assertEqual(summary["metrics"]["lowCount"], 1)
        self.assertEqual(summary["metrics"]["inRangeCount"], 1)
        self.assertEqual(summary["metrics"]["highCount"], 1)
        self.assertEqual(summary["metrics"]["lowPercent"], 33.33)
        self.assertEqual(summary["metrics"]["inRangePercent"], 33.33)
        self.assertEqual(summary["metrics"]["highPercent"], 33.33)
        self.assertEqual(summary["latest"]["appTime"], "2026-05-19 00:00:00")
        self.assertEqual(summary["quality"]["validCount"], 2)
        self.assertEqual(summary["quality"]["invalidCount"], 1)
        self.assertEqual(summary["quality"]["alertCount"], 1)
        self.assertEqual(len(summary["recentLows"]), 1)
        self.assertEqual(len(summary["recentHighs"]), 1)

    def test_empty_range(self):
        conn = self.open_conn()
        try:
            date_range = parse_date_range("2026-05-20 00:00:00", "2026-05-20 12:00:00", conn)
            summary = get_summary(conn, date_range)
            series = get_series(conn, date_range)
            daily = get_daily_summary(conn, date_range)
        finally:
            conn.close()

        self.assertEqual(summary["metrics"]["recordCount"], 0)
        self.assertIsNone(summary["latest"])
        self.assertEqual(series["points"], [])
        self.assertEqual(daily["days"], [])

    def test_invalid_range_order_raises(self):
        conn = self.open_conn()
        try:
            with self.assertRaises(ValueError):
                parse_date_range("2026-05-19 00:00:00", "2026-05-18 00:00:00", conn)
        finally:
            conn.close()

    def test_dashboard_payload_shape(self):
        conn = self.open_conn()
        try:
            date_range = parse_date_range("2026-05-18 00:00:00", "2026-05-19 00:00:00", conn)
            payload = get_dashboard_payload(conn, date_range)
        finally:
            conn.close()

        self.assertIn("summary", payload)
        self.assertIn("series", payload)
        self.assertIn("daily", payload)
        self.assertEqual(payload["summary"]["metrics"]["recordCount"], 3)
        self.assertEqual(len(payload["series"]["points"]), 3)
        self.assertEqual(len(payload["daily"]["days"]), 2)

    def test_report_payload_shape(self):
        conn = self.open_conn()
        try:
            date_range = parse_date_range("2026-05-18 00:00:00", "2026-05-19 00:00:00", conn)
            payload = get_report_payload(conn, date_range)
        finally:
            conn.close()

        self.assertIn("days", payload)
        self.assertEqual(len(payload["days"]), 2)
        self.assertEqual(payload["days"][0]["day"], "2026-05-18")
        self.assertEqual(len(payload["days"][0]["points"]), 2)


class WebAppApiTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"
        conn = create_connection(self.db_path, read_only=False)
        ensure_schema(conn)
        conn.executemany(INSERT_SQL, SAMPLE_ROWS)
        conn.commit()
        conn.close()
        self.client = create_app(self.db_path).test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_api_routes(self):
        response = self.client.get("/api/dashboard?start=2026-05-18%2000:00:00&end=2026-05-19%2000:00:00")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["summary"]["metrics"]["recordCount"], 3)
        self.assertEqual(len(payload["series"]["points"]), 3)
        self.assertEqual(len(payload["daily"]["days"]), 2)

        response = self.client.get("/api/summary?start=2026-05-18%2000:00:00&end=2026-05-19%2000:00:00")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["metrics"]["recordCount"], 3)

        response = self.client.get("/api/report?start=2026-05-18%2000:00:00&end=2026-05-19%2000:00:00")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.get_json()["days"]), 2)

        response = self.client.get("/api/series?start=2026-05-18%2000:00:00&end=2026-05-19%2000:00:00")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.get_json()["points"]), 3)

        response = self.client.get("/api/daily?start=2026-05-18%2000:00:00&end=2026-05-19%2000:00:00")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.get_json()["days"]), 2)

    def test_invalid_date_returns_400(self):
        response = self.client.get("/api/summary?start=bad&end=2026-05-19%2000:00:00")
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.get_json())

    def test_dashboard_page_renders(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("CGM history from your SQLite store.".encode("utf-8"), response.data)

    def test_report_page_renders(self):
        response = self.client.get("/report?start=2026-05-18%2000:00:00&end=2026-05-19%2000:00:00")
        self.assertEqual(response.status_code, 200)
        self.assertIn("CGM report for the selected period.".encode("utf-8"), response.data)

    def test_dashboard_page_renders_arabic(self):
        response = self.client.get("/?lang=ar")
        self.assertEqual(response.status_code, 200)
        self.assertIn('lang="ar" dir="rtl"'.encode("utf-8"), response.data)
        self.assertIn("سجل الجلوكوز من قاعدة SQLite الخاصة بك.".encode("utf-8"), response.data)

    def test_report_page_renders_arabic(self):
        response = self.client.get("/report?start=2026-05-18%2000:00:00&end=2026-05-19%2000:00:00&lang=ar")
        self.assertEqual(response.status_code, 200)
        self.assertIn('lang="ar" dir="rtl"'.encode("utf-8"), response.data)
        self.assertIn("تقرير الجلوكوز للفترة المحددة.".encode("utf-8"), response.data)


if __name__ == "__main__":
    unittest.main()
