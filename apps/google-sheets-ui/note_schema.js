/**
 * AImate Note Schema Constants
 *
 * Single source of truth for cell note field keys, schema versions, and status values.
 * All Apps Script files reference these constants — never use raw strings for these values.
 *
 * When changing the schema:
 *   1. Update specs/prompt-records-schema.yaml FIRST (the human contract)
 *   2. Update CURRENT_VERSION and add a new V{N} block here
 *   3. Update logToPromptRecords() column order to match the new spec
 *   4. Add the new version to the __metadata dropdown in affected spreadsheets
 */
var NOTE_SCHEMA = NOTE_SCHEMA || {};

// ── Current active version ────────────────────────────────────────────────
NOTE_SCHEMA.CURRENT_VERSION = "v2";

// ── Status values (shared across all versions) ────────────────────────────
NOTE_SCHEMA.STATUS_LOCKED = "LOCKED";  // cell processed — skip in bulk run
NOTE_SCHEMA.STATUS_READY  = "READY";   // cell active — include in bulk run (replaces v1 UPDATE)

// ── Section separator used in v2+ notes ──────────────────────────────────
NOTE_SCHEMA.SEPARATOR = "---";

// ── Prompt records sheet name template ───────────────────────────────────
NOTE_SCHEMA.recordsSheetName = function(version) {
  return "__Prompt_records_" + version;
};

NOTE_SCHEMA.CELL_NOTE = {};
NOTE_SCHEMA.AUDIT_SHEET_COLUMN = {};

// ── V1 field keys (uppercase — legacy format) ─────────────────────────────
NOTE_SCHEMA.CELL_NOTE.V1 = {
  STATUS:     "STATUS",
  CONTEXT:    "CONTEXT",
  MEMO:       "MEMO",
  PROMPT:     "PROMPT",
  PROMPT_REF: "PROMPT_REF"
};

// ── V2 field keys (lowercase — current format) ────────────────────────────
NOTE_SCHEMA.CELL_NOTE.V2 = {
  SCHEMA:      "schema",
  STATUS:      "status",
  RUN_AT:             "run_at",
  FULL_PROMPT_RECORD: "full_prompt_record",
  MEMO:               "memo",
  PROMPT:      "prompt",
  PROMPT_REF:  "prompt_ref",
  CONTEXT:     "context"
};



// ── V1 column order — MUST match specs/prompt-records-schema.yaml exactly ─
NOTE_SCHEMA.AUDIT_SHEET_COLUMN.V1 = [
  "Timestamp",   // A
  "Userid",   // B
  "Mode",   // C
  "Memo",   // D
  "Target_Cell",   // E
  "Prompt",   // F
  "Output",   // G
  "Resolved_Context_JSON"   // H
];

// ── V2 column order — MUST match specs/prompt-records-schema.yaml exactly ─
NOTE_SCHEMA.AUDIT_SHEET_COLUMN.V2 = [
  "schema_version",   // A
  "run_at",   // B
  "request_id",   // C
  "idempotency_key",   // D
  "user_email",   // E
  "department",   // F
  "spreadsheet_id",   // G
  "sheet_name",   // H
  "source_range",   // I
  "mode",   // J
  "memo",   // K
  "prompt",   // L
  "context_json",   // M
  "instruction",   // N
  "run_id",   // O
  "model_invoked",   // P
  "latency_ms",   // Q
  "output",   // R
  "full_prompt_record",   // S
  "thinking_steps",  // T — JSON array of {icon, text} execution trace from sidebar
  "pii_redaction_log"  // U — JSON array of {rule, field, count} from client-side PII scan
];
