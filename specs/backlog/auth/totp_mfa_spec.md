# TOTP (Google Authenticator) MFA Design Spec

**Status:** design reference (not yet implemented) · **Applies to:**
`api_gateway`, `google-sheets-ui` · **Depends on:** verified caller identity
(see [../../../Governance/07-security-auditability.md](../../../Governance/07-security-auditability.md))

A **free**, offline second factor for high-risk actions. The user scans a QR
once into **Google Authenticator** (or any RFC 6238 TOTP app); thereafter the app
produces a 6-digit code every 30s with **no network, no message, no cost**. The
gateway independently recomputes the code from a stored secret and compares.

## Why this, and why free

- Google Authenticator is a plain **TOTP** app — no Google API, no service call,
  no SMS. Both sides derive the same code from `HMAC(secret, current_30s_window)`.
- **$0**: no SMS/Twilio, no external calls. Only cost is a small persistent store
  and dev time.
- **Step-up, not per-request.** TOTP gates *sensitive* actions (approve a
  Ringisho, release a payment). Continuous identity is the JWT; TOTP is the
  second factor at the dangerous moment.

## Relationship to existing auth

```
JWT (OIDC)  → who you are, every request        → gateway verifies identity
TOTP        → second factor, sensitive actions  → gateway verifies the code
```

TOTP **complements** the JWT ingress identity; it does not replace it. A request
that triggers a sensitive action must carry a valid JWT **and** a valid TOTP code.

## Trust model (non-negotiable)

- The **secret lives only server-side**, keyed to the JWT-verified email. Same
  principle as LLM keys — secrets never leave the gateway. Never store it in the
  Sheet, `PropertiesService`, or return it after enrollment.
- **Verification is server-side.** The Sheet only *submits* a code guess; the
  gateway decides. A client asserting "OTP ok" means nothing.
- **The QR/secret is shown exactly once**, during enrollment, over the
  authenticated channel, and is not retrievable afterward (re-enroll to reset).

## Storage

Cloud Run is stateless, so secrets need persistence. **Firestore** (native to the
GCP project, free tier) is the recommended store:

```
Collection: otp_secrets
  Document id: <verified-email>
  Fields:
    secret:      string   # base32 TOTP secret (encrypt at rest if available)
    confirmed:   bool      # enrollment proven by a first valid code
    created_at:  timestamp
    failed:      number    # consecutive failed attempts (brute-force guard)
    locked_until: timestamp | null
```

## Endpoints (gateway)

All require a valid JWT; `email` is taken from the **verified** token claim, never
from the body.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/otp/enroll` | Generate a secret, return an `otpauth://` URI + QR for scanning |
| `POST` | `/otp/confirm` | Prove the scan worked (`{code}`) → set `confirmed=true` |
| `POST` | `/otp/verify` | Verify a code before a sensitive action (`{code}`) |

### `/otp/enroll`
```
→ generate base32 secret (otplib authenticator.generateSecret())
→ save { secret, confirmed:false } keyed by email
→ return { otpauth_uri }   // otpauth://totp/RingishoAI:<email>?secret=…&issuer=RingishoAI
```
Client renders `otpauth_uri` as a QR; user adds it in Google Authenticator.

### `/otp/confirm`
```
→ load secret; verify submitted {code} (±1 window)
→ match → set confirmed=true       else → __ERROR_OTP_INVALID__
```

### `/otp/verify`
```
→ load { secret, confirmed, failed, locked_until }
→ not enrolled/confirmed   → __ERROR_OTP_NOT_ENROLLED__ (403)
→ locked_until > now       → __ERROR_RATE_LIMIT__ (429)
→ verify(code, ±1 window):
     match → reset failed=0; allow the action
     miss  → failed++; if failed >= 5 set locked_until = now + 15m
             → __ERROR_OTP_INVALID__ (401)
```

## Verification rules

- **`otplib`** (Node, MIT, zero external calls) — `authenticator.verify()`.
- **Time window ±1** (30s slack) for clock skew — no wider.
- **Attempt lock:** max 5 consecutive failures → 15-min lock. 6 digits =
  1,000,000 combos; without a lock it is brute-forceable. Reuses
  `__ERROR_RATE_LIMIT__`.
- **Replay:** optionally reject the same code twice within its window for the
  most sensitive actions (store last-used counter).

## Sidebar flow (Apps Script)

Enrollment (once): call `/otp/enroll`, render the QR in `sidebar.html`, user scans.
Then per sensitive action:

```js
const resp = UrlFetchApp.fetch(GATEWAY + '/otp/verify', {
  method: 'post',
  headers: { Authorization: 'Bearer ' + ScriptApp.getIdentityToken() },
  contentType: 'application/json',
  payload: JSON.stringify({ code: userTypedCode }),
});
```

The Sheet never sees or stores the secret — it only forwards a typed code.

## New error keys (add to the registry)

Add these to `docs/03_Reference/error_code_spec.md`, `config/errorCodes.mjs`, and
`app/errors.py` identically (per that spec's change process):

| error_key | http_status | retryable | Meaning |
|---|---|---|---|
| `__ERROR_OTP_REQUIRED__` | 401 | no | Sensitive action needs a second factor; none supplied |
| `__ERROR_OTP_INVALID__` | 401 | no | Submitted TOTP code is wrong |
| `__ERROR_OTP_EXPIRED__` | 401 | no | Code outside the accepted time window |
| `__ERROR_OTP_NOT_ENROLLED__` | 403 | no | User has no confirmed TOTP secret |

> `401` now maps to several keys — the precise cause travels in `body.error.error_key`
> exactly as the error spec prescribes.

## What is free vs. new work

| Item | Cost |
|---|---|
| Google Authenticator app | free (user installs) |
| `otplib` (code generation/verification) | free, MIT, no network |
| Firestore secret store | free tier |
| 3 gateway routes + QR in sidebar + step-up wiring | dev time |

## Open decisions (before implementation)

1. **Which actions require step-up?** (approve/release = yes; read/summarize = no.)
2. **Session vs. per-action:** verify once and grant a short TOTP-verified window
   (e.g. 10 min), or require a code on every sensitive action? (Window = better UX,
   weaker; per-action = stronger, more friction.)
3. **Reset/recovery flow** when a user loses their phone (admin re-enroll).
4. **Encrypt secrets at rest** (Cloud KMS) — recommended for a finance context.
