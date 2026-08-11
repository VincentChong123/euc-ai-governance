"""Async-task-local carriers for the traceability thread.

Threads the originating Google-Sheets ``request_id`` (and a per-attempt counter)
from the API layer down to the outbound LLM egress calls **without** changing any
intermediate function signatures. A ``ContextVar`` is task-local, so concurrent
Sheet submits each see their own value even though the pydantic-ai agent, provider
and httpx client are module-level singletons.

See docs/01_Architecture/09-end-to-end-sequence.md ("Traceability thread").
"""
import itertools
from contextvars import ContextVar

# The inbound x-request-id, unchanged end-to-end (single source of truth).
_REQUEST_ID: ContextVar[str] = ContextVar("request_id", default="")
# Monotonic per-request counter over physical LLM egress attempts (retries +
# FallbackModel swaps). Kept SEPARATE from request_id so the id stays a stable
# exact-match correlation key; attempt only disambiguates the sub-calls.
_ATTEMPT: ContextVar[itertools.count] = ContextVar("attempt_counter")


def bind_request(request_id: str) -> None:
    """Bind the inbound request_id and a fresh attempt counter to THIS context.

    Call once at the start of each request handler, after reading the
    ``x-request-id`` header.
    """
    _REQUEST_ID.set(request_id)
    _ATTEMPT.set(itertools.count(1))


def current_request_id() -> str:
    """The request_id bound to the current context (``""`` if unbound)."""
    return _REQUEST_ID.get()


def next_attempt() -> int:
    """Next 1-based attempt number for the current request (``0`` if unbound)."""
    counter = _ATTEMPT.get(None)
    return next(counter) if counter is not None else 0
