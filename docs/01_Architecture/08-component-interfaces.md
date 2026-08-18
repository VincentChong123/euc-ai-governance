# 08 · Component Interfaces — Sheets UI ↔ Gateway ↔ AI Service

Block diagram of the **contracts and responsibilities** across the three
components on the synchronous AI path. Shows *what crosses each boundary* — not
internal logic (see each component's own page for that).

> Scope: the **currently implemented** single-turn path
> (`/api/ai/v1/sheet-chat`). The future streaming/agentic path is noted at the
> bottom.
>
> Terminology: **ingress** = *inbound* (a request entering our system);
> **egress** = *outbound* (a call our system makes to an external service).

---

## Interface block diagram

```mermaid
flowchart TB
    subgraph GS["🗂️ google-sheets-ui  (Apps Script + sidebar.html)"]
        direction TB
        UI["sidebar.html<br/>prompt · context · memo · thinking panel"]
        CORE["plugin_hitl_ai.js<br/>processHitlAiBatch()<br/>• resolve ranges (client-side)<br/>• build contract envelope"]
        ENG["Code.js · callCorporateAiEngineV2()<br/>• read auth email (UserProperties)<br/>• PII mask (PrivacyEngine)<br/>• UrlFetchApp POST"]
        REC[("__Prompt_records_v2<br/>audit sheet — client-written")]
        UI --> CORE --> ENG
        CORE -->|"logToPromptRecords()"| REC
    end

    subgraph GW["⚙️ api_gateway  (Node / Express)"]
        direction TB
        RID["requestId middleware<br/>assign / propagate x-request-id"]
        GRD["guardrail middleware<br/>① injection → 422<br/>② PII → redact"]
        ADP["contract adapter<br/>validate {meta,payload}<br/>→ forward → re-wrap response"]
        EGR["egress proxy<br/>/egress/&lt;provider&gt;<br/>injects provider key"]
        RID --> GRD --> ADP
    end

    subgraph AI["🤖 ai_service  (Python / FastAPI / pydantic-ai)  — key-less"]
        direction TB
        RT["routes.py · POST /v1/sheet-chat<br/>Logfire span · build meta"]
        AG["simple_agent.py · generate_summary()<br/>pydantic-ai Agent.run()"]
        OG["guardrails.py · check_output()<br/>③ refusal · ④ length"]
        RT --> AG --> OG
    end

    LLM["☁️ LLM Provider<br/>OpenRouter / Groq / Vertex"]

    %% ── cross-boundary contracts ──
    ENG ==>|"① INGRESS  HTTPS POST /api/ai/v1/sheet-chat<br/>header: x-request-id<br/>body: { meta, payload:{ prompt, context,<br/>instruction, masking } }"| RID
    ADP ==>|"② forward  POST /v1/sheet-chat<br/>SheetPromptRequest { prompt, context, user }"| RT
    AG  ==>|"③ EGRESS  OpenAI chat-completions<br/>(key-less; base_url = gateway egress)"| EGR
    EGR ==>|"④ provider call + key"| LLM
    LLM ==>|"OpenAI-format response"| EGR ==> AG
    OG  ==>|"⑤ { result, meta:{ request_id, run_id,<br/>latency_ms, model_invoked, agent_name } }"| ADP
    ADP ==>|"⑥ re-wrapped contract response"| ENG
```

---

## Boundary contracts (what each interface guarantees)

| # | Boundary | Direction | Payload / contract |
|---|---|---|---|
| ① | Sheets UI → Gateway | ingress | Contract envelope `{ meta, payload }`; `x-request-id` header; prompt/context **already PII-masked client-side** |
| ② | Gateway → AI Service | internal | `SheetPromptRequest { prompt, context, user }`; guardrail-cleaned |
| ③ | AI Service → Gateway | egress | Plain **OpenAI chat-completions**, key-less (base_url points at gateway egress) |
| ④ | Gateway → Provider | egress | Same body **+ injected provider credential** |
| ⑤ | AI Service → Gateway | return | `{ result, meta:{ request_id, run_id, latency_ms, model_invoked, agent_name, timestamp } }` |
| ⑥ | Gateway → Sheets UI | return | Re-wrapped contract response; client re-hydrates PII, writes cell + audit row |

## Responsibility split (key facts)

- **Range resolution is client-side.** `ai_service` never reads Sheets — it
  receives `context` as a pre-resolved string. It is **key-less and isolated**.
- **`__Prompt_records_v2` is written by the Apps Script client**, not by
  `ai_service`. The sheet is a *human-readable mirror*, not the system of record
  (see [07-security-auditability.md](../Governance/07-security-auditability.md) §4).
- **Provider credentials live only in the gateway egress** — `ai_service` stays
  key-less ([05-egress-llm.md](05-egress-llm.md)).
- **Two guardrail layers**: input at the gateway (injection/PII), output at
  `ai_service` (refusal/length).
- **`x-request-id` is the correlation key** propagated across every hop.

## Known interface gaps (tracked)

- **No verified identity crosses ①.** `meta.user` is an *unsigned claim*; the
  gateway does not authenticate it — top production risk
  ([07-security-auditability.md](../Governance/07-security-auditability.md) §1).
- Response is **single-shot JSON** — no intermediate progress. See the future
  streaming path below.

## Future: streaming / agentic path (not yet implemented)

For long agentic runs, a second interface is added **alongside** ①: the browser
streams directly from the gateway over SSE (`text/event-stream`), authenticated
by a Google-signed OIDC token minted server-side by Apps Script and verified at
the gateway. `ai_service` emits curated `thinking` milestones via
`StreamingResponse`. This does **not** replace the sync path — it augments it.
The end-to-end sequence for both is in
[09-end-to-end-sequence.md](09-end-to-end-sequence.md).
