from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


DB_PATH = Path("resources/database.db")
DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S"
LOW_THRESHOLD = 70.0
HIGH_THRESHOLD = 180.0

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS cgmRecords (
    cgmRecordId TEXT PRIMARY KEY,
    frontRecordId TEXT NOT NULL,
    userId TEXT NOT NULL,
    sensorId TEXT NOT NULL,
    autoIncrementColumn INTEGER,
    timeOffset INTEGER,
    appTime TEXT NOT NULL,
    appTimeZone TEXT,
    dstOffset INTEGER,
    glucose REAL,
    status INTEGER,
    quality INTEGER,
    glucoseIsValid INTEGER,
    rawOne REAL,
    rawTwo REAL,
    rawVc REAL,
    rawIsValid INTEGER,
    eventWarning INTEGER,
    appCreateTime TEXT,
    trendValue REAL,
    appTimeOffset INTEGER,
    deviceStatus INTEGER,
    smooth REAL,
    smoothState INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cgmRecords_appTime
ON cgmRecords(appTime);
"""


class DashboardError(ValueError):
    pass


@dataclass(frozen=True)
class DateRange:
    start: datetime
    end: datetime


def create_connection(db_path: Path | str = DB_PATH, read_only: bool = True) -> sqlite3.Connection:
    path = Path(db_path).resolve()
    if read_only:
        uri = f"file:{path.as_posix()}?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
    else:
        conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
    conn.commit()


def parse_app_time(value: str) -> datetime:
    accepted_formats = (DATETIME_FORMAT, "%Y-%m-%d %H:%M")
    for dt_format in accepted_formats:
        try:
            return datetime.strptime(value, dt_format)
        except ValueError:
            continue
    raise DashboardError(f"Invalid datetime '{value}'. Expected format YYYY-MM-DD HH:MM:SS.")


def format_app_time(value: datetime) -> str:
    return value.strftime(DATETIME_FORMAT)


def start_of_day(value: datetime) -> datetime:
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def end_of_day(value: datetime) -> datetime:
    return value.replace(hour=23, minute=59, second=59, microsecond=0)


def parse_date_range(start: str | None, end: str | None, conn: sqlite3.Connection) -> DateRange:
    if (start is None) != (end is None):
        raise DashboardError("Both start and end are required when filtering by date range.")

    if start is None and end is None:
        return get_default_range(conn)

    start_dt = parse_app_time(start)
    end_dt = parse_app_time(end)
    if start_dt > end_dt:
        raise DashboardError("Start datetime must be before or equal to end datetime.")

    return DateRange(start=start_dt, end=end_dt)


def get_default_range(conn: sqlite3.Connection) -> DateRange:
    row = conn.execute(
        "SELECT MIN(appTime) AS earliest, MAX(appTime) AS latest FROM cgmRecords"
    ).fetchone()
    if row is None or row["latest"] is None or row["earliest"] is None:
        raise DashboardError("No CGM data available in the database.")

    earliest = parse_app_time(row["earliest"])
    latest = parse_app_time(row["latest"])
    end = end_of_day(latest)
    candidate_start = start_of_day(latest - timedelta(days=7))
    start = max(start_of_day(earliest), candidate_start)
    return DateRange(start=start, end=end)


def get_series(conn: sqlite3.Connection, date_range: DateRange) -> dict[str, Any]:
    rows = conn.execute(
        """
        SELECT appTime, glucose, status, quality, glucoseIsValid, eventWarning
        FROM cgmRecords
        WHERE appTime BETWEEN ? AND ?
        ORDER BY appTime ASC
        """,
        (format_app_time(date_range.start), format_app_time(date_range.end)),
    ).fetchall()

    return {
        "start": format_app_time(date_range.start),
        "end": format_app_time(date_range.end),
        "points": [
            {
                "appTime": row["appTime"],
                "glucose": row["glucose"],
                "status": row["status"],
                "quality": row["quality"],
                "glucoseIsValid": row["glucoseIsValid"],
                "eventWarning": row["eventWarning"],
            }
            for row in rows
        ],
    }


def get_daily_summary(conn: sqlite3.Connection, date_range: DateRange) -> dict[str, Any]:
    rows = conn.execute(
        """
        SELECT
            date(appTime) AS day,
            COUNT(*) AS count,
            ROUND(AVG(glucose), 2) AS avgGlucose,
            MIN(glucose) AS minGlucose,
            MAX(glucose) AS maxGlucose
        FROM cgmRecords
        WHERE appTime BETWEEN ? AND ?
        GROUP BY date(appTime)
        ORDER BY day ASC
        """,
        (format_app_time(date_range.start), format_app_time(date_range.end)),
    ).fetchall()

    return {
        "start": format_app_time(date_range.start),
        "end": format_app_time(date_range.end),
        "days": [
            {
                "day": row["day"],
                "count": row["count"],
                "avgGlucose": row["avgGlucose"],
                "minGlucose": row["minGlucose"],
                "maxGlucose": row["maxGlucose"],
            }
            for row in rows
        ],
    }


def _recent_events(
    conn: sqlite3.Connection,
    date_range: DateRange,
    comparison: str,
    threshold: float,
    limit: int = 10,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        f"""
        SELECT appTime, glucose, status, quality, eventWarning
        FROM cgmRecords
        WHERE appTime BETWEEN ? AND ?
          AND glucose {comparison} ?
        ORDER BY appTime DESC
        LIMIT ?
        """,
        (
            format_app_time(date_range.start),
            format_app_time(date_range.end),
            threshold,
            limit,
        ),
    ).fetchall()
    return [dict(row) for row in rows]


def get_summary(
    conn: sqlite3.Connection,
    date_range: DateRange,
    low_threshold: float = LOW_THRESHOLD,
    high_threshold: float = HIGH_THRESHOLD,
) -> dict[str, Any]:
    metrics = conn.execute(
        """
        SELECT
            COUNT(*) AS recordCount,
            ROUND(AVG(glucose), 2) AS avgGlucose,
            MIN(glucose) AS minGlucose,
            MAX(glucose) AS maxGlucose,
            SUM(CASE WHEN glucose < ? THEN 1 ELSE 0 END) AS lowCount,
            SUM(CASE WHEN glucose BETWEEN ? AND ? THEN 1 ELSE 0 END) AS inRangeCount,
            SUM(CASE WHEN glucose > ? THEN 1 ELSE 0 END) AS highCount,
            SUM(CASE WHEN glucoseIsValid = 1 THEN 1 ELSE 0 END) AS validCount,
            SUM(CASE WHEN glucoseIsValid != 1 THEN 1 ELSE 0 END) AS invalidCount,
            SUM(CASE WHEN status != 0 THEN 1 ELSE 0 END) AS alertCount,
            ROUND(AVG(quality), 2) AS avgQuality
        FROM cgmRecords
        WHERE appTime BETWEEN ? AND ?
        """,
        (
            low_threshold,
            low_threshold,
            high_threshold,
            high_threshold,
            format_app_time(date_range.start),
            format_app_time(date_range.end),
        ),
    ).fetchone()

    latest = conn.execute(
        """
        SELECT appTime, glucose, status, quality, glucoseIsValid
        FROM cgmRecords
        WHERE appTime BETWEEN ? AND ?
        ORDER BY appTime DESC
        LIMIT 1
        """,
        (format_app_time(date_range.start), format_app_time(date_range.end)),
    ).fetchone()

    status_counts = conn.execute(
        """
        SELECT status, COUNT(*) AS count
        FROM cgmRecords
        WHERE appTime BETWEEN ? AND ?
        GROUP BY status
        ORDER BY count DESC, status ASC
        """,
        (format_app_time(date_range.start), format_app_time(date_range.end)),
    ).fetchall()

    quality_bands = conn.execute(
        """
        SELECT
            CASE
                WHEN quality >= 99 THEN '99-100'
                WHEN quality >= 95 THEN '95-98'
                WHEN quality >= 90 THEN '90-94'
                ELSE '<90'
            END AS band,
            COUNT(*) AS count
        FROM cgmRecords
        WHERE appTime BETWEEN ? AND ?
        GROUP BY band
        ORDER BY count DESC, band ASC
        """,
        (format_app_time(date_range.start), format_app_time(date_range.end)),
    ).fetchall()

    record_count = int(metrics["recordCount"] or 0)

    def pct(count: int | None) -> float:
        if not record_count:
            return 0.0
        return round(((count or 0) / record_count) * 100, 2)

    return {
        "start": format_app_time(date_range.start),
        "end": format_app_time(date_range.end),
        "thresholds": {"low": low_threshold, "high": high_threshold},
        "latest": dict(latest) if latest else None,
        "metrics": {
            "recordCount": record_count,
            "avgGlucose": metrics["avgGlucose"],
            "minGlucose": metrics["minGlucose"],
            "maxGlucose": metrics["maxGlucose"],
            "lowCount": metrics["lowCount"] or 0,
            "inRangeCount": metrics["inRangeCount"] or 0,
            "highCount": metrics["highCount"] or 0,
            "lowPercent": pct(metrics["lowCount"]),
            "inRangePercent": pct(metrics["inRangeCount"]),
            "highPercent": pct(metrics["highCount"]),
        },
        "quality": {
            "validCount": metrics["validCount"] or 0,
            "invalidCount": metrics["invalidCount"] or 0,
            "alertCount": metrics["alertCount"] or 0,
            "avgQuality": metrics["avgQuality"],
            "statusCounts": [dict(row) for row in status_counts],
            "qualityBands": [dict(row) for row in quality_bands],
        },
        "recentLows": _recent_events(conn, date_range, "<", low_threshold),
        "recentHighs": _recent_events(conn, date_range, ">", high_threshold),
    }


def get_dashboard_payload(
    conn: sqlite3.Connection,
    date_range: DateRange,
    low_threshold: float = LOW_THRESHOLD,
    high_threshold: float = HIGH_THRESHOLD,
) -> dict[str, Any]:
    return {
        "summary": get_summary(conn, date_range, low_threshold=low_threshold, high_threshold=high_threshold),
        "series": get_series(conn, date_range),
        "daily": get_daily_summary(conn, date_range),
    }


def get_report_payload(
    conn: sqlite3.Connection,
    date_range: DateRange,
    low_threshold: float = LOW_THRESHOLD,
    high_threshold: float = HIGH_THRESHOLD,
) -> dict[str, Any]:
    series = get_series(conn, date_range)
    daily = get_daily_summary(conn, date_range)
    summary = get_summary(conn, date_range, low_threshold=low_threshold, high_threshold=high_threshold)

    days_by_key: dict[str, dict[str, Any]] = {}
    for day in daily["days"]:
        days_by_key[day["day"]] = {
            "day": day["day"],
            "count": day["count"],
            "avgGlucose": day["avgGlucose"],
            "minGlucose": day["minGlucose"],
            "maxGlucose": day["maxGlucose"],
            "lowCount": 0,
            "highCount": 0,
            "points": [],
        }

    for point in series["points"]:
        day_key = point["appTime"][:10]
        day = days_by_key.get(day_key)
        if day is None:
            day = {
                "day": day_key,
                "count": 0,
                "avgGlucose": None,
                "minGlucose": None,
                "maxGlucose": None,
                "lowCount": 0,
                "highCount": 0,
                "points": [],
            }
            days_by_key[day_key] = day

        glucose = point["glucose"]
        day["points"].append(point)
        day["count"] += 1
        if glucose is not None:
            if day["minGlucose"] is None or glucose < day["minGlucose"]:
                day["minGlucose"] = glucose
            if day["maxGlucose"] is None or glucose > day["maxGlucose"]:
                day["maxGlucose"] = glucose
            if glucose < low_threshold:
                day["lowCount"] += 1
            if glucose > high_threshold:
                day["highCount"] += 1

    ordered_days = [days_by_key[key] for key in sorted(days_by_key.keys())]

    return {
        "summary": summary,
        "series": series,
        "daily": daily,
        "days": ordered_days,
        "generatedAt": format_app_time(datetime.now()),
    }
