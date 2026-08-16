# specs/

Source-of-truth artifacts for the system. Some are read by code (at runtime or
build time), some are design references that shape the code but are not parsed by
it. This table records which is which and how each one is consumed, so nothing
here is mistaken for dead weight or for a live control it is not.

## Consumption map

| Spec | Role | Read by | How |
|---|---|---|---|
| `guardrail.yaml` | **Runtime control** | `apps/ai_service/app/guardrails.py`, `apps/api_gateway/middleware/guardrails.mjs` | Loaded once at startup; drives input/output guardrail and PII-egress patterns live. |
| `error_codes.yaml` | **Build / validate** | `specs/validate_error_codes.py` | Single source of error keys; the validator asserts `errorCodes.mjs` and `errors.py` stay in sync with it. |
| `prompt-records-schema.yaml` | **Build / codegen** | `apps/google-sheets-ui/sync_spec_yaml_note_schema.py` | Generates the audit-sheet column order in `note_schema.js`, which `plugin_hitl_ai.js` writes against. |
| `google-sheets-api-gateway-contract.yaml` | **Build (contract)** | `specs/sync_google_sheets_gateway_contract.py` → `apps/api_gateway/config/googleSheetsContract.mjs` | The UI/gateway boundary schema. The generator reads this YAML and writes `apps/api_gateway/generated/google-sheets-api-gateway-contract.json`, which the loader reads at runtime for `server.mjs`. The generated JSON is checked in so the chain runs without a build step. |
| `program-sequence.md` | **Documentation** | humans | End-to-end request flow / lineage. Not machine-consumed. |
| `ba_business_schema.csv` | **Design reference** | none | Versioned business schema (v1 to v3) with per-field constraints. Not parsed by code. See TODO below. |
| `ba_pii_rules_spec.csv` | **Design reference** | none | Target PII classification to action mapping (tokenize / partial-mask / hard-stop). Not parsed by code. See TODO below. |

## TODO

- **`ba_business_schema.csv`** is a design reference only; no code reads it. Intended
  consumer would be a schema-validation step that checks EUC input against the
  versioned constraints. Not built yet.
- **`ba_pii_rules_spec.csv`** describes the *target* tiered PII handling. The
  *implemented* control is uniform first-line regex redaction in
  `apps/api_gateway/middleware/egressPiiGuardrail.mjs`; the per-class tiered
  actions in this CSV are not wired in. Not built yet.
- The **`google-sheets-api-gateway-contract.yaml`** chain is fully wired in this
  snapshot: the generator (`sync_google_sheets_gateway_contract.py`), the loader
  (`apps/api_gateway/config/googleSheetsContract.mjs`), and the checked-in
  `apps/api_gateway/generated/google-sheets-api-gateway-contract.json` are all
  present, so `server.mjs`'s `loadGoogleSheetsGatewayContract()` resolves. Note the
  generator also rewrites `apps/google-sheets-ui/Config.js` in the full system; that
  Sheets-UI config is not published here (it carries environment identifiers), so
  the generator detects its absence and skips that step while still emitting the
  gateway JSON.
