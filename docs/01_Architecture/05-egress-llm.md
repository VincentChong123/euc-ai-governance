# 05 · LLM Egress Gateway (cross-cutting)

> **Egress** = *outbound* traffic — calls leaving our system to an external
> service (here, the LLM providers). Its opposite is **ingress** = *inbound*
> traffic coming into the system.

How internal services reach external LLM providers **without holding any key**.
The gateway is the only component that sees provider credentials.

## Principle: secret encapsulation

- Backend services (e.g. `ai_service`) speak plain **OpenAI chat-completions**
  format to a gateway route `/egress/<provider>/v1/...`.
- The gateway injects the provider credential and forwards to the real provider.
- Keys live **only** in the gateway env (dev: docker `env_file`; prod: Cloud Run
  secret→env, or the service account for Vertex).

## Providers

| Provider | Mount | Auth | Notes |
|---|---|---|---|
| OpenRouter (primary) | `/egress/openrouter` | `Authorization: Bearer` (static) | `OPENROUTER_API_KEY` |
| Groq (secondary) | `/egress/groq` | `Authorization: Bearer` (static) | `GROQ_API_KEY` |
| Vertex AI (enterprise) | `/egress/vertex` | GCP OAuth (dynamic, no stored key) | Cloud Run service account |

Defined in `apps/api_gateway/routes/egress/providers.mjs`; built by the shared
`factory.mjs`.

## Provider switching (no code change)

The active provider is chosen by `ai_service` via **`LLM_PROVIDER`**. All egress
routes are always mounted; switching is an env flip:

- `LLM_PROVIDER=openrouter` (default) → `/egress/openrouter`
- `LLM_PROVIDER=groq` → bypasses OpenRouter
- `LLM_PROVIDER=vertex` → enterprise path (Cloud Run only)

**OpenRouter uses a `FallbackModel` chain in `ai_service`** (not in the gateway) —
pydantic-ai rotates to the next model on 429/5xx before the request ever reaches
the gateway egress a second time. See [02-ai-service.md](../01_Architecture/02-ai-service.md) for the chain definition.

For Groq and Vertex there is **no automatic runtime failover** — deliberate low-bug
choice. Failover would require buffering + replay in the gateway.

## Vertex auth detail

Vertex uses short-lived OAuth tokens, not a static key. `gcpToken.mjs` mints them
from the Cloud Run **metadata server** (cached, auto-refreshed, zero stored
secret). Off Cloud Run the token is unavailable and the route returns a graceful
`502` (`__ERROR_AUTH_UNAVAILABLE__`). The factory returns a `[tokenMiddleware,
proxy]` pair for token-based providers.

## Adding a provider

1. Add an entry to `providers.mjs` (static key → `apiKey`; OAuth → `getAuthToken`).
2. Add it to `_PROVIDER_DEFAULTS` in `apps/ai_service/app/config.py` (mount + model).
3. Update this page.
