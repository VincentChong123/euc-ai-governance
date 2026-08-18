# 04 · Google Sheets UI

**Path:** `apps/google-sheets-ui` · **Stack:** Google Apps Script + HTML/JS sidebar

The user-facing "command center." Turns a spreadsheet into a task-delegation and
review surface. Runs inside Google's Apps Script runtime; calls the backend via
the gateway using the **contract envelope**.

## Key files

| File | Role |
|---|---|
| `sidebar.html` | The sidebar UI (prompt, pin cells, audit memo, submit/save) |
| `*.gs` (Apps Script) | Server-side glue: range selection, notes, gateway calls |

## Interaction model

- User writes a prompt + optionally pins cell ranges as context, adds an audit memo.
- **Submit** → Apps Script builds the contract envelope and calls the gateway's
  public contract path → `ai_service` → LLM → result written back to the sheet.
- "Locked / Run AI when saved" flags control batch behavior and human-in-the-loop.
- Full-prompt records + `request_id` stored for traceability.

## Contract

The gateway validates a **contract envelope** (`meta` + `payload`); see the
gateway contract adapter in `apps/api_gateway/server.mjs` and the schema under
`docs/03_Reference/Schemas/`.

## PII pre-flight scan (UX layer)

The sidebar performs a client-side PII scan **before** each submit — this is a
UX convenience, not the security enforcement point (enforcement is at the gateway).

**How it works:**

1. On sidebar open, `getGuardrailPatterns()` (Apps Script, `sidebar_backend.js`)
   fetches live patterns from `GET /guardrail/patterns` on the gateway.
2. If the gateway is unreachable, hardcoded fallback patterns activate immediately
   (SG NRIC, passport, card, bank account, email). Scanning never silently fails.
3. The `🛡️` / `🛡️⚠️` indicator next to Submit shows whether live (gateway) or
   fallback patterns are active.
4. On Submit, `preflightScan()` runs against `promptInput` and `contextInput`:
   - **Injection pattern** → blocked immediately; no warning UI, no submit.
   - **PII detected** → yellow warning banner lists the data types found.
     User chooses **"Auto-redact & Submit"** (replaces with `[REDACTED:<name>]`
     tokens) or **"Edit manually"** (focus textarea, dismiss banner).
5. `piiRedactionLog` (`[{rule, count}]`) is stored in
   **`__Prompt_records_v2` column U** for audit traceability.

**Pattern source of truth:** `specs/guardrail.yaml`. Gateway patterns are fetched
live; fallback covers the most critical SG identifiers without a gateway call.

**Partial masking is caught:** `S768901*A`, `4111 **** **** 1111` — user
hand-masking with `*` or `X` is detected by `*_partial` rules and still triggers
the warning.

## Security note

Sheet ACL restricts *who opens the sheet*, but does **not** authenticate calls to
the gateway URL. Ingress (inbound-call) auth is a separate, currently-deferred
concern — see [01-api-gateway.md](01-api-gateway.md#known-gaps-decisions).

The sidebar PII scan is a UX layer only — the gateway enforces PII redaction at
all four data crossings regardless of what the sidebar does. See
[07-security-auditability.md](../Governance/07-security-auditability.md).
