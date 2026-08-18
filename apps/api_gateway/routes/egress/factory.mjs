/**
 * Generic LLM egress proxy factory.
 *
 * Builds a transparent OpenAI-compatible reverse proxy for a single LLM
 * provider. Internal services (ai_service) post standard OpenAI chat-completion
 * payloads to `/egress/<provider>/v1/...`; this proxy injects the provider API
 * key and forwards to the provider's OpenAI-compatible API.
 *
 * Secret encapsulation: provider keys live ONLY in the gateway environment.
 * Upstream callers never see them.
 *
 * NOTE: http-proxy-middleware v3 requires event handlers under `on:` — the
 * top-level `onProxyReq`/`onError` form is a v2 API that silently no-ops in v3.
 */
import { createProxyMiddleware } from 'http-proxy-middleware';
import { logger } from '../../utils/logger.mjs';
import { egressPiiGuardrail } from '../../middleware/egressPiiGuardrail.mjs';

/**
 * @param {object} cfg
 * @param {string} cfg.name          Human label for logs (e.g. "Groq API").
 * @param {string} cfg.mountPrefix   Mount path (e.g. "/egress/groq").
 * @param {string} cfg.target        Upstream base URL (before the /v1 segment).
 * @param {string} [cfg.apiKey]      Secret injected server-side.
 * @param {string} [cfg.apiKeyHeader='Authorization'] Header to carry the key.
 * @param {string} [cfg.apiKeyPrefix='Bearer '] Value prefix (Azure uses '').
 * @param {object} [cfg.pathRewrite] Override the default `{^mount: ''}` rewrite.
 * @param {() => Promise<string|null>} [cfg.getAuthToken] Async token provider
 *        (e.g. GCP OAuth). Overrides the static apiKey when present; the token
 *        is resolved by a pre-proxy middleware and sent as `Bearer <token>`.
 * @param {object} [cfg.extraHeaders] Static headers to add on every request.
 * @returns {import('express').RequestHandler|import('express').RequestHandler[]}
 */
export function createEgressProxy({
    name,
    mountPrefix,
    target,
    apiKey,
    apiKeyHeader = 'Authorization',
    apiKeyPrefix = 'Bearer ',
    pathRewrite,
    getAuthToken,
    extraHeaders = {},
}) {
    if (!apiKey && !getAuthToken) {
        logger.warn(`⚠️ ${name} key not set — ${mountPrefix} will forward without auth (upstream will reject with 401).`);
    }

    const proxy = createProxyMiddleware({
        target,
        changeOrigin: true,
        // LLM calls are slower than service-to-service; allow a generous but
        // bounded upstream timeout so a stalled provider can't hang the gateway.
        proxyTimeout: Number(process.env.LLM_EGRESS_TIMEOUT_MS) || 120_000,
        // /egress/<provider>/v1/... -> {target}/v1/...
        pathRewrite: pathRewrite || { [`^${mountPrefix}`]: '' },
        on: {
            proxyReq: (proxyReq, req) => {
                // Dynamic token (resolved by the pre-proxy middleware) wins;
                // otherwise fall back to the static key.
                if (req._egressToken) {
                    proxyReq.setHeader('Authorization', `Bearer ${req._egressToken}`);
                } else if (apiKey) {
                    proxyReq.setHeader(apiKeyHeader, `${apiKeyPrefix}${apiKey}`);
                }
                for (const [header, value] of Object.entries(extraHeaders)) {
                    proxyReq.setHeader(header, value);
                }
                // If egressPiiGuardrail redacted the body, write the clean version.
                if (req._rawBody) {
                    proxyReq.setHeader('Content-Length', req._rawBody.byteLength);
                    proxyReq.write(req._rawBody);
                    proxyReq.end();
                }
                req._egressStartTime = Date.now();
                logger.info(
                    {
                        request_id: req.id,
                        attempt: req.headers['x-request-attempt'],
                        method: req.method,
                        path: req.originalUrl,
                        target,
                        piiRedacted: req._egressPii?.redactions?.length ?? 0,
                    },
                    `[Egress] -> ${name}`,
                );
            },
            proxyRes: (proxyRes, req) => {
                const latencyMs = Date.now() - (req._egressStartTime || Date.now());
                logger.info(
                    { request_id: req.id, attempt: req.headers['x-request-attempt'], statusCode: proxyRes.statusCode, latencyMs },
                    `[Egress] <- ${name}`,
                );
            },
            error: (err, req, res) => {
                logger.error({ err, request_id: req.id }, `[Egress] ${name} proxy error`);
                if (!res.headersSent) {
                    res.status(502).json({
                        error: `Unable to reach ${name}.`,
                        detail: err.message,
                        request_id: req.id,
                    });
                }
            },
        },
    });

    // Static-key providers: PII guardrail + proxy.
    if (!getAuthToken) {
        return [egressPiiGuardrail, proxy];
    }

    // Token-based providers (e.g. Vertex): resolve the OAuth token BEFORE the
    // proxy fires (proxyReq is synchronous and can't await), stash it on req.
    async function attachToken(req, res, next) {
        const token = await getAuthToken();
        if (!token) {
            logger.error({ request_id: req.id }, `[Egress] ${name}: no auth token available`);
            return res.status(502).json({
                error: `${name} auth unavailable.`,
                detail: 'Could not mint a GCP access token (not on Cloud Run / ADC missing).',
                request_id: req.id,
            });
        }
        req._egressToken = token;
        next();
    }

    return [egressPiiGuardrail, attachToken, proxy];
}
