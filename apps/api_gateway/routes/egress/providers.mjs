/**
 * LLM egress provider manifest.
 *
 * Each entry is mounted by server.mjs as an OpenAI-compatible egress proxy.
 * ai_service selects one at runtime via its LLM_PROVIDER setting; all mounted
 * providers are always available, so switching is a client-side env change.
 *
 * `apiKeyEnv` is read here (not at import of the module) so a missing key only
 * warns for the provider that lacks it, not the whole gateway.
 */
import { getGcpAccessToken } from './gcpToken.mjs';

export const EGRESS_PROVIDERS = [
    {
        name: 'OpenRouter API',
        mountPrefix: '/egress/openrouter',
        target: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api',
        apiKey: process.env.OPENROUTER_API_KEY,
        // OpenRouter uses these for routing attribution; harmless if omitted.
        extraHeaders: {
            'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://ringisho.local',
            'X-Title': process.env.OPENROUTER_TITLE || 'Ringisho',
        },
    },
    {
        name: 'Groq API',
        mountPrefix: '/egress/groq',
        target: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai',
        apiKey: process.env.GROQ_API_KEY,
    },
    // -------------------------------------------------------------------------
    // ENTERPRISE / COMPLIANCE path — Google Vertex AI (Gemini).
    // Native to Cloud Run: same GCP project, data stays in-region/in-tenant,
    // covered by your existing Google Cloud agreement. Uses Vertex's
    // OpenAI-compatible endpoint, so ai_service still speaks plain OpenAI format.
    //
    // Auth is NOT a static key: it uses a short-lived OAuth token minted from the
    // Cloud Run service account via the metadata server (no stored secret). The
    // factory refreshes it per-request (cached). Inert off Cloud Run unless ADC
    // is available.
    //   VERTEX_PROJECT_ID  = your GCP project (defaults to metadata project)
    //   VERTEX_LOCATION    = region, e.g. us-central1 / europe-west4
    //   LLM model id       = e.g. google/gemini-2.0-flash-001
    {
        name: 'Vertex AI',
        mountPrefix: '/egress/vertex',
        target: `https://${process.env.VERTEX_LOCATION || 'us-central1'}-aiplatform.googleapis.com`,
        // /egress/vertex/v1/chat/completions
        //   -> /v1/projects/{PROJECT}/locations/{LOCATION}/endpoints/openapi/chat/completions
        pathRewrite: {
            [`^/egress/vertex/v1`]:
                `/v1/projects/${process.env.VERTEX_PROJECT_ID || 'REPLACE_PROJECT'}` +
                `/locations/${process.env.VERTEX_LOCATION || 'us-central1'}/endpoints/openapi`,
        },
        // Dynamic OAuth token from the Cloud Run SA (metadata server / ADC).
        getAuthToken: getGcpAccessToken,
    },
];
