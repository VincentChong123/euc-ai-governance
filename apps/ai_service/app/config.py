import logging
from pathlib import Path

logger = logging.getLogger(__name__)

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve the repo-root .env regardless of working directory
_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables or `.env`.

    Attributes:
        is_dev: True in local/dev environments; gates dev-only behaviour.
        llm_provider: Active LLM provider key. Selects egress route, default
            model, and the ``model_invoked`` label. Valid values: ``openrouter``,
            ``groq``, ``vertex``.
        llm_gateway_url: Base URL of the api_gateway (scheme + host + port).
            Docker Compose overrides this to ``http://api-gateway:3000``; the
            egress path segment is derived from ``llm_provider``.
        llm_base_url: Optional explicit egress base URL. Overrides the
            provider-derived default when set.
        llm_model: Optional explicit model ID. Overrides the provider-derived
            default when set.
    """

    is_dev: bool = True
    llm_provider: str = "openrouter"
    llm_gateway_url: str = "http://localhost:3000"
    llm_base_url: str = ""
    llm_model: str = ""
    mas_forex_eod_api_key: str = ""
    # Default IANA timezone for the current_datetime tool when the user's prompt
    # names no location. "Local" for this deployment = Singapore.
    default_timezone: str = "Asia/Singapore"
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")


settings = Settings()

# NOTE: ai_service holds no LLM provider key. It talks OpenAI-format to the
# api_gateway egress route; the gateway injects the real provider key (from
# docker env_file in dev, Cloud Run secret->env in prod). Secrets are
# encapsulated in the gateway only.

# provider -> gateway egress mount segment + default OpenAI-compatible model id.
_PROVIDER_DEFAULTS = {
    "openrouter": {"mount": "openrouter", "model": "google/gemma-4-31b-it:free"},
    "groq": {"mount": "groq", "model": "llama3-groq-70b-8192-tool-use-preview"},
    # Enterprise/compliance path — Google Vertex AI (native to Cloud Run).
    # Data stays in your GCP project/region; auth via the Cloud Run service
    # account (no stored key). Override the model via LLM_MODEL as needed.
    "vertex": {"mount": "vertex", "model": "google/gemini-2.0-flash-001"},
}

# Fallback chain for openrouter — tried in order on model failure.
# Only active when LLM_PROVIDER=openrouter and LLM_MODEL is not explicitly set.
OPENROUTER_FALLBACK_MODELS: list[str] = [
    "google/gemma-4-31b-it:free",
    "qwen/qwen3-coder-480b-a35b:free",
    "openai/gpt-oss-20b:free",
]


def resolve_llm() -> tuple[str, str, str]:
    """Resolve the active provider, model ID, and egress base URL.

    Reads ``Settings.llm_provider`` and applies ``_PROVIDER_DEFAULTS``, then
    applies any explicit ``llm_model`` / ``llm_base_url`` overrides.

    Returns:
        Tuple of ``(provider, model, base_url)`` — all non-empty strings.

    Raises:
        ValueError: If ``llm_provider`` is not in ``_PROVIDER_DEFAULTS``.
    """
    provider = settings.llm_provider
    if provider not in _PROVIDER_DEFAULTS:
        raise ValueError(
            f"Unknown LLM_PROVIDER '{provider}'. Valid: {list(_PROVIDER_DEFAULTS)}"
        )
    defaults = _PROVIDER_DEFAULTS[provider]
    model = settings.llm_model or defaults["model"]
    base_url = (
        settings.llm_base_url
        or f"{settings.llm_gateway_url.rstrip('/')}/egress/{defaults['mount']}/v1"
    )
    return provider, model, base_url


LLM_PROVIDER, LLM_MODEL, LLM_BASE_URL = resolve_llm()


def test_config():
    """Assert that all resolved configuration values are non-empty.

    Runs automatically on import so misconfiguration fails loudly at startup
    rather than at the first request. Optional raw fields (``llm_base_url``,
    ``llm_model``) are skipped — the resolved ``LLM_*`` constants are
    validated instead.

    Raises:
        ValueError: If any required setting or resolved constant is empty.
    """
    # llm_base_url / llm_model are optional (derived from provider); the resolved
    # LLM_* values below are what actually get used, so validate those instead.
    optional = {"llm_base_url", "llm_model", "mas_forex_eod_api_key"}
    for key, value in settings.model_dump().items():
        if key in optional:
            continue
        if value is None or value == "":
            raise ValueError(f"Configuration error: settings.{key} is null or empty!")
    for name, value in (("LLM_PROVIDER", LLM_PROVIDER), ("LLM_MODEL", LLM_MODEL), ("LLM_BASE_URL", LLM_BASE_URL)):
        if not value:
            raise ValueError(f"Configuration error: resolved {name} is empty!")
    logger.info(f"✅ All settings validated successfully. (provider={LLM_PROVIDER}, model={LLM_MODEL})")


# Run the test immediately upon importing the config
test_config()


if __name__ == "__main__":

    # Run the test immediately upon importing the config
    test_config()
