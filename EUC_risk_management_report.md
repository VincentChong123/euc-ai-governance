# EUC Governance Self-Review: "Governed AI Assistant" (doc-micro-access-ctr)

**From:** Self-review draft
**Date:** July 30, 2026
**Subject:** Governance self-review of the `doc-micro-access-ctr` proof-of-concept (EUC control-pattern uplift)

> *Illustrative draft. This is a self-review of a personal proof-of-concept. The controls were originally built from engineering instinct (immutability, provenance, bounded change). Any BCBS 239 readiness mapping is an AI-generated draft made **after** the build and is currently **under review** (temporarily removed from this document). It is not an official second-line audit.*

---

## Executive Summary (1-Minute Read)

The `doc-micro-access-ctr` proof-of-concept lets financial users delegate tasks from Google Sheets to a governed microservice backend, with the prompt authored in the cell note and every run written to an append-only audit record. It is a **control-pattern uplift** approach to EUC risk: keep the familiar grid, move the risk surface behind a governed gateway, and keep the records migration-ready.

### BCBS 239 readiness & challenge matrix

_TBD — under review. A 14-principle BCBS 239 readiness mapping (AI-generated draft) has been temporarily removed pending validation. The work-in-progress draft is preserved on the `draft/bcbs239-review` branch and in tag `v1.0.1`._

---

## 1. Identifying the EUC
The project identifies Google Sheets as the critical EUC frontend. Rather than migrating users to an unfamiliar platform (which often triggers resistance and shadow IT), it keeps the spreadsheet as the UI and shifts processing to a governed backend, bridging informal EUCs and governed IT.

## 2. Assessing the EUC Risk
Standard EUCs carry manual-error risk, poor data lineage, and weak auditability. The design mitigates these:
*   **API gateway:** a chokepoint for PII-egress control and audit trails.
*   **AI service:** typed request/response validation with output guardrails (refusal / length checks).
*   **Document service:** finalization is human-initiated, and each record carries a reference to native revision history for provenance.
*   **Bounded change by design:** the model produces content, not actions; write-scope and context selection are enforced in code rather than trusted to the model, so change and exposure stay bounded.

## 3. Governing the EUC — control-pattern uplift
This proof-of-concept demonstrates EUC **control-pattern uplift** via AI-driven transformation: it moves heavy processing to a governed backend and enforces error governance, while keeping the familiar grid for end users. It is a complement to migration, not a substitute: for critical, stable processes, migration to a robust IT solution remains the right endpoint, and because the governed records live in the backend, this design keeps that migration path open.

## 4. Known limitations & next controls
This is a proof-of-concept; its controls are first-line, with hardening planned. Stated plainly so the gaps are owned, not hidden:

*   **Execution path (ungated `doPost` write):** the PoC exposes both a human-triggered and a programmatic execution path to the *same* cell-write logic. The interactive path (`onGuiIconClick` → `processHitlAiBatch`) runs container-bound **as the active user**, so its writes obey that user's own Workspace cell/sheet protection. The programmatic path — the Apps Script `doPost(e)` web-app endpoint in `apps/google-sheets-ui/plugin_hitl_ai.js` — routes to the identical `processHitlAiBatch` write path and performs **no authentication on the payload** (it validates only that `sheet`/`range` are present). This endpoint was **actually deployed** as an Apps Script web app (a live `/exec` URL existed under its associated GCP project), with its downstream calls routed to the locally-hosted API gateway over the ngrok tunnel (see *Gateway exposure* below). So this was a **live, unauthenticated write path**, not a latent one — the ungoverned-AI-output risk this PoC is about, on the one path where human-in-the-loop is *intended* but not *enforced*. The residual blast radius depends on the deployment's access and execute-as settings (who may invoke it, and whose identity the writes run as), which should be recorded explicitly. Planned: retire or gate the programmatic path (caller authentication + human confirmation) so human-in-the-loop is a guaranteed property with no autonomous trigger.
*   **Gateway exposure:** the reference deployment fronts the API gateway over a public dev tunnel with no service-level authentication — a development convenience, not a production posture. The gateway enforces PII-egress and audit controls, but does not yet authenticate its callers, so those controls sit on an open boundary. Planned: caller authentication at the gateway (API key / mTLS) plus network egress restriction, so the chokepoint controls sit behind an authenticated perimeter.
*   **PII egress:** first-line regex on structured identifiers; fails open on a parse error. Planned: free-text DLP / NER and fail-closed handling.
*   **Attribution:** reference-based — the export stamps a Drive revision ID + timestamp that resolves to native revision history; the finalizer's identity is captured in an application log, not the artifact. Planned: propagate the finalizing user into an append-only sign-off record and verify identity at the service (not trust the gateway assertion).
*   **Records:** append-only and attributed, not signed or hashed. Planned: tamper-evidence (signing / hashing) if a DPO assessment requires it.
