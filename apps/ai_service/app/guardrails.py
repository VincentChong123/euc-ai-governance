"""Output quality checks for ai_service.

PII enforcement is centralized at the API gateway (all four data crossings).
This module only handles output quality signals that the gateway cannot assess
without understanding the model's intent: refusal detection and length cap.
"""
import re
import logging
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

_SPEC_PATH = Path(__file__).resolve().parents[3] / "specs" / "guardrail.yaml"


def _load() -> dict:
    with _SPEC_PATH.open(encoding="utf-8") as f:
        return yaml.safe_load(f).get("output_checks", {})


_SPEC = _load()

_REFUSAL_RES: list[re.Pattern] = [
    re.compile(p, re.IGNORECASE) for p in _SPEC.get("refusal_patterns", [])
]
_MAX_CHARS: int = _SPEC.get("max_output_chars", 10_000)


def check_output(text: str) -> str | None:
    """Check output quality before returning to the gateway.

    Does NOT scan for PII — that is handled by the gateway on the return path
    (crossing 4: ai_service → gateway → Sheets).

    Args:
        text: The raw text returned by the LLM agent.

    Returns:
        ``None`` if the output passes all checks.
        A non-empty string describing the failure reason if a check fires
        (caller should return ``__ERROR_UPSTREAM_FAILURE__``).
    """
    if len(text) > _MAX_CHARS:
        logger.warning("Output guardrail: result exceeds max_output_chars (%d > %d)", len(text), _MAX_CHARS)
        return f"output_too_long:{len(text)}"

    for pattern in _REFUSAL_RES:
        m = pattern.search(text)
        if m:
            logger.warning(
                "Output guardrail: refusal pattern matched — pattern='%s' matched='%s'",
                pattern.pattern, m.group(0),
            )
            return f"refusal_detected:{m.group(0)}"

    return None
