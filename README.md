# LinX Inverse

Reverse-engineering utilities and a lightweight Python client for interacting with the AiDEX/LinX backend. The client can log in, fetch CGM records, and store them locally. A separate decryptor script can decrypt response payloads that include `encryptData`.

Use this project only with accounts and data you are authorized to access.

## Features

- Login and session persistence (token stored locally).
- Fetch CGM records from `cgmRecord/getCgmRecordsByPageInfo`.
- Store CGM records in a local SQLite database.
- Decrypt `encryptData` payloads using an RSA private key.
- Simple, script-first workflow (no external services required).

## Project Layout

- linx_client.py: Main HTTP client and CGM storage logic.
- linx_decrypter.py: CLI tool for decrypting `encryptData` payloads.
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

### Decrypt an `encryptData` payload

```bash
./venv/Scripts/python linx_decrypter.py
```

Paste the `encryptData` value when prompted. The script prints the decrypted JSON.

## Data Storage

CGM records are stored in `resources/database.db` under the `cgmRecords` table. Inserts are idempotent by `cgmRecordId`.

## Logging

`linx_client.py` configures basic logging in its `__main__` entrypoint. Adjust `logging.basicConfig(...)` as needed for more or less verbosity.

## Security Notes

- Do not commit real credentials, tokens, or private keys.
- `resources/session.json` contains a live token.
- Treat any decrypted medical data as sensitive.
