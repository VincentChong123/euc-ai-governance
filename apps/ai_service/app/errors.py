"""Shared error registry — single source of truth for ai_service.

Mirror of docs/03_Reference/error_code_spec.md (and api_gateway/config/errorCodes.mjs).
Source code MUST reference an ErrorKey (not a bare HTTP number); `status_for()`
resolves the number.

Directionality:
    error_key -> http_status   deterministic (status_for)
    http_status -> error_key   one-to-many  (keys_for_status) — the precise key
                               travels in the response body.

When editing, update docs/03_Reference/error_code_spec.md and errorCodes.mjs identically.
"""
from dataclasses import dataclass
from enum import Enum


@dataclass(frozen=True)
class _ErrorMeta:
    status: int
    retryable: bool
    description: str


class ErrorKey(str, Enum):
    """Canonical error keys. Value is the `__ERROR_*__` sentinel string."""

    # -- Client errors (4xx) --
    BAD_REQUEST = "__ERROR_BAD_REQUEST__"
    UNAUTHENTICATED = "__ERROR_UNAUTHENTICATED__"
    FORBIDDEN = "__ERROR_FORBIDDEN__"
    NOT_FOUND = "__ERROR_NOT_FOUND__"
    PAYLOAD_TOO_LARGE = "__ERROR_PAYLOAD_TOO_LARGE__"
    VALIDATION = "__ERROR_VALIDATION__"
    RATE_LIMIT = "__ERROR_RATE_LIMIT__"

    # -- MFA / step-up (second factor; see docs/01_Architecture/specs/totp_mfa_spec.md) --
    OTP_REQUIRED = "__ERROR_OTP_REQUIRED__"
    OTP_INVALID = "__ERROR_OTP_INVALID__"
    OTP_EXPIRED = "__ERROR_OTP_EXPIRED__"
    OTP_NOT_ENROLLED = "__ERROR_OTP_NOT_ENROLLED__"

    # -- Server / gateway errors (5xx) --
    INTERNAL = "__ERROR_INTERNAL__"
    NOT_IMPLEMENTED = "__ERROR_NOT_IMPLEMENTED__"
    UPSTREAM_FAILURE = "__ERROR_UPSTREAM_FAILURE__"
    UPSTREAM_INVALID_RESPONSE = "__ERROR_UPSTREAM_INVALID_RESPONSE__"
    AUTH_UNAVAILABLE = "__ERROR_AUTH_UNAVAILABLE__"
    SERVICE_UNAVAILABLE = "__ERROR_SERVICE_UNAVAILABLE__"
    UPSTREAM_TIMEOUT = "__ERROR_UPSTREAM_TIMEOUT__"


ERROR_REGISTRY: dict[ErrorKey, _ErrorMeta] = {
    ErrorKey.BAD_REQUEST: _ErrorMeta(400, False, "Malformed request or envelope mismatch"),
    ErrorKey.UNAUTHENTICATED: _ErrorMeta(401, False, "Missing or invalid credentials"),
    ErrorKey.FORBIDDEN: _ErrorMeta(403, False, "Authenticated but not permitted"),
    ErrorKey.NOT_FOUND: _ErrorMeta(404, False, "Route or resource does not exist"),
    ErrorKey.PAYLOAD_TOO_LARGE: _ErrorMeta(413, False, "Body exceeds the configured size limit"),
    ErrorKey.VALIDATION: _ErrorMeta(422, False, "Well-formed but semantically invalid"),
    ErrorKey.RATE_LIMIT: _ErrorMeta(429, True, "Too many requests"),
    ErrorKey.OTP_REQUIRED: _ErrorMeta(401, False, "Sensitive action needs a second factor; none supplied"),
    ErrorKey.OTP_INVALID: _ErrorMeta(401, False, "Submitted TOTP code is wrong"),
    ErrorKey.OTP_EXPIRED: _ErrorMeta(401, False, "TOTP code outside the accepted time window"),
    ErrorKey.OTP_NOT_ENROLLED: _ErrorMeta(403, False, "User has no confirmed TOTP secret"),
    ErrorKey.INTERNAL: _ErrorMeta(500, False, "Unhandled gateway error"),
    ErrorKey.NOT_IMPLEMENTED: _ErrorMeta(501, False, "Endpoint not implemented"),
    ErrorKey.UPSTREAM_FAILURE: _ErrorMeta(502, True, "Upstream unreachable or returned an error"),
    ErrorKey.UPSTREAM_INVALID_RESPONSE: _ErrorMeta(502, False, "Upstream returned non-JSON / unparseable body"),
    ErrorKey.AUTH_UNAVAILABLE: _ErrorMeta(502, True, "Could not mint an upstream credential"),
    ErrorKey.SERVICE_UNAVAILABLE: _ErrorMeta(503, True, "Not ready / a dependency is down"),
    ErrorKey.UPSTREAM_TIMEOUT: _ErrorMeta(504, True, "Upstream did not respond within the timeout"),
}


def status_for(error_key: ErrorKey) -> int:
    """error_key -> http_status."""
    return ERROR_REGISTRY[error_key].status


def is_retryable(error_key: ErrorKey) -> bool:
    """error_key -> retryable flag."""
    return ERROR_REGISTRY[error_key].retryable


def keys_for_status(http_status: int) -> list[ErrorKey]:
    """http_status -> [error_key, …] (one-to-many; disambiguate via body)."""
    return [k for k, v in ERROR_REGISTRY.items() if v.status == http_status]
