# EUC Governance Self-Review: "Governed AI Assistant" (doc-micro-access-ctr)

**From:** Vincent Chong — draft self-review
**Date:** July 30, 2026
**Subject:** Governance self-review of the `doc-micro-access-ctr` proof-of-concept (EUC control-uplift)

> *Illustrative draft. This is a self-review of a personal proof-of-concept. The controls were originally built from engineering instinct (immutability, provenance, bounded change). Any BCBS 239 readiness mapping is an AI-generated draft made **after** the build and is currently **under review** (temporarily removed from this document). It is not an official second-line audit.*

---

## Executive Summary (1-Minute Read)

The `doc-micro-access-ctr` proof-of-concept lets financial users delegate tasks from Google Sheets to a governed microservice backend, with **human-in-the-loop execution — the human authors the prompt and selects context, and model output is confined to the target cell (no autonomous side-effects)**. It is a **control-uplift** approach to EUC risk: keep the familiar grid, move the risk surface behind a governed gateway, and keep the records migration-ready.

### BCBS 239 readiness & challenge matrix

_TBD — under review. A 14-principle BCBS 239 readiness mapping (AI-generated draft) has been temporarily removed pending validation. The work-in-progress draft is preserved on the `draft/bcbs239-review` branch and in tag `v1.0.1`._

---

## 1. Identifying the EUC (Ref: 1.2.2.1)
The project identifies Google Sheets as the critical EUC frontend. Rather than migrating users to an unfamiliar platform (which often triggers resistance and shadow IT), it keeps the spreadsheet as the UI and shifts processing to a governed backend, bridging informal EUCs and governed IT.

## 2. Assessing the EUC Risk (Ref: 1.2.2.2)
Standard EUCs carry manual-error risk, poor data lineage (Ref: 1.1.2), and weak auditability. The design mitigates these:
*   **API gateway:** a chokepoint for PII-egress control and audit trails.
*   **AI service:** typed, human-in-the-loop execution; no autonomous side-effects.
*   **Document service:** formalizes approvals with provenance.
*   **Cell-level control:** the model edits only the targeted cell and takes only selected cells as context, so change and exposure are both bounded.

## 3. Governing the EUC — control-uplift (Ref: 1.2.2.3)
This proof-of-concept demonstrates EUC **control-uplift** via AI-driven transformation (Ref: 1.3): it moves heavy processing to a governed backend and enforces error governance, while keeping the familiar grid for end users. It is a complement to migration, not a substitute: for critical, stable processes, migration to a robust IT solution remains the right endpoint, and because the governed records live in the backend, this design keeps that migration path open.
