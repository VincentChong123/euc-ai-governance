# euc-ai-governance

> **EUC governance done right: AI output governed like risk data.**
> A proof-of-concept: keep users in the spreadsheet grid they won't give up, but move
> the risk surface (PII egress, provenance, system-of-record) behind a governed gateway.
> Curated subset of a larger private system (Google Sheets UI → API gateway → AI /
> document microservices). This repo is a guided tour of the **data-governance** design.

🔗 **Guided tour (GitHub Pages):** enable Pages on `main` / `/docs` → served from `docs/index.html`.

📋 **[EUC governance self-review](EUC_risk_management_report.md)** — an illustrative
self-assessment mapping the design to the 14 BCBS 239 principles (readiness vs. gaps).

📌 **Release:** [v1.0.1](https://github.com/VincentChong123/euc-ai-governance/releases/tag/v1.0.1)

---

## The EUC problem this addresses

The biggest off-book risk in a bank is the **End-User Computing (EUC)** layer —
spreadsheets doing critical work with no version control, no lineage, no attribution.
The blunt fix (ban spreadsheets, force everything into slow IT) fails: users revolt and
build shadow IT, which *increases* risk.

This project takes the other path — **control at the point of materiality**:
- Users stay in the **familiar Google Sheet grid**.
- The material risk surface — data leaving to an LLM, PII, provenance, system-of-record
  — moves **behind a governed gateway**.
- Outputs become **append-only, attributed records** outside the EUC.

That is EUC control-uplift aligned to how a bank governs risk data, not spreadsheet removal.

---

## What this repo demonstrates

An AI output is just another data element with poor lineage by default. It's held to the
same three questions a bank asks of any risk number:

1. **Data Schema** — every boundary is a typed, versioned contract with a single source of truth.
2. **Data Lineage & Provenance** — `request_id → run_id → attempt` on every material output.
3. **Data Governance & Controls** — PII egress control, human-in-the-loop execution, guardrails, error-key governance.

### 1 · Data Schema (contract-first)
| File | What it shows |
|---|---|
| [`specs/google-sheets-api-gateway-contract.yaml`](specs/google-sheets-api-gateway-contract.yaml) | The **schema contract** between the EUC (Sheet) and the gateway — the boundary is a defined interface. |
| [`specs/ba_business_schema.csv`](specs/ba_business_schema.csv) | Business schema with **versioned evolution (v1→v2→v3)** and per-field constraints. |
| [`specs/prompt-records-schema.yaml`](specs/prompt-records-schema.yaml) | Schema for AI prompt records — structured, auditable. |
| [`apps/ai_service/app/models/schemas.py`](apps/ai_service/app/models/schemas.py) | Schema **enforced in code** (typed validation at runtime). |
| [`apps/google-sheets-ui/sync_spec_yaml_note_schema.py`](apps/google-sheets-ui/sync_spec_yaml_note_schema.py) | Schema kept **in sync from a single source of truth** — no drift. |

### 2 · Data Lineage & Provenance
| File | What it shows |
|---|---|
| [`apps/ai_service/app/request_context.py`](apps/ai_service/app/request_context.py) | The **`request_id → run_id → attempt`** provenance chain — every output traceable end to end. |
| [`specs/prompt-records-schema.yaml`](specs/prompt-records-schema.yaml) | **Append-only** audit trail of AI interactions — reconstructable after the fact. |
| [`specs/program-sequence.md`](specs/program-sequence.md) | End-to-end flow / lineage of a request across services. |

### 3 · Data Governance & Controls
| File | What it shows |
|---|---|
| [`specs/ba_pii_rules_spec.csv`](specs/ba_pii_rules_spec.csv) | **PII classification → action mapping**. A governance table in one file. |
| [`apps/api_gateway/middleware/egressPiiGuardrail.mjs`](apps/api_gateway/middleware/egressPiiGuardrail.mjs) | **PII egress control** (regex, structured identifiers) — governs data *leaving the EUC* to the LLM (the material risk surface). First-line control; free-text PII would need DLP/NER. |
| [`specs/guardrail.yaml`](specs/guardrail.yaml) · [`apps/ai_service/app/guardrails.py`](apps/ai_service/app/guardrails.py) | Guardrail definitions + enforcement. |
| [`apps/google-sheets-ui/plugin_hitl_ai.js`](apps/google-sheets-ui/plugin_hitl_ai.js) | **Human-in-the-loop execution** — the human authors the prompt and selects context; model output is confined to the target cell (no autonomous side-effects). |
| [`specs/error_codes.yaml`](specs/error_codes.yaml) · [`specs/validate_error_codes.py`](specs/validate_error_codes.py) | Error-**key** governance (`__ERROR_*__`), validated — never a raw status number. |

---

## Design principles (mapped to banking risk-data governance)
- **EUC governance at materiality** → keep the workflow, govern the risk surface (control-uplift, not blunt removal that breeds shadow IT; records kept migration-ready).
- **Contract at every boundary** → schema-contract onboarding (aligns with BCBS 239 P2, data architecture).
- **Provenance on every output** → reconstruct & defend any number (aligns with BCBS 239 P7, reconcile-to-source).
- **Cell-level change & context control** → the model edits only the targeted cell and sees only selected cells as context, bounding both change and exposure.
- **Append-only, attributed records** → subledger discipline, applied to AI output. (Cryptographic integrity — hashing, then signing — is a noted next control, not yet built.)

## Security
Curated snapshot with **no credentials, no real PII, and no production data** (sample
values in the spec CSVs are synthetic). Secrets are handled via environment /
secret-manager and never committed; a TruffleHog ruleset
([`.trufflehog/rules.yaml`](.trufflehog/rules.yaml)) guards for key patterns. Verified
with gitleaks & TruffleHog before publishing — see [`SECURITY.md`](SECURITY.md).

---

*Author: Vincent Chong*
