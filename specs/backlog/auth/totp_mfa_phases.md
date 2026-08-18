# TOTP / Conditional MFA — Phased Implementation Plan

**Status:** implementation guide · **Applies to:** `api_gateway`, `google-sheets-ui`
**Design spec:** [totp_mfa_spec.md](totp_mfa_spec.md) ·
**Security context:** [../../../Governance/07-security-auditability.md](../../../Governance/07-security-auditability.md)

Free second factor (Google Authenticator / TOTP, RFC 6238) layered on top of the
JWT identity, mimicking a bank-wide authenticator now and swappable to a federated
IdP later. This document is the **build order**: each phase is self-contained,
independently testable, and maps to exactly one git commit made *after* its
exit-criteria tests pass.

## Principles

- **Commit per green phase.** One commit at each phase's tested exit criteria —
  a known-good, revertable, bisectable checkpoint. Work on a `feat/totp-mfa`
  branch off `main`; one PR at the end.
- **Secrets stay server-side.** The TOTP secret lives only in the gateway store,
  keyed by the JWT-verified email. Never in the body, never client-cached, never
  sent to a third-party QR service. Store file is gitignored, mode `0o600`.
- **Email from the verified JWT claim, never the request body.**
- **Two test layers per phase:** example/smoke tests are the exit-criteria gate
  and read as documentation; property tests (fast-check) assert invariants that
  hold across *all* generated inputs. See [Testing strategy](#testing-strategy).

## Model choice per phase

Security-sensitive phases (⭐) stay on the most deliberate model. UI/wiring
phases can use a faster model.

| Phase | Nature | Suggested model |
|---|---|---|
| 1 | error registry | Opus 4.8 / Fable |
| 2 | secret store | Opus 4.8 |
| 3 ⭐ | TOTP backend + swap boundary | Opus 4.8 |
| 4 | enroll/verify endpoints | Fable / Opus 4.8 |
| 5 ⭐ | conditional MFA_MODE | Opus 4.8 |
| 6 | sidebar UI + interruption handling | Fable |
| 7 | hardening (Firestore/KMS/audit) | Opus 4.8 |

---

## Phase 1 — Error registry ✅ (complete)

Add the four MFA error keys to all three mirrors.

- **Files:** `docs/03_Reference/error_code_spec.md`, `apps/api_gateway/config/errorCodes.mjs`,
  `apps/ai_service/app/errors.py`.
- **Keys:** `__ERROR_OTP_REQUIRED__` (401), `__ERROR_OTP_INVALID__` (401),
  `__ERROR_OTP_EXPIRED__` (401), `__ERROR_OTP_NOT_ENROLLED__` (403) — all
  non-retryable.
- **Exit criteria (verified):** JS and Python registries are byte-identically
  equivalent; `keysForStatus(401)`/`(403)` include the new keys; typo guard
  throws on unknown keys.

---

## Phase 2 — Secret store

Pluggable persistence for TOTP secrets. Local dev = gitignored JSON file (no
database). Prod = Firestore (Phase 7).

- **File:** `apps/api_gateway/mfa/otpStore.mjs`.
- **Adapters:** `JsonFileOtpStore` (atomic tmp+rename writes, mode `0o600`,
  default path `apps/api_gateway/.otp-store.json`, `OTP_STORE_FILE` override);
  `MemoryOtpStore` (tests); `buildStore()` selects via `OTP_STORE=file|firestore`
  (firestore throws "not implemented" until Phase 7).
- **Record schema:** `otp_secrets/{email}` → `{ secret, confirmed, created_at,
  failed, locked_until }`.
- **Methods:** `get`, `create`, `setConfirmed`, `recordFailure(threshold, lockMs)`,
  `resetFailure`, `delete`.
- **Also:** add `.otp-store.json` to `.gitignore`.
- **Exit criteria:** CRUD example test passes; store file created `0o600`.
- **Property tests (high payoff — the store is a state machine):**
  - round-trip: `create` then `get` returns exactly what was written;
  - idempotent `setConfirmed`;
  - monotonic failures → `locked_until` set in the future once threshold hit;
  - `resetFailure` clears count and lock;
  - `delete` is final;
  - **model-based:** random operation sequences run against both `JsonFileOtpStore`
    and `MemoryOtpStore` stay observably identical (proves the file adapter matches
    the reference; catches atomic-write/serialization bugs).

---

## Phase 3 ⭐ — TOTP backend + swap boundary

The verification engine and the single seam an enterprise IdP later plugs into.

- **Deps:** `npm i otplib` (MIT — generates *and* verifies).
- **Backend:** wraps otplib; `generate(secret, t)` (tests only), `verify(secret,
  code, t)`, ±1 window. Clock is **injected** (pass `t`), never wall-clock read —
  makes verification deterministic and property-testable.
- **Swap boundary:** `requireMfa` middleware + `MFA_BACKEND.assert(req)` as the
  *only* place downstream code touches MFA. Assurance contract populated on
  success: `req.mfa = { mfa_verified, amr, acr, auth_time }`. Swapping to a
  federated IdP later replaces `MFA_BACKEND` only.
- **Exit criteria:** `requireMfa` passes against a valid code and rejects an
  invalid one with `__ERROR_OTP_INVALID__`.
- **Property tests (crypto invariants):**
  - generate-then-verify always true within window;
  - window boundary: true for offsets {−1,0,+1}, false for ±2+;
  - a code from one secret never verifies against a different secret;
  - no replay: a code for step T fails at T+2.

---

## Phase 4 — Enrollment & verification endpoints

- **File:** `apps/api_gateway/mfa/otpRoutes.mjs` (or mounted in `server.mjs`).
- **Endpoints:** `/otp/enroll` (mint secret, return `otpauth://` string),
  `/otp/confirm` (first code confirms enrollment), `/otp/verify` (per-action).
- **Security invariant:** email is *always* taken from the verified JWT claim,
  never the body — even if the body carries a different email.
- **Exit criteria:** enroll → confirm → verify works via curl (code generated in
  test by otplib); one real-phone QR smoke test.
- **Property tests:**
  - email provenance: for *any* body (including one with a different email), the
    email used is the JWT-claim email;
  - malformed codes (any non-6-digit string) → `__ERROR_OTP_INVALID__`, never 500.

---

## Phase 5 ⭐ — Conditional MFA_MODE

Per-user conditional enforcement based on enrollment state.

- **Modes:** `optional` (skip un-enrolled users, **log every skip** with email +
  request_id), `grace`, `enforced`.
- **Boot-guard:** refuse to start in prod with a non-`enforced` mode.
- **Brute-force lock:** 5 consecutive failures → 15-min lock, reusing
  `__ERROR_RATE_LIMIT__`.
- **Decision function:** pure `decide(mode, enrolled, codeValid) → allow |
  require | skip-and-log` — the PBT centerpiece.
- **Exit criteria:** truth-table example test passes; prod boot-guard rejects a
  non-enforced mode.
- **Property tests:**
  - `enforced` never yields "skip" for any input;
  - `optional` + un-enrolled always skips **and** logs (assert on a mock logger —
    proves no silent bypass);
  - a valid code always allows, regardless of mode;
  - for any interleaving of good/bad attempts, the 6th consecutive failure is
    locked.

---

## Phase 6 — Sidebar UI + interruption handling

QR enrollment + inline step-up prompt, **plus** the concurrency/interruption
handling the current sidebar lacks.

### UI surfaces
- **Enrollment:** modal dialog `totp_enroll.html` rendering the QR *client-side*
  from the `otpauth://` string (never a third-party QR image service).
- **Step-up:** inline OTP prompt inside `handleSaveAction()` in
  `apps/google-sheets-ui/sidebar.html`.

### Interruption / concurrency handling (new)

The current `handleSaveAction()` has no concurrency guard and no failure handler.
Failure modes to close:

1. **Double-submit** — button stays clickable during the long LLM call → two
   `saveAndExecuteSingleCell` runs, double charge, cell write race.
2. **No `withFailureHandler`** — a gateway timeout leaves status stuck forever;
   user re-clicks (feeds #1). *Most important missing piece.*
3. **Stale / out-of-order results** — `google.script.run` cannot be cancelled;
   a late callback from a superseded request writes to the wrong cell / clobbers
   newer status.
4. **Navigation mid-flight** — selecting a different cell changes context; a
   callback assuming the original cell writes to the wrong place.

**What the UI can and cannot do:** `google.script.run` has **no cancel API**, so
"cancel" splits into: *prevent* starting a second run (guard — solvable);
*ignore* a stale result (request token — solvable); *actually stop* server work
(**not** solvable in the UI — needs a server-side cancel flag / abortable
request-id in the gateway, tracked as a backend follow-up).

**Fix — in-flight guard + request token:**
- `inFlight` boolean swallows the double-click; `setBusy()` disables `submitBtn`
  and shows a running state.
- `withFailureHandler` on every `google.script.run` call surfaces failures and
  clears `inFlight`.
- Monotonic `requestSeq` token tagged per request; any callback whose token is
  stale (`myReq !== requestSeq`) drops silently instead of mutating state.

**MFA intersection:**
- The inline OTP prompt lives *inside* the same `inFlight` guard (otherwise
  action + verify + re-submit races overlap).
- `__ERROR_OTP_INVALID__` must clear `inFlight` and re-enable input, or the user
  hits a UI deadlock (distinct from the server 5-fail lock).
- The 15-min server lock needs its own UI state (disable field, show cooldown).

### Testability
Extract the guard/token logic into a DOM-free `ActionController` so the
interruption logic is unit- and property-testable:
- **Property:** for any interleaving of `submit` / `success(reqId)` /
  `failure(reqId)` events, at most one request is ever active and no callback
  with `reqId !== current` mutates state. fast-check generating random event
  orderings finds the out-of-order races manual clicking won't.
- Example/smoke test stays for DOM wiring (button disables, status text).

- **Exit criteria:** enroll → step-up → execute works end-to-end in the sidebar;
  double-click and stale-callback tests pass.

---

## Phase 7 — Hardening

- **Firestore adapter:** implement the `firestore` backend behind the same store
  interface (Cloud Run has ephemeral disk). Reuse the Phase-2 **model-based**
  test against the emulator — same operation sequences, assert it matches
  `MemoryOtpStore`.
- **KMS:** encrypt secrets at rest.
- **Lost-phone recovery:** reset flow (admin re-enroll).
- **Audit log:** durable, append-only record of enroll/verify/skip/lock events.
- **Exit criteria:** Firestore adapter passes the model-based equivalence test;
  audit entries emitted for each MFA event.

---

## Testing strategy

| Layer | Tool | Purpose |
|---|---|---|
| Example / smoke | `node:test` | Exit-criteria gate; documents the happy path |
| Property | `fast-check` (`npm i -D`) | Invariants across all generated inputs; shrinks failures to minimal repro |

PBT needs **pure, injectable seams** — inject the clock into the TOTP backend,
the store into the endpoints, the logger into the decision function. This is the
same dependency injection the swap-boundary design already wants, so writing for
PBT reinforces the Phase 3 / 5 architecture rather than fighting it.

**Testing without a phone:** tests call `authenticator.generate(secret)` to act
as the phone; the real Google Authenticator is needed exactly once (Phase 4 QR
smoke test). Freeze/inject time for CI determinism.

## Open decisions (Phase 0 — pending)

- Which actions are "sensitive" (require step-up)?
- Verified-window vs per-action codes?
- Lost-phone recovery flow?
- KMS at-rest encryption?
