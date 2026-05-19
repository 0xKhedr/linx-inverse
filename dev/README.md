# AiDEX/LinX Reverse Engineering Journey

Date: 2026-05-16

This document summarizes the research and engineering work done in this session around decrypting AiDEX/LinX API traffic and building a Python client for direct backend requests.

Sensitive values are intentionally omitted. Do not paste credentials, tokens, private keys, replayable login `encryptData`, or medical record payloads into this document.

## Goal

The original goal was to understand and reproduce requests made by the AiDEX/LinX Android app:

- Decrypt encrypted backend responses that contain `encryptData`.
- Extract useful records from captured traffic.
- Build a Python client that can log in, store a token, and call backend endpoints directly.
- Identify why the initial glucose endpoint returned empty arrays.

## Starting Point

The first inspected request was:

```text
GET /backend/aidex-x/bloodGlucoseRecord/getBloodGlucoseRecordsByPageInfo
```

The response was JSON containing only:

```json
{
  "encryptData": "<base64 ciphertext>"
}
```

Important request headers observed from the app included:

- `x-token`
- `brand: linX`
- `encryption: enabled`
- `app-version-check`
- `app-info: com.microtech.aidexx.mgdl,2.5.0`
- `Accept-Language: en`
- `Accept-Encoding: gzip`
- `User-Agent: okhttp/4.11.0`

## Response Decryption

A private RSA key was recovered from the unpacked APK/assets and placed in a local private key file. A Python decryptor was built around the app's response format:

- Base64 decode `encryptData`.
- Split ciphertext into RSA block-size chunks.
- RSA-decrypt each chunk.
- Remove PKCS#1 v1.5 padding.
- Decode UTF-8 plaintext.
- Parse JSON when possible.

Later, RSA CRT optimization using `p` and `q` was added so large multi-block responses decrypt faster.

Key outcome:

- Backend encrypted responses can be decrypted locally with the recovered private key.
- Empty `data: []` responses were real decrypted backend payloads, not a decryption failure.

## Captured Flow Extraction

The mitmproxy export was saved as:

```text
client/flows
```

It was parsed as a mitmproxy typed netstring file. We extracted `encryptData` values from captured responses and saved arrays of captured encrypted payloads earlier in the process.

When decrypting captured responses, we found:

- `bloodGlucoseRecord/getBloodGlucoseRecordsByPageInfo` returned empty arrays.
- The actual continuous sensor glucose readings were under:

```text
/backend/aidex-x/cgmRecord/getCgmRecordsByPageInfo
```

That explained why the manual blood glucose endpoint kept looking empty.

## Python Client

The main Python client is:

```text
client/aidex_client.py
```

It was built using only Python standard library modules. It implements:

- DER parsing for RSA public/private keys.
- RSA PKCS#1 v1.5 decryption for backend responses.
- RSA PKCS#1 v1.5 encryption for generated request bodies.
- Gzip response decoding.
- JSON parsing.
- Login/session storage.
- Token-based GET/POST requests.
- Specific helpers for:
  - `get-glucose`
  - `get-cgm`
  - arbitrary `request`

The script stores successful login state in:

```text
client/aidex_session.json
```

This file contains a live token and should be treated as secret.

## Request Encryption Research

The request-encryption public key was found in:

```text
app/src/main/assets/overdrive/overdrive.data
```

This key was added to the client as `DEFAULT_REQUEST_PUBLIC_KEY`.

We verified that the captured app login ciphertext is mathematically compatible with that public key modulus, and not compatible with the response private key modulus. This supported the model that requests and responses use different RSA keys.

## Login Implementation Attempts

The first normal login command was:

```powershell
py aidex_client.py login --private-key .\private_key.txt --credentials .\credentials.json
```

It reached the backend but returned:

```json
{
  "code": 500,
  "msg": "Request failed."
}
```

We tested multiple possible causes.

### User-Agent

The script already sent:

```text
User-Agent: okhttp/4.11.0
```

This matched the app traffic.

We later replayed the exact captured login `encryptData` through Python using the same User-Agent, and the backend returned `200`. That ruled out User-Agent as the cause.

### app-version-check

The app sends a different `app-version-check` value on almost every request. The client originally used one static captured value.

The client was updated to support:

```text
--app-version-check
```

and to read `appVersionCheck` from JSON config if present.

However, replaying the exact captured login `encryptData` succeeded even with `app-version-check` missing. That means this header is not the blocker for the login failure we saw.

### Password Handling

The client originally MD5-hashed the password before sending it. We tested:

- MD5 password mode.
- Raw password mode.
- A previously observed password hash from a token.

All generated login attempts still returned backend `500`.

One observation: the password in `credentials.json` did not hash to the password hash embedded in an older token seen in previous traffic. That suggests the local credential value may not match the historical captured token, but it did not fully explain why all generated payloads failed.

