# Governed AI Microservice

**Portfolio · Data Governance**

This project applies critical data governance principles—**schema**, **lineage**, and **controls**—to AI-generated outputs. By treating AI output as a standard data element, it ensures appropriate oversight and traceability.

> A guided tour of the design. [Source]((https://github.com/VincentChong123/euc-spreadsheet-uplift))

## Architecture Overview
Refer to the architecture [diagram](../README.md).

## Core Governance Pillars

1. **Data Schema (Contract-First)**: Key integration points use typed, versioned contracts.
2. **Data Lineage & Traceability**: Structured tracking (`request_id → run_id → attempt`) for material outputs.
3. **Data Governance & Controls**: Controls are implemented at the point of materiality, encompassing PII egress, guardrails, and error management.

📖 **Deep Dive:** For a detailed map of the spec files, schemas, and how they are consumed across the codebase, please see the **[Consumption map](specs/README.md)**.

## Design Principles

- **Contract at key boundaries**: Ensures strict interface definitions.
- **Provenance on material outputs**: Supports record reconstruction and auditing.
- **Control at the point of materiality**: Focuses PII egress controls on the external risk surface.
- **Append-only, attributed records**: Applies structured auditing to AI outputs.

---

**Security:** This repository is a curated snapshot containing no credentials, real PII, or production data. It has been verified with security scanning tools (gitleaks & TruffleHog) prior to publishing.
