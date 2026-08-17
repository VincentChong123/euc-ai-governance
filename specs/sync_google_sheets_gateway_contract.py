#!/usr/bin/env python3
"""Generate lightweight build-time artifacts from the Google Sheets gateway OpenAPI contract."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import yaml


ROOT_DIR = Path(__file__).resolve().parent.parent
SOURCE_PATH = ROOT_DIR / "specs" / "google-sheets-api-gateway-contract.yaml"
GATEWAY_TARGET_PATH = ROOT_DIR / "apps" / "api_gateway" / "generated" / "google-sheets-api-gateway-contract.json"
CONFIG_JS_PATH = ROOT_DIR / "apps" / "google-sheets-ui" / "Config.js"
GENERATED_CONFIG_BLOCK_PATTERN = re.compile(
    r"(?P<indent>\s*)// BEGIN GENERATED CONTRACT VALUES\n.*?\n(?P=indent)// END GENERATED CONTRACT VALUES",
    re.DOTALL,
)


def ref_name(ref: str) -> str:
    return ref.rsplit("/", 1)[-1]


def load_spec() -> dict:
    return yaml.safe_load(SOURCE_PATH.read_text(encoding="utf-8"))


def repo_default_branch() -> str:
    result = subprocess.run(
        ["git", "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
        cwd=ROOT_DIR,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip().rsplit("/", 1)[-1]


def repo_http_origin() -> str:
    result = subprocess.run(
        ["git", "config", "--get", "remote.origin.url"],
        cwd=ROOT_DIR,
        check=True,
        capture_output=True,
        text=True,
    )
    origin = result.stdout.strip()
    if origin.startswith("git@github.com:"):
        owner_repo = origin.removeprefix("git@github.com:").removesuffix(".git")
        return f"https://github.com/{owner_repo}"
    return origin.removesuffix(".git")


def source_urls() -> tuple[str, str]:
    origin = repo_http_origin().rstrip("/")
    branch = repo_default_branch()
    source_path = SOURCE_PATH.relative_to(ROOT_DIR).as_posix()
    raw_url = origin.replace("https://github.com/", "https://raw.githubusercontent.com/")
    return source_path, f"{raw_url}/{branch}/{source_path}"


def build_contract_artifact(spec: dict) -> dict:
    schemas = spec["components"]["schemas"]

    sheet_ai_schema_name = ref_name(
        spec["paths"]["/api/ai/v1/sheet-chat"]["post"]["requestBody"]["content"]["application/json"]["schema"]["$ref"]
    )
    workflow_schema_name = ref_name(
        spec["paths"]["/api/workflow/approve"]["post"]["requestBody"]["content"]["application/json"]["schema"]["$ref"]
    )

    artifact = {
        "info": {
            "title": spec["info"]["title"],
            "version": str(spec["info"]["version"]),
        },
        "headers": {
            "requestId": spec["components"]["parameters"]["XRequestIdHeader"]["name"],
            "traceParent": spec["components"]["parameters"]["TraceParentHeader"]["name"],
            "traceState": spec["components"]["parameters"]["TraceStateHeader"]["name"],
        },
        "paths": {
            "sheetAi": {
                "publicPath": "/api/ai/v1/sheet-chat",
                "requestSchema": sheet_ai_schema_name,
                "requiredMetaFields": schemas["RequestMeta"]["required"],
                "requiredPayloadFields": schemas["SheetAiPayload"]["required"],
            },
            "workflowApproval": {
                "publicPath": "/api/workflow/approve",
                "requestSchema": workflow_schema_name,
                "requiredMetaFields": schemas["RequestMeta"]["required"],
                "requiredPayloadFields": schemas["WorkflowApprovalPayload"]["required"],
            },
        },
    }
    return artifact


def build_generated_config_block(spec: dict) -> str:
    source_path, source_url = source_urls()
    client_name = schemas_client_const(spec)
    ai_path = path_public_path(spec, "/api/ai/v1/sheet-chat")
    workflow_path = path_public_path(spec, "/api/workflow/approve")
    request_headers = spec["components"]["parameters"]

    return "\n".join(
        [
            "      // BEGIN GENERATED CONTRACT VALUES",
            f'      CONTRACT_VERSION: "{spec["info"]["version"]}",',
            f'      CONTRACT_CLIENT: "{client_name}",',
            f'      CONTRACT_SOURCE_PATH: "{source_path}",',
            f'      CONTRACT_SOURCE_URL: "{source_url}",',
            f'      REQUEST_ID_HEADER: "{request_headers["XRequestIdHeader"]["name"]}",',
            f'      TRACEPARENT_HEADER: "{request_headers["TraceParentHeader"]["name"]}",',
            f'      TRACESTATE_HEADER: "{request_headers["TraceStateHeader"]["name"]}",',
            f'      AI_ENDPOINT: "{ai_path}",',
            f'      WORKFLOW_ENDPOINT: "{workflow_path}",',
            "      // END GENERATED CONTRACT VALUES",
        ]
    )


def schemas_client_const(spec: dict) -> str:
    return spec["components"]["schemas"]["RequestMeta"]["properties"]["client"]["const"]


def path_public_path(spec: dict, path_key: str) -> str:
    return next(iter({path_key: spec["paths"][path_key]}.keys()))


def sync_google_sheets_config(spec: dict) -> bool:
    """Rewrite the generated block in Config.js. Returns False if Config.js is
    absent (e.g. in the curated portfolio repo, where the Sheets-UI config is not
    published); the gateway JSON artifact is generated regardless of this."""
    if not CONFIG_JS_PATH.exists():
        return False
    config_js = CONFIG_JS_PATH.read_text(encoding="utf-8")
    updated_config_js, replacements = GENERATED_CONFIG_BLOCK_PATTERN.subn(
        build_generated_config_block(spec),
        config_js,
        count=1,
    )
    if replacements != 1:
        raise RuntimeError(
            f"Could not find generated contract block markers in {CONFIG_JS_PATH.relative_to(ROOT_DIR)}"
        )
    CONFIG_JS_PATH.write_text(updated_config_js + ("\n" if not updated_config_js.endswith("\n") else ""), encoding="utf-8")
    return True


def main() -> None:
    spec = load_spec()
    artifact = build_contract_artifact(spec)
    GATEWAY_TARGET_PATH.parent.mkdir(parents=True, exist_ok=True)
    GATEWAY_TARGET_PATH.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {GATEWAY_TARGET_PATH.relative_to(ROOT_DIR)}")
    if sync_google_sheets_config(spec):
        print(f"Updated {CONFIG_JS_PATH.relative_to(ROOT_DIR)}")
    else:
        print(f"Skipped {CONFIG_JS_PATH.relative_to(ROOT_DIR)} (not present in this repo)")


if __name__ == "__main__":
    main()
