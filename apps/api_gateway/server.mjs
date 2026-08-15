import express from 'express';

if (process.env.IS_DEV !== 'false') {
    const { config } = await import('dotenv');
    config({ path: new URL('../../.env', import.meta.url).pathname });
}
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import swaggerUi from 'swagger-ui-express';
import { createProxyMiddleware } from 'http-proxy-middleware';

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Production tunables (env-overridable).
// Upstream service calls (contract adapter + proxied microservices).
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 30_000;
// AI contract calls need more headroom: LLM tool calls + 429 retries can take 60-90s.
const AI_CONTRACT_TIMEOUT_MS = Number(process.env.AI_CONTRACT_TIMEOUT_MS) || 120_000;
// Max inbound JSON body — bounds abuse / accidental huge payloads.
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '1mb';

import { logger } from './utils/logger.mjs';
import { PROXY_ROUTES } from './config/routes.mjs';
import { loadGoogleSheetsGatewayContract } from './config/googleSheetsContract.mjs';
import { requestId } from './middleware/requestId.mjs';
import { errorHandler } from './middleware/errorHandler.mjs';
import { guardrailMiddleware, getPatterns, scanText } from './middleware/guardrails.mjs';
import { createEgressProxy } from './routes/egress/factory.mjs';
import { EGRESS_PROVIDERS } from './routes/egress/providers.mjs';

// Mount request ID as the very first middleware
app.use(requestId);

const GATEWAY_CONTRACT = loadGoogleSheetsGatewayContract();

const ACTIVE_ROUTES = PROXY_ROUTES.filter((r) => r.isActive);
logger.info(`⚙️  Active services: ${ACTIVE_ROUTES.map((r) => r.description).join(', ') || 'none'}`);
logger.info(`🚫 Inactive services: ${PROXY_ROUTES.filter((r) => !r.isActive).map((r) => r.description).join(', ') || 'none'}`);

// ==============================================================
// SHARED UTILITIES
// ==============================================================

function buildServiceUrl(baseUrl, pathname) {
    return new URL(pathname, baseUrl).toString();
}

function buildProxyPath(route, originalPath) {
    if (!route.stripPrefix || !originalPath.startsWith(route.pathPrefix)) {
        return originalPath;
    }
    const strippedPath = originalPath.slice(route.pathPrefix.length);
    return strippedPath || '/';
}

function getRouteByPrefix(pathPrefix) {
    return PROXY_ROUTES.find((route) => route.pathPrefix === pathPrefix);
}

function findMissingFields(source, requiredFields) {
    return requiredFields.filter((field) => {
        const value = source?.[field];
        return value === undefined || value === null || value === '';
    });
}

function respondWithContractError(res, request_id, statusCode, code, message, details = {}) {
    res.status(statusCode).json({
        ok: false,
        result: null,
        error: {
            code,
            message,
            details,
        },
        meta: {
            request_id,
            service: 'api-gateway',
        },
    });
}

async function probeHealth(url) {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
        return {
            ok: response.status === 200,
            status: response.status,
            url
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            url
        };
    }
}

// ==============================================================
// 1. HEALTH & READINESS ENDPOINTS
// ==============================================================

app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'api-gateway' });
});

// Returns PII + injection pattern metadata so clients (e.g. sidebar) can
// mirror the same rules for pre-flight client-side detection.
// No secrets — read-only rule metadata only.
app.get('/guardrail/patterns', (_req, res) => {
    res.json(getPatterns());
});

app.get('/readyz', async (_req, res) => {
    const checks = await Promise.all(
        ACTIVE_ROUTES.map(async (route) => {
            const result = await probeHealth(buildServiceUrl(route.target, route.healthPath));
            return { name: route.description, ...result };
        })
    );

    const dependencies = {};
    for (const check of checks) {
        dependencies[check.name] = { ok: check.ok, status: check.status, url: check.url };
        if (check.error) dependencies[check.name].error = check.error;
    }

    const ready = checks.every((check) => check.ok);

    res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'not_ready',
        service: 'api-gateway',
        dependencies
    });
});

