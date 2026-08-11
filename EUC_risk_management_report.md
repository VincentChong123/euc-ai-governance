# EUC Governance Self-Review: "Governed AI Assistant" (doc-micro-access-ctr)

**From:** Vincent Chong — draft self-review
**Date:** July 30, 2026
**Subject:** Governance self-review of the `doc-micro-access-ctr` proof-of-concept (EUC control-uplift)

> *Illustrative draft. This is a self-review of a personal proof-of-concept. The controls were originally built from engineering instinct (immutability, provenance, bounded change). The matrix below is an AI-generated review drafted **after** the build to evaluate how the architecture aligns with BCBS 239 readiness and to identify governance gaps. It is not an official second-line audit.*

---

## Executive Summary (1-Minute Read)

The `doc-micro-access-ctr` proof-of-concept lets financial users delegate tasks from Google Sheets to a governed microservice backend, with a **human-in-the-loop gate on every material action (no autonomous side-effects)**. It is a **control-uplift** approach to EUC risk: keep the familiar grid, move the risk surface behind a governed gateway, and keep the records migration-ready.

The table below maps the design's readiness against the **14 BCBS 239 principles**, showing what is built versus the risk-management challenges still to address.

### BCBS 239 readiness & challenge matrix

| # | BCBS 239 Principle | Readiness (what's built) | Challenge (to address) |
|---|---|---|---|
| **I.** | **Governance and Infrastructure** | | |
| 1 | **Governance** | API gateway centrally logs all interactions and approvals. | Defining clear data ownership between business users and IT. |
| 2 | **Data Architecture & IT** | Cloud Run microservices behind the sheet (backend, not a replacement for it). | Reducing shadow IT and manual workarounds over time. |
| **II.** | **Risk Data Aggregation** | | |
| 3 | **Accuracy & Integrity** | Typed validation at the AI service boundary. | Keeping key data elements consistent across systems. |
| 4 | **Completeness** | Mandatory fields enforced before task execution. | Identifying and capturing all critical off-system data sources. |
| 5 | **Timeliness** | Real-time API execution with write-back to Sheets. | Maintaining SLAs and stability during peak processing. |
| 6 | **Adaptability** | Modular microservices allow rapid deployment of new rules. | Adapting quickly to ad-hoc, urgent regulatory queries. |
| **III.**| **Risk Reporting** | | |
| 7 | **Accuracy** | Provenance chain (`request_id → run_id → attempt`) makes any output reconstructable. | Reconciling system outputs with the golden source. |
| 8 | **Comprehensiveness** | Consolidates inputs from multiple streams via the gateway. | Ensuring all material risks are represented in the UI. |
| 9 | **Clarity & Usefulness** | Presents AI outputs in the familiar Google Sheets UI. | Designing views tailored to senior-management needs. |
| 10 | **Frequency** | On-demand generation and task execution. | Enforcing schedules for routine compliance reporting. |
| 11 | **Distribution** | PII-egress controls at the gateway (regex, structured identifiers). | Free-text PII and confidential data across geographies (needs DLP/NER). |
| **IV.** | **Supervisory Review** | | |
| 12 | **Review** | Append-only, hashed audit records; data lineage available. | Preparing full evidence for internal/external audits. |
| 13 | **Remedial Actions** | Standardized error-key handling (`error_key` specification). | Tracking exceptions to full closure. |
| 14 | **Home/Host Cooperation** | Cloud deployment, geographically agnostic. | Aligning APAC standards with global Head Office policies. |

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
