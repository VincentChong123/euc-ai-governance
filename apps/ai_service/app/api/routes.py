import uuid
import time
import logfire
import logging

logger = logging.getLogger(__name__)
from fastapi import APIRouter
from fastapi import Request
from fastapi.responses import JSONResponse
from app.models.schemas import SheetPromptRequest
from app.agents.simple_agent import generate_summary
from app.config import LLM_PROVIDER, LLM_MODEL
from app.request_context import bind_request
from app.errors import ErrorKey, status_for
from app.guardrails import check_output
from utils.route_loader import get_ai_service_route

PREFIX, ENDPOINT = get_ai_service_route()

router = APIRouter()


@router.post(ENDPOINT)
async def post_sheet_chat(request: SheetPromptRequest, http_request: Request) -> JSONResponse:
    """Handle a summarisation request from the Google Sheets sidebar.

    Validates the request body via ``SheetPromptRequest``, calls the pydantic-ai
    agent, and returns a JSON envelope with the result and LLMOps metadata.
    A Logfire span wraps the agent call for end-to-end traceability.

    Args:
        request: Validated request body containing ``prompt``, ``context``,
            and ``user``.
        http_request: Raw FastAPI request; used to extract the
            ``x-request-id`` header forwarded by the API gateway.

    Returns:
        ``JSONResponse`` with shape::

            {
                "result": "<plain-text summary>",
                "meta": {
                    "request_id": str,
                    "run_id": str,
                    "latency_ms": int,
                    "model_invoked": "<provider>:<model>",
                    "agent_name": "summary_agent",
                    "timestamp": float
                }
            }

    Raises:
        JSONResponse (502): If the agent raises any exception, returns
            ``{"error_key": "__ERROR_UPSTREAM_FAILURE__", ...}``.
    """
    start_time = time.time()
    request_id = http_request.headers.get("x-request-id", "")
    # Bind the id to this async context so outbound LLM egress calls (retries +
    # fallbacks) carry the SAME request_id back through the gateway egress route.
    bind_request(request_id)
    run_id = str(uuid.uuid4())
    prompt_id = str(uuid.uuid4())

    # One span per lifecycle state, nested under AI_Generation_Run. The `_tags`
    # mark the state (visible as span attributes in Jaeger / Logfire). Cross-service
    # edges use a directional `from-<src>-to-<dst>` convention so each hop is
    # self-describing when more Python services talk to the gateway.
    try:
        with logfire.span(
            "AI_Generation_Run",
            _tags=["ai-service", "edge:from-api-gateway-to-ai-srv"],
            session_id=request.user,
            request_id=request_id,
            run_id=run_id,
            prompt_id=prompt_id,
            timestamp=start_time,
        ):
            logger.info(f"User {request.user} requested AI generation. request_id={request_id} run_id={run_id}")

            with logfire.span("agent_run", _tags=["state:call-tools", "state:call-llm"]):
                final_text = await generate_summary(request.prompt, request.context)

            with logfire.span("output_guardrail", _tags=["state:guardrail"]) as guard_span:
                guard_failure = check_output(final_text)
                guard_span.set_attribute("passed", not guard_failure)
    except Exception as exc:
        logger.exception(f"Agent failure request_id={request_id} run_id={run_id}: {exc}")
        key = ErrorKey.UPSTREAM_FAILURE
        return JSONResponse(
            status_code=status_for(key),
            content={"error_key": key.value, "request_id": request_id, "run_id": run_id},
        )

    if guard_failure:
        key = ErrorKey.UPSTREAM_FAILURE
        logger.warning(f"Output guardrail blocked result request_id={request_id} run_id={run_id} reason={guard_failure}")
        return JSONResponse(
            status_code=status_for(key),
            content={"error_key": key.value, "request_id": request_id, "run_id": run_id, "guardrail": guard_failure},
        )

    latency_ms = int((time.time() - start_time) * 1000)
    logfire.info(
        "Returning result to API gateway",
        _tags=["edge:from-ai-srv-to-api-gateway"],
        request_id=request_id,
        run_id=run_id,
        latency_ms=latency_ms,
    )

    return JSONResponse(
        content={
            "result": final_text,
            "meta": {
                "request_id": request_id,
                "run_id": run_id,
                "latency_ms": latency_ms,
                "model_invoked": f"{LLM_PROVIDER}:{LLM_MODEL}",
                "agent_name": "summary_agent",
                "timestamp": time.time(),
            },
        }
    )