// ==============================================================
// 1.5 GOOGLE SHEETS CONTRACT ADAPTERS
// ==============================================================

const aiContract = GATEWAY_CONTRACT.paths.sheetAi;
const aiRoute = getRouteByPrefix('/api/ai');

if (!aiRoute) {
    throw new Error('Missing /api/ai route definition in PROXY_ROUTES');
}

app.post(aiContract.publicPath, express.json({ limit: JSON_BODY_LIMIT }), guardrailMiddleware, async (req, res) => {
    const isContractEnvelope = Boolean(req.body?.meta && req.body?.payload);

    if (!isContractEnvelope) {
        const missingMetaFields = findMissingFields(req.body?.meta, aiContract.requiredMetaFields);
        const missingPayloadFields = findMissingFields(req.body?.payload, aiContract.requiredPayloadFields);
        return respondWithContractError(
            res,
            req.id,
            400,
            'BAD_REQUEST',
            'Request does not match the required Google Sheets gateway envelope.',
            {
                missing_meta_fields: missingMetaFields,
                missing_payload_fields: missingPayloadFields,
                schema: aiContract.requestSchema,
            },
        );
    }

    const missingMetaFields = findMissingFields(req.body.meta, aiContract.requiredMetaFields);
    const missingPayloadFields = findMissingFields(req.body.payload, aiContract.requiredPayloadFields);

    if (missingMetaFields.length > 0 || missingPayloadFields.length > 0) {
        return respondWithContractError(
            res,
            req.id,
            400,
            'BAD_REQUEST',
            'Request does not match the required Google Sheets gateway envelope.',
            {
                missing_meta_fields: missingMetaFields,
                missing_payload_fields: missingPayloadFields,
                schema: aiContract.requestSchema,
            },
        );
    }

    const upstreamUrl = buildServiceUrl(aiRoute.target, buildProxyPath(aiRoute, aiContract.publicPath));
    const upstreamPayload = {
        prompt: req.body.payload.prompt,
        context: req.body.payload.context ?? '',
        instruction: req.body.payload.instruction ?? '',
        user: req.body.meta.user_email,
    };

    const proxyStartTime = Date.now();
    if (req.guardrail?.redactions?.length > 0) {
        logger.warn(
            { request_id: req.id, redactions: req.guardrail.redactions },
            '[Guardrail] PII redacted from request before forwarding',
        );
    }

    logger.info(
        {
            request_id: req.id,
            method: req.method,
            path: req.originalUrl,
            upstreamUrl,
            contractVersion: GATEWAY_CONTRACT.info.version,
            requestMode: 'contract',
        },
        '[Contract] -> AI / LLM Service (Google Sheets envelope)',
    );

    let upstreamResponse;
    try {
        upstreamResponse = await fetch(upstreamUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-request-id': req.id,
            },
            body: JSON.stringify(upstreamPayload),
            signal: AbortSignal.timeout(AI_CONTRACT_TIMEOUT_MS),
        });
    } catch (error) {
        const isTimeout = error.name === 'TimeoutError' || error.name === 'AbortError';
        logger.error(
            { err: error, request_id: req.id, upstreamUrl, timeout: isTimeout },
            '[Contract] AI upstream request failed',
        );
        return respondWithContractError(
            res,
            req.id,
            isTimeout ? 504 : 502,
            isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_FAILURE',
            isTimeout ? 'AI service timed out.' : 'Unable to reach AI service.',
            { upstream_url: upstreamUrl, detail: error.message },
        );
    }

    const latencyMs = Date.now() - proxyStartTime;
    const responseText = await upstreamResponse.text();
    let upstreamJson;
    try {
        upstreamJson = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
        logger.error({ err: error, request_id: req.id, upstreamUrl, responseText }, '[Contract] AI upstream returned invalid JSON');
        return respondWithContractError(
            res,
            req.id,
            502,
            'UPSTREAM_INVALID_RESPONSE',
            'AI service returned a non-JSON response.',
            { upstream_url: upstreamUrl },
        );
    }

    if (!upstreamResponse.ok) {
        const errorKey = upstreamJson?.error_key ?? 'UPSTREAM_FAILURE';
        const guardrailReason = upstreamJson?.guardrail ?? null;
        logger.error(
            {
                request_id: req.id,
                upstreamUrl,
                statusCode: upstreamResponse.status,
                latencyMs,
                errorKey,
                guardrailReason,
                upstreamJson,
            },
            '[Contract] AI upstream returned an error response',
        );
        return respondWithContractError(
            res,
            req.id,
            upstreamResponse.status,
            errorKey,
            guardrailReason
                ? `AI guardrail blocked response: ${guardrailReason}`
                : upstreamJson?.error || 'AI service returned an error response.',
            { upstream_url: upstreamUrl, error_key: errorKey, guardrail: guardrailReason },
        );
    }

    logger.info(
        { request_id: req.id, statusCode: upstreamResponse.status, latencyMs },
        '[Contract] <- AI / LLM Service (Google Sheets envelope)',
    );

    // Crossing 4: scan LLM result before it reaches Google Sheets.
    // Any PII the model echoed back is redacted here — last line of defence.
    const resultText = upstreamJson.result ?? '';
    const { text: cleanResult, redactions: outboundRedactions } = scanText(resultText);
    if (outboundRedactions.length > 0) {
        logger.warn(
            { request_id: req.id, redactions: outboundRedactions },
            '[Guardrail] PII redacted from LLM response before returning to Sheets',
        );
        upstreamJson.result = cleanResult;
    }

    logger.info(
        {
            request_id: req.id,
            run_id: upstreamJson.meta?.run_id,
            modelInvoked: upstreamJson.meta?.model_invoked,
            latencyMs,
        },
        '[Trace] AI request completed',
    );

    res.json({
        ok: true,
        result: {
            text: upstreamJson.result,
        },
        error: null,
        meta: {
            request_id: req.id,
            idempotency_key: req.body.meta.idempotency_key,
            run_id: upstreamJson.meta?.run_id,
            run_at: req.body.meta.run_at,
            service: 'api-gateway',
            upstream_service: 'ai-service',
            latency_ms: latencyMs,
            model_invoked: upstreamJson.meta?.model_invoked,
        },
    });
});

