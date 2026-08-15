/**
 * guardrails.mjs — parameterized input guardrail middleware
 *
 * Loaded once at startup from specs/guardrail.yaml (repo root).
 * Two rule types:
 *   reject  — return __ERROR_VALIDATION__ (422) immediately; request never reaches ai_service
 *   redact  — replace PII match with [REDACTED:<name>] and continue; logs to audit trail
 *
 * Wire in server.mjs BEFORE the contract adapter:
 *   import { guardrailMiddleware } from './middleware/guardrails.mjs';
 *   app.post(aiContract.publicPath, express.json(...), guardrailMiddleware, async (req, res) => { ... });
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { load as yamlLoad } from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUARDRAIL_PATH = path.resolve(__dirname, '../../../specs/guardrail.yaml');

// ---------------------------------------------------------------------------
// Load and compile rules at module load time (startup cost, not per-request)
// ---------------------------------------------------------------------------

function loadRules() {
    const raw = yamlLoad(readFileSync(GUARDRAIL_PATH, 'utf-8'));

    const injection = (raw.injection_patterns ?? []).map((r) => ({
        ...r,
        _re: new RegExp(r.pattern, 'gi'),
    }));

    const pii = (raw.pii_patterns ?? []).map((r) => ({
        ...r,
        // output: whether this rule also runs on the LLM→Sheets return path.
        // Defaults to true (defense-in-depth). Set output:false in guardrail.yaml
        // for ambiguous numeric/date patterns that false-positive on financial
        // answers (rates, dates) — inbound scanning already keeps that PII from
        // ever reaching the model.
        output: r.output !== false,
        _re: new RegExp(r.pattern, 'g'),
    }));

    return { injection, pii };
}

const RULES = loadRules();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely resolve a dot-path like "payload.prompt" from an object. */
function getField(obj, dotPath) {
    return dotPath.split('.').reduce((cur, key) => cur?.[key], obj);
}

function setField(obj, dotPath, value) {
    const keys = dotPath.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (cur[keys[i]] == null) return;
        cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware — call after express.json() so req.body is populated.
 * Mutates req.body in-place for redact rules.
 * Attaches req.guardrail = { redactions: [...] } for downstream logging.
 */
/**
 * Scans a plain text string for PII and redacts all matches.
 * Returns { text, redactions } — redactions is empty if nothing was found.
 * Used by the contract adapter to scan LLM responses before they reach Sheets.
 *
 * @param {string} text
 * @returns {{ text: string, redactions: Array<{rule: string, count: number}> }}
 */
export function scanText(text) {
    if (typeof text !== 'string') return { text, redactions: [] };
    const redactions = [];
    for (const rule of RULES.pii) {
        if (!rule.output) continue;   // rule scoped to inbound crossings only
        rule._re.lastIndex = 0;
        const matches = text.match(rule._re);
        if (matches) {
            text = text.replace(rule._re, `[REDACTED:${rule.name}]`);
            redactions.push({ rule: rule.name, count: matches.length });
        }
    }
    return { text, redactions };
}

/**
 * Returns the loaded pattern metadata (without compiled RegExp objects).
 * Used by the GET /guardrail/patterns route so clients can mirror the rules.
 */
export function getPatterns() {
    return {
        injection: RULES.injection.map(({ name, pattern, fields }) => ({ name, pattern, fields })),
        pii:       RULES.pii.map(({ name, pattern, fields, note }) => ({ name, pattern, fields, note })),
    };
}

export function guardrailMiddleware(req, res, next) {
    const body = req.body;
    const redactions = [];

    // 1. Injection check (reject on first match)
    for (const rule of RULES.injection) {
        for (const field of rule.fields) {
            const value = getField(body, field);
            if (typeof value !== 'string') continue;
            if (rule._re.test(value)) {
                req.log?.warn?.({ request_id: req.id, rule: rule.name, field }, '[Guardrail] Injection pattern detected — rejecting');
                return res.status(422).json({
                    ok: false,
                    result: null,
                    error: {
                        error_key: '__ERROR_VALIDATION__',
                        message: 'Request contains disallowed content.',
                        details: {},
                    },
                    meta: { request_id: req.id, service: 'api-gateway' },
                });
            }
        }
    }

    // 2. PII redaction (mutate body, collect audit trail)
    for (const rule of RULES.pii) {
        for (const field of rule.fields) {
            const value = getField(body, field);
            if (typeof value !== 'string') continue;

            rule._re.lastIndex = 0;
            const matches = [...value.matchAll(rule._re)];
            if (matches.length === 0) continue;

            const redacted = value.replace(rule._re, `[REDACTED:${rule.name}]`);
            setField(body, field, redacted);
            redactions.push({ rule: rule.name, field, count: matches.length });
        }
    }

    if (redactions.length > 0) {
        // Attach for the contract adapter to include in its audit log entry.
        // Do NOT log the original matched values here — log the rule name only.
        req.guardrail = { redactions };
    }

    next();
}
