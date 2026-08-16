# Security & Data Hygiene

This portfolio repo is a **curated, secret-free snapshot** of the working codebase.
It is published to demonstrate data-governance design, and the publishing process itself
follows the same controls the project is about.

## What is guaranteed here
- **No credentials**: no `.env`, no keys, no service-account files, no tokens.
- **No secrets in git history**: no historical secret can be recovered from any commit.

## How secrets are handled in the full system
- Configuration and secrets via **environment variables / secret-manager**, never in code.
- `.gitignore` excludes `.env`, `.env.*`, `keys/`, credentials, and virtualenvs.
- A **TruffleHog** ruleset (`.trufflehog/rules.yaml`) provides a custom detector
  (e.g. Google Cloud HMAC keys) as a pre-publish guard.

## Verification performed before publishing
- `gitleaks detect --no-git` → **no leaks found**
- `trufflehog filesystem` → **0 verified / 0 unverified secrets**

If you believe you have found sensitive data in this repo, please contact the author
before opening a public issue.