// ==============================================================
// 2. CONTRACT-FIRST SWAGGER UI
// ==============================================================
if (0) {
    const CONTRACT_PATH = path.join(__dirname, '../../docs/03_Reference/Schemas/schema_version=2026-06-06/openapi3-ringisho-spec.json');
    if (fs.existsSync(CONTRACT_PATH)) {
        const openapiContract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf-8'));
        app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiContract));
    } else {
        logger.warn("⚠️ Swagger Contract JSON not found at path.");
    }
}

// ==============================================================
// 3. PROXY ROUTES (Registered from config/routes.mjs manifest)
//    MUST be mounted BEFORE express.json() — proxy streams the
//    raw body directly to the upstream without parsing it.
// ==============================================================

// --------------------------------------------------------------
// 3a. EGRESS PROXIES (Microservices -> external LLM providers)
//     Injects provider API keys; secrets stay in the gateway only.
// --------------------------------------------------------------
for (const provider of EGRESS_PROVIDERS) {
    // createEgressProxy may return a single handler or a [tokenMiddleware, proxy]
    // pair (Vertex); spread so Express registers each as its own layer.
    const handlers = [].concat(createEgressProxy(provider));
    app.use(provider.mountPrefix, ...handlers);
    logger.info(`📤 Registered egress: ${provider.mountPrefix} -> ${provider.name}`);
}

