# Error Code Design Spec

**Status:** canonical reference · **Applies to:** `api_gateway`, `ai_service`

## Editing the registry

The machine-readable source of truth is **`specs/error_codes.yaml`** — edit there, not in the code files directly.

After any change, run the validator to confirm all three are in sync:

```bash
python3 specs/validate_error_codes.py
```

The validator checks `specs/error_codes.yaml` against `apps/api_gateway/config/errorCodes.mjs` and `apps/ai_service/app/errors.py`. It exits non-zero and prints a diff if anything drifts.

A single, shared registry of error identities so every service speaks the same
error language. Source code references an intuitive **`error_key`** (e.g.
`__ERROR_RATE_LIMIT__`) — never a bare HTTP number — and the registry maps each
key to exactly one **`http_status`**.

## Why

- Bare numbers in code (`res.status(504)`) are unsearchable and ambiguous — a
  reader can't tell *why* it's a 504.
- Multiple failure modes legitimately share one HTTP status (two different 502s
  already exist). The number alone can't identify the cause.
- The `error_key` is the stable, greppable, self-documenting identity. The HTTP
  status is derived from it.

## Directionality (important)

| Direction | Deterministic? | How |
|---|---|---|
| `error_key → http_status` | ✅ one-to-one | registry lookup |
| `http_status → error_key` | ❌ one-to-many | a status maps to a *set* of keys |

To reverse a status back to the precise cause, read the **`error_key` field in
the response body** — not the number. The number is only a coarse bucket.

## Conventions

- **Format:** `__ERROR_<UPPER_SNAKE>__` — double-underscore sentinels, greppable
  and collision-proof against ordinary strings.
- **One key = one meaning = one HTTP status.** Never reuse a key for two causes.
- **Never write a raw status in source.** Use `errorKey → status` from the
  shared module (`config/errorCodes.mjs` / `app/errors.py`).
- **`retryable`** tells the client whether a retry may succeed (drives backoff).

## Registry

### Client errors (4xx) — caller must change the request

| error_key | http_status | retryable | Meaning |
|---|---|---|---|
| `__ERROR_BAD_REQUEST__` | 400 | no | Malformed request or envelope mismatch |
| `__ERROR_UNAUTHENTICATED__` | 401 | no | Missing or invalid credentials |
| `__ERROR_FORBIDDEN__` | 403 | no | Authenticated but not permitted |
| `__ERROR_NOT_FOUND__` | 404 | no | Route or resource does not exist |
| `__ERROR_PAYLOAD_TOO_LARGE__` | 413 | no | Body exceeds the configured size limit |
| `__ERROR_VALIDATION__` | 422 | no | Well-formed but semantically invalid (schema) |
| `__ERROR_RATE_LIMIT__` | 429 | yes (after delay) | Too many requests |
| `__ERROR_OTP_REQUIRED__` | 401 | no | Sensitive action needs a second factor; none supplied |
| `__ERROR_OTP_INVALID__` | 401 | no | Submitted TOTP code is wrong |
| `__ERROR_OTP_EXPIRED__` | 401 | no | TOTP code outside the accepted time window |
| `__ERROR_OTP_NOT_ENROLLED__` | 403 | no | User has no confirmed TOTP secret (see [../01_Architecture/specs/totp_mfa_spec.md](../specs/backlog/auth/totp_mfa_spec.md)) |

### Server / gateway errors (5xx) — caller may retry per `retryable`

| error_key | http_status | retryable | Meaning |
|---|---|---|---|
| `__ERROR_INTERNAL__` | 500 | no | Unhandled gateway error |
| `__ERROR_NOT_IMPLEMENTED__` | 501 | no | Endpoint not implemented |
| `__ERROR_UPSTREAM_FAILURE__` | 502 | yes | Upstream unreachable or returned an error |
| `__ERROR_UPSTREAM_INVALID_RESPONSE__` | 502 | no | Upstream returned non-JSON / unparseable body |
| `__ERROR_AUTH_UNAVAILABLE__` | 502 | yes | Could not mint an upstream credential (e.g. GCP token) |
| `__ERROR_SERVICE_UNAVAILABLE__` | 503 | yes | Not ready / a dependency is down |
| `__ERROR_UPSTREAM_TIMEOUT__` | 504 | yes | Upstream did not respond within the timeout |

> `502` intentionally maps to three keys. This is why the body carries the key.

## Response envelope

Every error response includes the key so clients can reverse-map precisely:

```json
{
  "ok": false,
  "result": null,
  "error": {
    "error_key": "__ERROR_UPSTREAM_TIMEOUT__",
    "http_status": 504,
    "message": "AI service timed out.",
    "details": {}
  },
  "meta": { "request_id": "…", "service": "api-gateway" }
}
```

## Usage

**Node (`api_gateway`)** — `config/errorCodes.mjs`:

```js
import { ERROR_KEYS, statusFor } from './config/errorCodes.mjs';
res.status(statusFor(ERROR_KEYS.UPSTREAM_TIMEOUT))
   .json({ error: { error_key: ERROR_KEYS.UPSTREAM_TIMEOUT, /* … */ } });
```

**Python (`ai_service`)** — `app/errors.py`:

```python
from app.errors import ErrorKey, status_for
return JSONResponse(status_code=status_for(ErrorKey.VALIDATION), content={...})
```

**Reverse lookup (number → candidate keys):**

```js
keysForStatus(504); // ['__ERROR_UPSTREAM_TIMEOUT__']
keysForStatus(502); // three keys — disambiguate via body.error.error_key
```

## Change process

The Node and Python modules are **mirrors of this table**. When adding an error:
1. Add the row here first (this doc is canonical).
2. Add the entry to `config/errorCodes.mjs` and `app/errors.py` identically.
3. Never recycle a retired key for a new meaning.
