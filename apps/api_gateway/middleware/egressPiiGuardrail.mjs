/**
 * egressPiiGuardrail.mjs — PII scan/redact middleware for LLM egress
 *
 * Sits BEFORE the egress proxy in the chain. Parses the OpenAI-format request
 * body sent by ai_service, scans all `messages[].content` fields for PII, and
 * redacts in-place before the proxy forwards to the LLM provider.
 *
 * Because express.json() normally runs after proxy routes, this middleware reads
 * the raw body itself and writes the (possibly modified) JSON back onto req so
 * the proxy's proxyReq handler can re-send it.
 *
 * Attach req._egressPii = { redactions } so the proxyReq logger can record what
 * was redacted without logging the original values.
 */

import { getPatterns } from './guardrails.mjs';
import { logger } from '../utils/logger.mjs';

// Compile PII patterns once at startup — same YAML source as inbound guardrails.
const PII_RULES = getPatterns().pii.map((r) => ({
    name: r.name,
    re: new RegExp(r.pattern, 'g'),
}));

/**
 * Redacts PII from a string. Returns { text, log } where log is empty if nothing was found.
 */
function redact(text) {
    if (typeof text !== 'string') return { text, log: [] };
    const log = [];
    for (const rule of PII_RULES) {
        rule.re.lastIndex = 0;
        const matches = text.match(rule.re);
        if (matches) {
            text = text.replace(rule.re, `[REDACTED:${rule.name}]`);
            log.push({ rule: rule.name, count: matches.length });
        }
    }
    return { text, log };
}

/**
 * Collects the raw request body as a Buffer.
 */
function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

/**
 * Express middleware — parse, scan, redact, re-attach body so the proxy can
 * forward the clean version to the LLM provider.
 *
 * Sets req._egressPii = { redactions: [...] } for downstream logging.
 * Sets req._rawBody  = Buffer  for the factory's proxyReq to write.
 */
export async function egressPiiGuardrail(req, res, next) {
    // Only scan POST/PUT with a JSON content type (chat completion requests)
    const ct = req.headers['content-type'] || '';
    if (req.method === 'GET' || !ct.includes('application/json')) {
        return next();
    }

    let rawBody;
    try {
        rawBody = await readRawBody(req);
    } catch (err) {
        logger.error({ err, request_id: req.id }, '[EgressPII] Failed to read request body');
        return next(); // fail open — let the proxy handle it
    }

    let parsed;
    try {
        parsed = JSON.parse(rawBody.toString('utf-8'));
    } catch {
        // Not JSON — pass through unchanged
        req._rawBody = rawBody;
        return next();
    }

    // Scan all message content fields (OpenAI chat completion format)
    const allRedactions = [];
    if (Array.isArray(parsed.messages)) {
        for (const msg of parsed.messages) {
            if (typeof msg.content === 'string') {
                const { text, log } = redact(msg.content);
                msg.content = text;
                allRedactions.push(...log);
            } else if (Array.isArray(msg.content)) {
                // Multi-part content (vision / tool use)
                for (const part of msg.content) {
                    if (part.type === 'text' && typeof part.text === 'string') {
                        const { text, log } = redact(part.text);
                        part.text = text;
                        allRedactions.push(...log);
                    }
                }
            }
        }
    }

    if (allRedactions.length > 0) {
        req._egressPii = { redactions: allRedactions };
        logger.warn(
            { request_id: req.id, redactions: allRedactions },
            '[EgressPII] PII redacted from LLM-bound request',
        );
    }

    // Re-serialize so the proxy forwards the clean body
    const cleanBody = Buffer.from(JSON.stringify(parsed), 'utf-8');
    req._rawBody = cleanBody;
    req.headers['content-length'] = String(cleanBody.byteLength);
    next();
}
