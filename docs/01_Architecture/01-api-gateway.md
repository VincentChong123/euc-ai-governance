# 01 · API Gateway

**Path:** `apps/api_gateway` · **Stack:** Node 20 / Express 4 / http-proxy-middleware v3 / pino

Single entrypoint to the system. Plays **two** roles:

1. **Ingress** (inbound — requests coming *into* the system) — public reverse
   proxy in front of the internal microservices.
2. **Egress** (outbound — calls going *out* to external services) — internal-only
   OpenAI-compatible proxy to external LLM providers, injecting provider keys so
   downstream services stay key-less.

## Responsibilities

- Terminate the Google Sheets **contract envelope**, validate it, forward to
  `ai_service`, and re-wrap the response (`server.mjs`, "Contract Adapter").
- Proxy `/api/*` routes to backend services from a declarative manifest
  (`config/routes.mjs`).
- Proxy `/egress/*` to LLM providers (`routes/egress/*`) — see
  [05-egress-llm.md](05-egress-llm.md).
- Assign/propagate `X-Request-ID`; structured logging; health/readiness.

## Key files

| File | Role |
|---|---|
| `server.mjs` | App wiring, contract adapter, proxy loop, startup, shutdown |
| `config/routes.mjs` | Declarative ingress route manifest (`PROXY_ROUTES`) |
| `config/errorCodes.mjs` | Error registry (see [../03_Reference/error_code_spec.md](../03_Reference/error_code_spec.md)) |
| `routes/egress/factory.mjs` | Generic egress proxy factory — prepends `egressPiiGuardrail` on every provider |
| `routes/egress/providers.mjs` | LLM provider manifest (openrouter/groq/vertex) |
| `routes/egress/gcpToken.mjs` | Vertex OAuth token from Cloud Run metadata server |
| `middleware/requestId.mjs` | Request-ID assignment/propagation |
| `middleware/errorHandler.mjs` | Terminal JSON error envelope |
| `middleware/guardrails.mjs` | PII/injection guardrail — crossings ① ② ④; exports `scanText()`, `getPatterns()` |
| `middleware/egressPiiGuardrail.mjs` | Egress PII scan — crossing ③ (outbound to LLM) |
| `utils/logger.mjs` | pino facade (JSON-only, redacts secrets) |

## Routes

- **Ingress:** `/api/ai` → ai_service, `/api/workflow` → document_service
  (stripped prefix; `proxyTimeout` bounded). `/healthz`, `/readyz` (probes all
  upstreams from the same manifest).
- **Egress:** `/egress/openrouter`, `/egress/groq`, `/egress/vertex`.
- **Guardrail meta:** `GET /guardrail/patterns` — serves compiled PII + injection
  rule metadata (no secrets) so clients (sidebar) can mirror the same rules for
  UX pre-flight scanning.

## PII guardrail — four enforced crossings

The gateway is the organisation boundary. All PII enforcement is centralised here;
no service inside or outside needs its own PII scanner.

| # | Crossing | Mechanism | Action |
|---|---|---|---|
| ① | Sheets → gateway (inbound prompt) | `guardrailMiddleware` before contract adapter | injection → `__ERROR_VALIDATION__` 422; PII → `[REDACTED:<name>]` + log |
| ② | Gateway → ai_service | same middleware (same request body, already redacted by ①) | — |
| ③ | Gateway egress → LLM (outbound) | `egressPiiGuardrail` prepended in every egress chain | scans `messages[].content`; redacts before prompt leaves org |
| ④ | LLM → gateway → Sheets (return) | `scanText()` in contract adapter after upstream response parsed | scans `result`; redacts before Sheets sees it |

Rules are parameterized in **`specs/guardrail.yaml`** — edit patterns there, restart
gateway, all four crossings update. See [07-security-auditability.md](../Governance/07-security-auditability.md).

## Production hardening (in place)

- Upstream timeouts: `UPSTREAM_TIMEOUT_MS` (default 30s) on contract fetch +
  proxied routes; `LLM_EGRESS_TIMEOUT_MS` (default 120s) on egress.
- Body limit: `JSON_BODY_LIMIT` (default 1mb).
- Port guard: exits on `EADDRINUSE` instead of half-starting.
- Graceful shutdown: drains on `SIGTERM`/`SIGINT` (Cloud Run rollouts).

## Known gaps / decisions

- **No ingress authentication** (deliberately deferred). The public URL is *not*
  protected by the Google Sheet's ACL — top remaining production risk.
- **No rate limiting** yet (`__ERROR_RATE_LIMIT__` reserved in the registry).
- Error registry exists but source still emits legacy string codes — adopt
  gradually (see [../03_Reference/error_code_spec.md](../03_Reference/error_code_spec.md)).

## Run

```bash
cd apps/api_gateway && set -a && . ../../.env && set +a && node server.mjs   # :3000
```
