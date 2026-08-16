# Governed AI Microservice

**Portfolio · Data Governance**

Governing AI output the way a bank governs critical data: **schema**, **lineage**, and
**governance controls**. An AI output is just another data element with poor lineage by
default; this project holds it to the same questions a bank asks of any critical data element.

> A readable guided tour of the design. Source repo:
> [VincentChong123/euc-spreadsheet-uplift](https://github.com/VincentChong123/euc-spreadsheet-uplift).

## 1 · Data Schema: contract-first

Key boundaries are typed, versioned contracts with a single source of truth.

- [`specs/google-sheets-api-gateway-contract.yaml`](../specs/google-sheets-api-gateway-contract.yaml): the schema contract between UI and gateway; the boundary is a defined interface, not an assumption.
- [`specs/ba_business_schema.csv`](../specs/ba_business_schema.csv): business schema with versioned evolution (v1→v2→v3) and per-field constraints.
- [`apps/ai_service/app/models/schemas.py`](../apps/ai_service/app/models/schemas.py): schema enforced in code; typed validation at runtime.
- [`apps/google-sheets-ui/sync_spec_yaml_note_schema.py`](../apps/google-sheets-ui/sync_spec_yaml_note_schema.py): keeps schema in sync from a single source of truth; no drift between spec and code.

## 2 · Data Lineage & Traceability

`request_id → run_id → attempt` on material outputs.

- [`apps/ai_service/app/request_context.py`](../apps/ai_service/app/request_context.py): the provenance chain; material outputs traceable through the run chain.
- [`specs/prompt-records-schema.yaml`](../specs/prompt-records-schema.yaml): append-only, structured audit trail of AI interactions; reconstructable after the fact.
- [`specs/program-sequence.md`](../specs/program-sequence.md): end-to-end flow / lineage of a request across services.

## 3 · Data Governance & Controls

Control at the point of materiality: PII egress, guardrails, error-key governance.

- [`specs/ba_pii_rules_spec.csv`](../specs/ba_pii_rules_spec.csv): **target** PII classification → action mapping (design intent: tokenize / partial-mask / hard-stop). The implemented control is uniform first-line redaction (below); the tiered actions are not yet built.
- [`apps/api_gateway/middleware/egressPiiGuardrail.mjs`](../apps/api_gateway/middleware/egressPiiGuardrail.mjs): PII egress control; governs data leaving to the LLM, the material risk surface. First-line control: it **redacts** structured identifiers (does not block/tokenize) and **fails open on a parse error**; free-text PII would need DLP/NER.
- [`apps/google-sheets-ui/plugin_hitl_ai.js`](../apps/google-sheets-ui/plugin_hitl_ai.js): prompt authored in the cell note → LLM call → result and audit record written back to the sheet.
- [`specs/error_codes.yaml`](../specs/error_codes.yaml): error-key governance (`__ERROR_*__`), validated; never a raw status number.

## Design principles: mapped to banking critical data governance

- **Contract at key boundaries** → schema-contract onboarding.
- **Provenance on material outputs** → reconstruct and defend any record.
- **Control at the point of materiality** → PII egress control where the risk is, not everywhere.
- **Append-only, attributed records** → subledger discipline, applied to AI output.

---

**Security:** curated snapshot: no credentials, no real PII, no production data. Verified
with gitleaks & TruffleHog before publishing.
