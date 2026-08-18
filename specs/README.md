# specs/

Source-of-truth artifacts for the system. Some are read by code (at runtime or
build time), some are design references that shape the code but are not parsed by
it. This table records which is which and how each one is consumed, so nothing
here is mistaken for dead weight or for a live control it is not.

## Consumption map

| Spec | Version | Role | Read by | How | Artifact / Lineage Proof (Code & Schema) |
|---|---|---|---|---|---|
| [`guardrail.yaml`](guardrail.yaml) | - | **Runtime control** | [`apps/ai_service/app/guardrails.py`](../apps/ai_service/app/guardrails.py), [`apps/api_gateway/middleware/guardrails.mjs`](../apps/api_gateway/middleware/guardrails.mjs) | Loaded once at startup; drives input/output guardrail and PII-egress patterns live. | [`apps/ai_service/app/guardrails.py.check_output()[31]`](https://github.com/VincentChong123/euc-spreadsheet-uplift/blob/main/apps/ai_service/app/guardrails.py#L31) |
| [`error_codes.yaml`](error_codes.yaml) | - | **Build / validate** | [`specs/validate_error_codes.py`](validate_error_codes.py) | Single source of error keys; the validator asserts `errorCodes.mjs` and `errors.py` stay in sync with it. | [`specs/validate_error_codes.py.load_spec()[20]`](https://github.com/VincentChong123/euc-spreadsheet-uplift/blob/main/specs/validate_error_codes.py#L20) |
| [`prompt-records-schema.yaml`](prompt-records-schema.yaml) | v2 (current) | **Build / codegen** | [`apps/google-sheets-ui/sync_spec_yaml_note_schema.py`](../apps/google-sheets-ui/sync_spec_yaml_note_schema.py) | Generates the audit-sheet column order in `note_schema.js`, which `plugin_hitl_ai.js` writes against. | [`apps/ai_service/app/request_context.py.bind_request()[22]`](https://github.com/VincentChong123/euc-spreadsheet-uplift/blob/main/apps/ai_service/app/request_context.py#L22) |
| [`google-sheets-api-gateway-contract.yaml`](google-sheets-api-gateway-contract.yaml) | 2026-06-24 | **Build (contract)** | [`specs/sync_google_sheets_gateway_contract.py`](sync_google_sheets_gateway_contract.py) → [`apps/api_gateway/config/googleSheetsContract.mjs`](../apps/api_gateway/config/googleSheetsContract.mjs) | The UI/gateway boundary schema. The generator reads this YAML and writes `apps/api_gateway/generated/google-sheets-api-gateway-contract.json`, which the loader reads at runtime for `server.mjs`. The generated JSON is checked in so the chain runs without a build step. | [`apps/google-sheets-ui/sync_spec_yaml_note_schema.py.generate_js_from_yaml()[8]`](https://github.com/VincentChong123/euc-spreadsheet-uplift/blob/main/apps/google-sheets-ui/sync_spec_yaml_note_schema.py#L8) |
| [`program-sequence.md`](program-sequence.md) | - | **Documentation** | humans | End-to-end request flow / lineage. Not machine-consumed. | - |
| [`ba_business_schema.csv`](./backlog/schema_version/ba_business_schema.csv) | v1 → v3 | **Design reference** | none | Versioned business schema (v1 to v3) with per-field constraints. Not parsed by code. See TODO below. | - |
| [`ba_pii_rules_spec.csv`](./backlog/policies/ba_pii_rules_spec.csv) | - | **Design reference** | none | Target PII classification to action mapping (tokenize / partial-mask / hard-stop). Not parsed by code. See TODO below. | [`apps/api_gateway/middleware/egressPiiGuardrail.mjs.egressPiiGuardrail()[61]`](https://github.com/VincentChong123/euc-spreadsheet-uplift/blob/main/apps/api_gateway/middleware/egressPiiGuardrail.mjs#L61) |

---

📝 **Upcoming Work & Backlog:** See [**`TODO.md`**](TODO.md) for planned automation and pending schema-validation implementations.
