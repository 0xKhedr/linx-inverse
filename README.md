# LinX Inverse

Reverse-engineering utilities and a lightweight Python client for interacting with the AiDEX/LinX backend. The client can log in, fetch CGM records, store them locally, and inspect them through a local Flask dashboard and printable report view. A separate decryptor script can decrypt response payloads that include `encryptData`.

Use this project only with accounts and data you are authorized to access.

## Features

- Login and session persistence (token stored locally).
- Fetch CGM records from `cgmRecord/getCgmRecordsByPageInfo`.
- Store CGM records in a local SQLite database.
- Inspect stored CGM data through a local Flask dashboard.
- Export a printable CGM report for a selected time window.
- Switch the dashboard and report UI between English and Arabic (`?lang=en` / `?lang=ar`).
- Decrypt `encryptData` payloads using an RSA private key.
- Simple, script-first workflow (no external services required).

## Project Layout

- app/client.py: Main HTTP client and CGM storage logic.
- app/decrypter.py: CLI tool for decrypting `encryptData`.
- app/web.py: Local Flask dashboard for CGM analysis.
- app/dashboard.py: Shared SQLite query layer for dashboard routes and tests.
- app/i18n.py and app/translations.json: UI language resolution and English/Arabic copy.
- linx_client.py, linx_decrypter.py, web_app.py: Thin compatibility launchers.
- requirements.txt: Python dependencies.
- resources/credentials.json: Login credentials (do not commit real values).
- resources/session.json: Cached login session (contains token).
- resources/database.db: Local SQLite DB for CGM records.
- dev/README.md: Research notes and reverse-engineering context.

## Setup

1) Create a virtual environment and install dependencies:

```bash
python -m venv venv
./venv/Scripts/python -m pip install -r requirements.txt
```

2) Create `resources/credentials.json`:

```json
{
  "userName": "YOUR_USERNAME",
  "password": "YOUR_PASSWORD"
}
```

The client hashes the password (MD5) before sending it.

3) (Optional) Provide a private key for decrypting `encryptData`:

- For linx_decrypter.py, place `private_key.txt` next to the script.
- The file should contain the base64 DER private key string (no newlines).

## Usage

### Login and store CGM records

```bash
./venv/Scripts/python linx_client.py
```

The default script reads credentials from `resources/credentials.json`, uses or creates a session in `resources/session.json`, and stores records in `resources/database.db`.

If you want to force a new login, uncomment the `linx.login(creds)` line in `linx_client.py`.

### Run the CGM analysis web interface

```bash
./venv/Scripts/python web_app.py
```

Open `http://127.0.0.1:5000/` in your browser.

The dashboard is read-only and queries `resources/database.db` directly. When no explicit date range
is supplied, the UI uses a default window ending on the latest day in the database and spanning up
to the previous 7 days, bounded by the earliest available record.

The web UI supports:

- `lang=en` for English.
- `lang=ar` for Arabic with right-to-left layout.

Examples:

```text
http://127.0.0.1:5000/
http://127.0.0.1:5000/?lang=ar
http://127.0.0.1:5000/report?start=2026-05-18%2000:00:00&end=2026-05-19%2023:59:59&lang=ar
```

Available routes:

- `GET /`: Render the dashboard.
- `GET /report?start=YYYY-MM-DD HH:MM:SS&end=YYYY-MM-DD HH:MM:SS[&lang=en|ar]`: Render the printable report.
- `GET /api/dashboard?start=YYYY-MM-DD HH:MM:SS&end=YYYY-MM-DD HH:MM:SS`
- `GET /api/summary?start=YYYY-MM-DD HH:MM:SS&end=YYYY-MM-DD HH:MM:SS`
- `GET /api/report?start=YYYY-MM-DD HH:MM:SS&end=YYYY-MM-DD HH:MM:SS`
- `GET /api/series?start=YYYY-MM-DD HH:MM:SS&end=YYYY-MM-DD HH:MM:SS`
- `GET /api/daily?start=YYYY-MM-DD HH:MM:SS&end=YYYY-MM-DD HH:MM:SS`

Notes:

- The HTML routes use `lang` only for presentation. The JSON APIs stay language-neutral.
- The dashboard includes an in-page language selector that preserves the selected range and report link.

### Decrypt an `encryptData` payload

```bash
./venv/Scripts/python linx_decrypter.py
```

Paste the `encryptData` value when prompted. The script prints the decrypted JSON.

## Data Storage

CGM records are stored in `resources/database.db` under the `cgmRecords` table. Inserts are idempotent by `cgmRecordId`.

The dashboard uses standard CGM thresholds of `<70 mg/dL` for lows and `>180 mg/dL` for highs.

## Logging

`linx_client.py` configures basic logging in its `__main__` entrypoint. Adjust `logging.basicConfig(...)` as needed for more or less verbosity.

## Security Notes

- Do not commit real credentials, tokens, or private keys.
- `resources/session.json` contains a live token.
- Treat any decrypted medical data as sensitive.
