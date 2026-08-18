/**
 * GCP OAuth access-token provider for the Vertex AI egress route.
 *
 * On Cloud Run the container's service account can mint tokens from the
 * metadata server with NO stored secret and NO dependency — this is the
 * compliant path. Tokens are short-lived (~1h), so we cache and refresh with a
 * safety margin.
 *
 * Off Cloud Run (local dev) the metadata server is unreachable; this returns
 * null and the Vertex route stays effectively disabled. Dev uses groq/openrouter.
 */
import { logger } from '../../utils/logger.mjs';

const METADATA_TOKEN_URL =
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

// Refresh this many ms before actual expiry to avoid edge-of-expiry 401s.
const EXPIRY_MARGIN_MS = 60_000;

let cached = { token: null, expiresAt: 0 };

/**
 * @returns {Promise<string|null>} a valid access token, or null if unavailable.
 */
export async function getGcpAccessToken() {
    const now = Date.now();
    if (cached.token && now < cached.expiresAt - EXPIRY_MARGIN_MS) {
        return cached.token;
    }

    try {
        const res = await fetch(METADATA_TOKEN_URL, {
            headers: { 'Metadata-Flavor': 'Google' },
            signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) {
            logger.warn({ status: res.status }, '[Egress] Vertex token: metadata server returned non-200');
            return null;
        }
        const body = await res.json(); // { access_token, expires_in, token_type }
        cached = {
            token: body.access_token,
            expiresAt: now + body.expires_in * 1000,
        };
        return cached.token;
    } catch (err) {
        logger.warn({ err: err.message }, '[Egress] Vertex token: unavailable (not on Cloud Run?)');
        return null;
    }
}
