"""Validate that errorCodes.mjs and errors.py match specs/error_codes.yaml.

Run from the repo root:
    python specs/validate_error_codes.py

Exits 0 if all three are in sync; exits 1 and prints diffs if not.
"""
import re
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
SPEC = REPO / "specs" / "error_codes.yaml"
MJS  = REPO / "apps/api_gateway/config/errorCodes.mjs"
PY   = REPO / "apps/ai_service/app/errors.py"


def load_spec() -> dict:
    return yaml.safe_load(SPEC.read_text())["errors"]


def load_mjs_keys(text: str) -> set[str]:
    """Extract __ERROR_*__ keys from errorCodes.mjs."""
    return set(re.findall(r"(__ERROR_[A-Z_]+__)\s*:", text))


def load_py_keys(text: str) -> set[str]:
    """Extract __ERROR_*__ values from errors.py enum."""
    return set(re.findall(r'"(__ERROR_[A-Z_]+__)"', text))


def load_mjs_entries(text: str) -> dict:
    """Extract {key: {status, retryable}} from errorCodes.mjs."""
    entries = {}
    pattern = re.compile(
        r'(__ERROR_[A-Z_]+__)\s*:\s*\{[^}]*status:\s*(\d+)[^}]*retryable:\s*(true|false)', re.DOTALL
    )
    for m in pattern.finditer(text):
        entries[m.group(1)] = {"status": int(m.group(2)), "retryable": m.group(3) == "true"}
    return entries


def load_py_entries(text: str) -> dict:
    """Extract {key: {status, retryable}} from errors.py registry."""
    entries = {}
    pattern = re.compile(
        r'ErrorKey\.[A-Z_]+\s*:\s*_ErrorMeta\((\d+),\s*(True|False)[^)]*\)'
    )
    key_pattern = re.compile(r'"(__ERROR_[A-Z_]+__)"')
    keys = key_pattern.findall(text)
    metas = pattern.findall(text)
    for key, (status, retryable) in zip(keys, metas):
        entries[key] = {"status": int(status), "retryable": retryable == "True"}
    return entries


def diff(label: str, spec: dict, actual_keys: set, actual_entries: dict) -> list[str]:
    errors = []
    spec_keys = set(spec.keys())

    missing = spec_keys - actual_keys
    extra   = actual_keys - spec_keys
    if missing:
        errors.append(f"[{label}] Missing keys: {sorted(missing)}")
    if extra:
        errors.append(f"[{label}] Extra keys not in spec: {sorted(extra)}")

    for key in spec_keys & actual_keys:
        s = spec[key]
        a = actual_entries.get(key, {})
        if a.get("status") != s["status"]:
            errors.append(f"[{label}] {key}: status {a.get('status')} != spec {s['status']}")
        if a.get("retryable") != s["retryable"]:
            errors.append(f"[{label}] {key}: retryable {a.get('retryable')} != spec {s['retryable']}")

    return errors


def main():
    spec = load_spec()
    mjs_text = MJS.read_text()
    py_text  = PY.read_text()

    all_errors = (
        diff("errorCodes.mjs", spec, load_mjs_keys(mjs_text), load_mjs_entries(mjs_text))
        + diff("errors.py",    spec, load_py_keys(py_text),   load_py_entries(py_text))
    )

    if all_errors:
        print("❌ error_codes.yaml is OUT OF SYNC:\n")
        for e in all_errors:
            print(" ", e)
        sys.exit(1)

    print(f"✅ All {len(spec)} error keys in sync across spec, errorCodes.mjs, and errors.py")


if __name__ == "__main__":
    main()