### Payload Shape

We tried multiple generated login plaintext shapes before encryption:

- JSON with `userName` / `password`
- JSON with `username` / `password`
- JSON with `email` / `password`
- JSON with `pwd`
- Dotted keys like `auth.userName` / `auth.password`
- Nested `auth` objects
- Form-encoded bodies
- Username-only bodies, based on `ReqPwdLogin(userName=...)` metadata seen in packed strings

All generated variants returned backend `500`.

### RSA Padding Variants

The packed app data contains strings for both:

- `RSA/ECB/PKCS1Padding`
- `RSA/ECB/OAEPWithSHA1AndMGF1Padding`

We tested generated request encryption with PKCS#1 v1.5 and also OAEP/SHA-1 for likely login body shapes. These attempts still returned backend `500`.

## Login Replay Breakthrough

The exported flow contained a successful app login request:

```text
POST /backend/aidex-x/user/loginByPassword
```

Instead of generating a new login payload, we replayed the captured login `encryptData` value through Python.

Result:

```json
{
  "http_status": 200,
  "body_code": 200,
  "msg": "Request success",
  "token_present": true,
  "user_id_present": true
}
```

This proved:

- Python networking is fine.
- The User-Agent is fine.
- `app-version-check` is not required for that replay.
- The response decryption is correct.
- The unresolved issue is specifically the exact app-side login plaintext/encryption path used to produce login `encryptData`.

The client was updated with replay support:

```text
--encrypt-data
--encrypt-data-file
```

Example command shape:

```powershell
py .\aidex_client.py login --private-key .\private_key.txt --encrypt-data "<captured-login-encryptData>"
```

The actual captured login `encryptData` is replayable and should be treated like a secret.

## Session Verification

After replay login succeeded, the client saved:

```text
client/aidex_session.json
```

Then we verified a direct CGM request:

```powershell
py .\aidex_client.py get-cgm --private-key .\private_key.txt --session .\aidex_session.json --user-id <target-user-id> --page-num 1 --page-size 5
```

The response was saved as:

```text
client/cgm_response_check.json
```

Summary:

```json
{
  "http_status": 200,
  "body_code": 200,
  "msg": "Request successful.",
  "count": 5,
  "data_items": 5
}
```

This confirmed the saved token can fetch real CGM readings.

## Important Files

```text
client/aidex_client.py
```

Main Python client.

```text
client/private_key.txt
```

Private response-decryption key. Secret.

```text
client/credentials.json
```

Local username/password config. Secret.

```text
client/flows
```

Captured traffic export from mitmproxy.

```text
client/aidex_session.json
```

Saved token/session file. Secret.

```text
client/login_response*.json
```

Saved login test responses. Some may contain decrypted login response data and tokens.

```text
client/cgm_response_check.json
```

Verified CGM response sample. Contains health data.

## Current Working Commands

Replay captured login and save a session:

```powershell
py .\aidex_client.py login --private-key .\private_key.txt --encrypt-data "<captured-login-encryptData>"
```

Fetch CGM readings:

```powershell
py .\aidex_client.py get-cgm --private-key .\private_key.txt --session .\aidex_session.json --user-id <target-user-id> --page-num 1 --page-size 500
```

Fetch manual blood glucose readings:

```powershell
py .\aidex_client.py get-glucose --private-key .\private_key.txt --session .\aidex_session.json --user-id <target-user-id> --page-num 1 --page-size 500
```

The manual blood glucose endpoint may legitimately return empty arrays. For sensor data, use `get-cgm`.

## What Is Solved

- Decrypting encrypted backend responses.
- Extracting and inspecting captured `encryptData` values.
- Distinguishing empty manual glucose results from real CGM sensor results.
- Building a Python client that can send authenticated backend requests once a token exists.
- Replaying a captured login `encryptData` to get a fresh token.
- Fetching CGM records with the saved session.

## What Is Not Yet Solved

The exact app-side login payload generation is still unresolved.

Generated login bodies currently produce backend `500`, even when testing:

- Different password handling modes.
- Different field names.
- JSON versus form encoding.
- Different candidate RSA public keys.
- PKCS#1 v1.5 versus OAEP/SHA-1 request encryption.
- Different `app-version-check` handling.

The next productive step is deeper static analysis of the packed app code around:

- `ReqPwdLogin`
- `AccountRepository.loginByPassword`
- `EncryptInterceptor`
- `DataEncryptInterceptor`
- `HeaderInterceptor`
- any RSA utility that calls `encryptByPublicKey` or `RSA/ECB/...`

JADX or apktool were not available on this machine during the session, so we relied on packed string extraction from `overdrive.data` and observed network behavior.

## Follow-Up: JADX And Split APK Findings

JADX was later found at:

```text
D:\Toolery\jadx-gui-1.5.5-win\jadx-gui-1.5.5.exe
```

The usable CLI entrypoint is inside the all-in-one jar:

```powershell
java -cp "D:\Toolery\jadx-gui-1.5.5-win\lib\jadx-gui-1.5.5-all.jar" jadx.cli.JadxCLI --version
```

The jar's default `java -jar` entrypoint launches the GUI wrapper and can try to write GUI cache files outside the workspace. Use the CLI class directly for headless decompilation.

An APK was found at:

```text
C:\Users\Compumarts\Downloads\platform-tools-latest-windows\platform-tools\base.apk
```

Decompiling it with JADX produced the same loader-only result as the existing project:

```text
com.mobile.overdrive.RevolutApplication
com.mobile.overdrive.Revolut
com.mobile.overdrive.RevolutComponentFactory
```

The base APK contains:

- `classes.dex`, only about 5.6 KB.
- `assets/overdrive/overdrive.data`, about 31.7 MB.
- no `libcheckov.so`.

The loader calls:

```java
System.loadLibrary("checkov");
```

and the manifest has:

```xml
android:extractNativeLibs="false"
android:requiredSplitTypes="base__abi,base__density"
```

This means the missing native library is probably in an ABI split APK, for example a `split_config.arm64_v8a.apk` file from the installed app. The current workspace and Downloads search found only `base.apk`, so JADX still cannot see the real protected classes.

ADB was checked, but no Android device was connected:

```text
adb devices
List of devices attached
```

Additional generated-login attempts were tested with likely required fields inferred from successful token payloads:

- `appId`
- `identity`
- `passwordType`
- `project`
- `operation`

Those still returned backend `500`. This further supports that the blocker is hidden request encryption/plaintext generation inside the Overdrive-protected runtime, not a simple missing JSON field.

Two helper scripts were added:

```text
client/pull_aidex_apks.ps1
client/decompile_with_jadx.ps1
```

When a phone with USB debugging is connected, pull all installed APK splits:

```powershell
.\pull_aidex_apks.ps1
```

Then decompile the pulled APK set:

```powershell
.\decompile_with_jadx.ps1 -InputPath .\apks -OutputDir .\jadx_apks
```

The next useful target is the ABI split containing `libcheckov.so`. Once that native loader is available, the remaining work is to unpack or instrument the protected runtime so the real classes around `ReqPwdLogin`, `AccountRepository.loginByPassword`, and the encryption interceptor can be inspected.

## Security Notes

Do not commit or share these files:

- `credentials.json`
- `private_key.txt`
- `aidex_session.json`
- `login_response*.json`
- `cgm_response_check.json`
- any file containing captured login `encryptData`

The captured login `encryptData` is reusable against the backend and should be treated like a credential.

The CGM response files contain health data and should be treated as sensitive personal data.

## Follow-Up: 2026-05-19 Login Flow Update

Live testing on 2026-05-19 produced several new findings.

### Plain Login Works Again

The current backend accepts a plain JSON login body to:

```text
POST /backend/aidex-x/user/loginByPassword
```

Using:

```json
{
  "userName": "<email>",
  "password": "<md5 password>"
}
```

with the client `--plain` mode returned a live token and user ID.

This was verified again by immediately calling:

```text
/backend/aidex-x/cgmRecord/getCgmRecordsByPageInfo
```

with the freshly saved session.

### Encrypted Login Still Fails

The generated encrypted login path still failed to produce a token.

However, when the same credentials were sent as plain JSON, the backend returned success. That means the current blocker is not the credentials themselves. It remains specific to the encrypted login request path.

### Captured Login Replay No Longer Works Reliably

The previously captured app login `encryptData` value was tested again on 2026-05-19.

Result:

```json
{
  "http_status": 500,
  "body": {
    "code": 500,
    "msg": "Request failed."
  }
}
```

This means the earlier replay success is no longer reproducible with that old captured ciphertext, even when also replaying its captured `app-version-check` header.

The old conclusion that captured login `encryptData` is directly reusable should now be treated as time-sensitive rather than generally reliable.

### Session Invalidates On Repeated Login

The backend appears to invalidate earlier tokens as soon as a newer login succeeds.

This was observed when multiple login attempts were made close together:

- a later login returned a valid token
- an earlier token then caused:

```json
{
  "code": 802,
  "msg": "This account has been  logged in from other equipments, please try again."
}
```

Operationally, the safe pattern is:

- perform one fresh login
- save that token
- avoid parallel or duplicate login attempts before using it

### Client Change

`aidex_client.py` was updated so the `login` command now:

- tries the existing encrypted login path first
- automatically retries with plain JSON if the encrypted attempt returns no token

This restores a working default login flow for direct requests from the Python client under the backend behavior observed on 2026-05-19.
