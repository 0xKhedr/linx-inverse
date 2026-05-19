from __future__ import annotations

from pathlib import Path

from flask import Flask, jsonify, render_template, request

from app.dashboard import DashboardError, create_connection, get_daily_summary
from app.dashboard import get_default_range, get_series, get_summary, parse_date_range


def create_app(db_path: Path | str = "resources/database.db") -> Flask:
    app = Flask(__name__, template_folder="../templates", static_folder="../static")

    def open_db():
        return create_connection(db_path)

    def json_response(fetcher):
        conn = open_db()
        try:
            date_range = parse_date_range(request.args.get("start"), request.args.get("end"), conn)
            return jsonify(fetcher(conn, date_range))
        except DashboardError as exc:
            return jsonify({"error": str(exc)}), 400
        finally:
            conn.close()

    @app.get("/")
    def index():
        conn = open_db()
        try:
            date_range = get_default_range(conn)
            return render_template(
                "index.html",
                default_start=date_range.start.strftime("%Y-%m-%dT%H:%M:%S"),
                default_end=date_range.end.strftime("%Y-%m-%dT%H:%M:%S"),
                default_start_api=date_range.start.strftime("%Y-%m-%d %H:%M:%S"),
                default_end_api=date_range.end.strftime("%Y-%m-%d %H:%M:%S"),
                error=None,
            )
        except DashboardError as exc:
            return render_template(
                "index.html",
                default_start="",
                default_end="",
                default_start_api="",
                default_end_api="",
                error=str(exc),
            )
        finally:
            conn.close()

    @app.get("/api/summary")
    def api_summary():
        return json_response(lambda conn, date_range: get_summary(conn, date_range))

    @app.get("/api/series")
    def api_series():
        return json_response(lambda conn, date_range: get_series(conn, date_range))

    @app.get("/api/daily")
    def api_daily():
        return json_response(lambda conn, date_range: get_daily_summary(conn, date_range))

    return app


app = create_app()


if __name__ == "__main__":
    app.run(debug=True)