for (const route of ACTIVE_ROUTES) {
    const rewriteKey = `^${route.pathPrefix}`;

    app.use(route.pathPrefix, createProxyMiddleware({
        target: route.target,
        changeOrigin: true,
        // Abort the upstream connection if it stalls (prevents hung requests).
        proxyTimeout: UPSTREAM_TIMEOUT_MS,
        pathRewrite: route.stripPrefix ? { [rewriteKey]: '' } : undefined,

        // http-proxy-middleware v3 requires handlers under `on:` — the top-level
        // onProxyReq/onProxyRes/onError form is v2 and silently no-ops in v3.
        on: {
            // Forward X-Request-ID to upstream and log the start of the request
            proxyReq: (proxyReq, req) => {
                if (req.id) {
                    proxyReq.setHeader('X-Request-ID', req.id);
                }
                req._proxyStartTime = Date.now();
                logger.info({ request_id: req.id, method: req.method, path: req.originalUrl },
                    `[Proxy] -> ${route.description}`);
            },

            // Log upstream response latency
            proxyRes: (proxyRes, req) => {
                const latencyMs = Date.now() - (req._proxyStartTime || Date.now());
                logger.info({ request_id: req.id, statusCode: proxyRes.statusCode, latencyMs },
                    `[Proxy] <- ${route.description}`);
            },

            error: (err, req, res) => {
                const latencyMs = Date.now() - (req._proxyStartTime || Date.now());
                logger.error({ err, request_id: req.id, latencyMs },
                    `[Proxy] Error for ${route.pathPrefix}:`);
                if (!res.headersSent) {
                    res.status(502).json({
                        error: `Unable to reach ${route.description}.`,
                        detail: err.message,
                        request_id: req.id
                    });
                }
            },
        },
    }));

    logger.info(`📡 Registered proxy: ${route.pathPrefix} -> ${route.target} (${route.description})`);
}

app.use(express.json({ limit: JSON_BODY_LIMIT }));

// Top-level error handler — must be the LAST app.use() before listen
app.use(errorHandler);

// ==============================================================
// 4. STARTUP
// ==============================================================

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    logger.info(`🚦 API Gateway running on http://0.0.0.0:${PORT}`);
    logger.info(`👉 Swagger Docs: http://localhost:${PORT}/docs`);

    // Log a summary of all registered routes
    const routeSummary = ACTIVE_ROUTES.map(r => `${r.pathPrefix} -> ${r.target}`).join(' | ');
    logger.info(`🔄 Proxying: ${routeSummary}`);

    // ==============================================================
    // STARTUP HEALTH PROBES (driven from the same route manifest)
    // ==============================================================
    const checkServiceHealth = async (route, retries = 15, delay = 2000) => {
        const url = buildServiceUrl(route.target, route.healthPath);
        const result = await probeHealth(url);
        if (result.ok) {
            logger.info(`✅ ${route.description} ready at ${url}`);
            return;
        }

        if (retries > 0) {
            logger.warn(`⚠️ ${route.description} not ready yet at ${url}. Retrying in ${delay / 1000}s... (${retries} retries left)`);
            setTimeout(() => {
                checkServiceHealth(route, retries - 1, delay);
            }, delay);
            return;
        }

        logger.error(`❌ ${route.description} NOT ready at ${url}`);
    };

    for (const route of ACTIVE_ROUTES) {
        checkServiceHealth(route);
    }
});

// Fail loudly if the port is already taken, instead of half-starting and
// letting a stale process keep serving (the silent port-squat failure mode).
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        logger.error(`❌ Port ${PORT} is already in use — is another gateway running? Exiting.`);
    } else {
        logger.error({ err }, '❌ HTTP server error — exiting.');
    }
    process.exit(1);
});

// Graceful shutdown: Cloud Run (and Docker) send SIGTERM before killing the
// container. Stop accepting new connections and let in-flight requests drain.
let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`🛑 ${signal} received — draining connections and shutting down.`);
    server.close((err) => {
        if (err) {
            logger.error({ err }, 'Error during shutdown');
            process.exit(1);
        }
        logger.info('✅ Clean shutdown complete.');
        process.exit(0);
    });
    // Safety net: force-exit if draining stalls past the grace window.
    setTimeout(() => {
        logger.error('⏱️ Shutdown timed out — forcing exit.');
        process.exit(1);
    }, Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
