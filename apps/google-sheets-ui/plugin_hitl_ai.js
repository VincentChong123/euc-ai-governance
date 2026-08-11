/**
 * HITL (Human-in-the-Loop) and API-compliant AI workflow.
 * Reads the prompt from the cell's Note, calls the LLM, and writes to the cell.
 *
 * =========================================================================
 * EXPECTED USER INPUT SCHEMA (Inside the Cell's Note)
 * =========================================================================
 * The user should Right-Click -> "Insert Note" and use the following format:
 *
 * STATUS: UPDATE  (Optional. Defaults to UPDATE. Script changes to LOCKED upon success)
 * CONTEXT: SheetName!A1:B10 (Optional. Pass 'None' or omit if no context is needed)
 * PROMPT: Please summarize the following data based on the context provided.
 *    -- OR --
 * PROMPT_REF: Sheet1!A1 (If you prefer to read the prompt text from another cell)
 *
 * Example Note (Literal Prompt):
 * ----------------------------------------------------
 * STATUS: UPDATE
 * CONTEXT: Financials!A1:D20
 * PROMPT: Analyze this data and summarize the top 3 variances.
 * ----------------------------------------------------
 *
 * Example Note (Referenced Prompt):
 * ----------------------------------------------------
 * STATUS: UPDATE
 * CONTEXT: Financials!A1:D20
 * PROMPT_REF: PromptsSheet!B2
 * ----------------------------------------------------
 */

/**
 * Appends one execution row to the versioned __Prompt_records_v{N} audit sheet.
 * Column order MUST match specs/prompt-records-schema.yaml exactly.
 *
 * @param {Object} params
 *   schemaVersion, runAt, requestId, idempotencyKey, department,
 *   targetCell, sheetNameArg, mode, memoText, promptText, contextJson,
 *   instruction, runId, modelInvoked, latencyMs, llmOutput, thinkingSteps
 * @returns {number} The row number of the newly appended record.
 */
function logToPromptRecords(params) {
  const schemaVersion = params.schemaVersion || NOTE_SCHEMA.CURRENT_VERSION;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const recordsSheetName = NOTE_SCHEMA.recordsSheetName(schemaVersion);

  let logSheet = ss.getSheetByName(recordsSheetName);
  if (!logSheet) {
    logSheet = ss.insertSheet(recordsSheetName);
    if (schemaVersion === "v2") {
      const headers = [NOTE_SCHEMA.AUDIT_SHEET_COLUMN.V2];
      logSheet.getRange(1, 1, 1, NOTE_SCHEMA.AUDIT_SHEET_COLUMN.V2.length).setValues(headers);
      logSheet.getRange(1, 1, 1, NOTE_SCHEMA.AUDIT_SHEET_COLUMN.V2.length)
              .setFontWeight("bold").setBackground("#e0e0e0");
    } else {
      // v1 legacy headers
      logSheet.getRange("A1:H1").setValues([["Timestamp", "Userid", "Mode", "Memo",
                                             "Target_Cell", "Prompt", "Output", "Resolved_Context_JSON"]]);
      logSheet.getRange("A1:H1").setFontWeight("bold").setBackground("#e0e0e0");
    }
  }

  const userEmail = PropertiesService.getUserProperties().getProperty("AI_BILLING_EMAIL") || "Unknown";
  const timestamp = params.runAt || new Date().toISOString();

  let sourceRangeVal = params.targetCell || "";
  if (schemaVersion === "v2" && params.sheetNameArg && params.targetCell) {
    const targetSheet = ss.getSheetByName(params.sheetNameArg);
    if (targetSheet) {
      const sheetId = targetSheet.getSheetId();
      // Escape any double quotes in sheet name for the formula string
      const displayStr = `${params.sheetNameArg}!${params.targetCell}`.replace(/"/g, '""');
      sourceRangeVal = `=HYPERLINK("#gid=${sheetId}&range=${params.targetCell}", "${displayStr}")`;
    }
  }

  if (schemaVersion === "v2") {
    // Column order: A-T — must match NOTE_SCHEMA.AUDIT_SHEET_COLUMN.V2 and specs/prompt-records-schema.yaml
    const thinkingStepsJson = params.thinkingSteps && params.thinkingSteps.length > 0
      ? JSON.stringify(params.thinkingSteps)
      : "";
    logSheet.appendRow([
      schemaVersion,                 // A schema_version
      timestamp,                     // B run_at
      params.requestId      || "",   // C request_id
      params.idempotencyKey || "",   // D idempotency_key
      userEmail,                     // E user_email
      params.department     || "",   // F department
      ss.getId(),                    // G spreadsheet_id
      params.sheetNameArg   || "",   // H sheet_name
      sourceRangeVal,                // I source_range (Hyperlink)
      params.mode           || "",   // J mode
      params.memoText       || "",   // K memo
      params.promptText     || "",   // L prompt
      params.contextJson    || "",   // M context_json
      params.instruction    || "",   // N instruction
      params.runId          || "",   // O run_id
      params.modelInvoked   || "",   // P model_invoked
      params.latencyMs      || "",   // Q latency_ms
      params.llmOutput      || "",   // R output
      "",                            // S prompt_record_ref — set by formula below
      thinkingStepsJson,             // T thinking_steps
      params.piiRedactionLog ? JSON.stringify(params.piiRedactionLog) : ""  // U pii_redaction_log
    ]);
    const newRow = logSheet.getLastRow();
    // S: self-referencing formula — sheet self-populates, no second write needed on failure
    logSheet.getRange(newRow, 19).setFormula(`="${recordsSheetName}!A"&ROW()`);
    return newRow;
  } else {
    // v1 legacy — positional columns A-H
    logSheet.appendRow([timestamp, userEmail, params.mode, params.memoText,
                        params.targetCell, params.promptText, params.llmOutput, params.contextJson]);
    return logSheet.getLastRow();
  }
}

// =========================================================================
// 1. THE CORE LOGIC (Decoupled from UI & API)
// =========================================================================
/**
 * @returns {{ count: number, steps: Array<{icon: string, text: string}> }}
 *   count — number of cells successfully processed
 *   steps — execution trace for the sidebar thinking panel and audit log (T column)
 */
function processHitlAiBatch(sheetName, rangeA1Notation, mode = "Batch", options = {}) {
  console.info(`[HITL Batch] Starting batch process for sheet: '${sheetName}', range: '${rangeA1Notation}'`);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    console.error(`[HITL Batch] Error: Sheet '${sheetName}' not found.`);
    throw new Error(`Sheet ${sheetName} not found`);
  }

  // Read schema version and department once per batch run (not per cell)
  const schemaVersion = getMetadataValue("schema_version") || NOTE_SCHEMA.CURRENT_VERSION;
  const department    = getMetadataValue("department") || "";
  console.info(`[HITL Batch] Schema version: ${schemaVersion}, Department: ${department || '(none)'}`);

  const targetRange = sheet.getRange(rangeA1Notation);
  const numRows = targetRange.getNumRows();
  const numCols = targetRange.getNumColumns();

  let processedCount = 0;
  const allSteps = [];

  for (let r = 1; r <= numRows; r++) {
    for (let c = 1; c <= numCols; c++) {
      const currentCell = targetRange.getCell(r, c);
      const cellAddress = currentCell.getA1Notation();
      const rawNote = currentCell.getNote();

      // Skip cells with no notes
      if (!rawNote || rawNote.trim() === "") {
        continue;
      }

      console.info(`[HITL Batch] Found note in cell ${cellAddress}`);
      const cellSteps = [];

      // Version-aware note parsing — handles both v1 (legacy) and v2 (current)
      const parsed = parseNoteByVersion(rawNote);
      if (!parsed) continue;

      const { status, memo: memoText, context: contextRangeStr, promptRef: promptRefStr } = parsed;
      let prompt = parsed.prompt;

      // If the user provided a cell reference for the prompt, go fetch it!
      if (promptRefStr) {
        try {
          prompt = SpreadsheetApp.getActiveSpreadsheet().getRange(promptRefStr).getValue().toString();
          console.log(`[HITL Batch] Dynamically fetched prompt from cell ${promptRefStr}`);
        } catch (e) {
          console.error(`[HITL Batch] Failed to fetch prompt from ${promptRefStr}: ${e.message}`);
          currentCell.setValue(`❌ Prompt Error: Invalid range ${promptRefStr}`);
          continue;
        }
      }

      if (!prompt) {
        console.warn(`[HITL Batch] Cell ${cellAddress} has a note, but missing prompt. Skipping.`);
        continue;
      }
      if (status === NOTE_SCHEMA.STATUS_LOCKED) {
        console.log(`[HITL Batch] Cell ${cellAddress} is LOCKED. Skipping.`);
        continue;
      }

      console.log(`[HITL Batch] Processing ${cellAddress} with Context: ${contextRangeStr || 'None'}`);

      // Fetch Context Data if provided
      let contextData = null;
      let resolvedContextList = [];
      if (contextRangeStr && contextRangeStr.toUpperCase() !== "NONE") {
        try {
          let initialRanges = [];

          if (contextRangeStr.startsWith("[")) {
            initialRanges = JSON.parse(contextRangeStr);
          } else {
            const separator = typeof CONFIG !== 'undefined' && CONFIG.UI_SEPARATOR ? CONFIG.UI_SEPARATOR : ";";
            if (contextRangeStr.includes(separator)) {
              initialRanges = parseRangesSafe(contextRangeStr, separator);
            } else {
              initialRanges = [contextRangeStr];
            }
          }

          // Evaluate the new "Pointer Sheet" Design Methodology for every inputted range
          let rangesToFetch = [];
          for (const rangeInput of initialRanges) {
            const pointers = resolvePointerRange(SpreadsheetApp.getActiveSpreadsheet(), rangeInput);
            if (pointers.length > 0) {
              // It was a pointer range! Add the discovered ranges
              rangesToFetch.push(...pointers);
            } else {
              // It was just a normal data range. Keep it as-is.
              rangesToFetch.push(rangeInput);
            }
          }

          resolvedContextList = rangesToFetch;

          // Replace nested loops with flatMap and the standalone helper function
          const combinedData = rangesToFetch.flatMap(rangeA1 => extractAndFormatRangeData(rangeA1));

          // Join all rows into a single text block
          contextData = combinedData.join("\n");
          console.log(`[HITL Batch] Successfully fetched context data: ${rangesToFetch.length} ranges resolved.`);
          cellSteps.push({ icon: "📋", text: `Context: ${rangesToFetch.length} range(s) resolved` });
        } catch (e) {
          console.error(`[HITL Batch] Failed to fetch context for ${cellAddress} from ${contextRangeStr}: ${e.message}`);
          currentCell.setValue(`❌ Context Error: Invalid range ${contextRangeStr}`);
          continue;
        }
      }

      // Fetch Instruction Data from the session/spreadsheet settings tab
      let instructionData = null;
      try {
        const settingsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("__AI_assistant_settings");
        if (settingsSheet) {
          instructionData = settingsSheet.getRange("A1:C10").getValues();
          console.log(`[HITL Batch] Successfully fetched system instructions from __AI_assistant_settings!A1:C10`);
        } else {
          console.log(`[HITL Batch] No __AI_assistant_settings sheet found. Proceeding without system instructions.`);
        }
      } catch (e) {
        console.warn(`[HITL Batch] Failed to read __AI_assistant_settings: ${e.message}`);
      }

      // Visual feedback in the cell
      currentCell.setValue("⏳ Generating AI Response...");
      cellSteps.push({ icon: "🤖", text: `Calling AI engine (${CONFIG.AI_ENDPOINT})...` });

      try {
        const startTime = Date.now();
        // Call the existing Corporate AI Engine
        // CONFIG.AI_ENDPOINT routes to "/api/ai/v1/sheet-chat" automatically
        const response = callCorporateAiEngineV2(prompt, contextData, instructionData, CONFIG.AI_ENDPOINT);
        const responseMeta = response.meta || {};
        const latencyMs = Date.now() - startTime;

        console.info(`[HITL Batch] AI response received for ${cellAddress} in ${latencyMs}ms`);
        cellSteps.push({ icon: "✅", text: `Response received — model: ${responseMeta.model_invoked || "unknown"}, latency: ${responseMeta.latency_ms || latencyMs}ms` });

        // Overwrite cell with response
        currentCell.setValue(response.text);

        // Log to versioned __Prompt_records_v{N} for audit traceability
        const contextJsonStr = resolvedContextList.length > 0 ? JSON.stringify(resolvedContextList) : "[]";
        const nowIso = new Date().toISOString();
        const newRow = logToPromptRecords({
          schemaVersion,
          runAt:          nowIso,
          department,
          targetCell:     cellAddress,
          sheetNameArg:   sheetName,
          mode,
          memoText,
          promptText:     prompt || promptRefStr,
          contextJson:    contextJsonStr,
          instruction:    instructionData ? JSON.stringify(instructionData) : "",
          requestId:      responseMeta.request_id,
          idempotencyKey: responseMeta.idempotency_key,
          runId:          responseMeta.run_id,
          modelInvoked:   responseMeta.model_invoked,
          latencyMs:      responseMeta.latency_ms || latencyMs,
          llmOutput:      response.text,
          thinkingSteps:  cellSteps,
          piiRedactionLog: options.piiRedactionLog || null
        });

        console.info("[PromptRecords] Appended AI execution audit row", {
          recordsSheet: NOTE_SCHEMA.recordsSheetName(schemaVersion),
          row: newRow,
          requestId: responseMeta.request_id || "",
          idempotencyKey: responseMeta.idempotency_key || "",
          runId: responseMeta.run_id || "",
          modelInvoked: responseMeta.model_invoked || "",
          sourceRange: `${sheetName}!${cellAddress}`,
          latencyMs: responseMeta.latency_ms || latencyMs
        });
        cellSteps.push({ icon: "📝", text: `Audit logged → ${NOTE_SCHEMA.recordsSheetName(schemaVersion)}!A${newRow}` });

        // Write v2 display note back to cell (system-owned block above ---, user config below)
        const recordsSheetName = NOTE_SCHEMA.recordsSheetName(schemaVersion);
        let newNote;
        if (schemaVersion === "v2") {
          const metaJson = {
            status: NOTE_SCHEMA.STATUS_LOCKED,
            full_prompt_record: `${recordsSheetName}!A${newRow}`
          };
          if (promptRefStr) metaJson.prompt_ref = promptRefStr;

          newNote = prompt || "";
          newNote += "\n\n\n\n\n\n\n\n\n\n";
          newNote += JSON.stringify(metaJson);
        } else {
          // v1 legacy note format — backward compat for pre-existing v1 spreadsheets
          newNote = `STATUS: LOCKED\nCONTEXT: ${contextRangeStr || "None"}\n`;
          if (memoText) newNote += `MEMO: ${memoText}\n`;
          newNote += promptRefStr ? `PROMPT_REF: ${promptRefStr}` : `PROMPT: ${prompt}`;
        }
        currentCell.setNote(newNote);

        processedCount++;
        allSteps.push(...cellSteps);
      } catch (err) {
        console.error(`[HITL Batch] Error calling AI engine for ${cellAddress}: ${err.message}`);
        currentCell.setValue(`❌ AI Error: ${err.message}`);
        cellSteps.push({ icon: "❌", text: `Error: ${err.message}` });
        allSteps.push(...cellSteps);
      }
    }
  }

  console.info(`[HITL Batch] Completed processing. Total cells processed: ${processedCount}`);
  return { count: processedCount, steps: allSteps };
}

// =========================================================================
// 2. TRIGGER A: The Human GUI Icon (Mouse-driven)
// =========================================================================
function onGuiIconClick() {
  console.info("[GUI Trigger] User clicked the GUI Icon.");
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet();
  const activeRange = sheet.getActiveRange();

  // Grab whatever cells the user's mouse currently has highlighted
  const rangeNotation = activeRange.getA1Notation();
  const values = activeRange.getValues();

  // Phase 1: Orchestrator Mode Routing Switch
  // If the top-left cell evaluates to a string with a "!", it's a Sheet Reference pointer
  const topLeftValue = String(values[0][0]).trim();
  const isOrchestratorMode = topLeftValue.includes('!');

  if (isOrchestratorMode) {
    spreadsheet.toast(`Orchestrator Mode detected. Following target cells...`, "AI Engine Started");
  } else {
    spreadsheet.toast(`Scanning ${rangeNotation} for AI Notes...`, "AI Engine Started");
  }

  try {
    let count = 0;

    if (isOrchestratorMode) {
      console.info("[GUI Trigger] Orchestrator Mode activated! Routing to target cells.");

      // Loop over every cell in the selected Orchestrator range
      for (let r = 0; r < values.length; r++) {
        for (let c = 0; c < values[r].length; c++) {
          const targetRef = String(values[r][c]).trim();

          if (targetRef && targetRef.includes('!')) {
            try {
              // Let Google's native engine perfectly parse the complex sheet name string
              const targetRangeObj = spreadsheet.getRange(targetRef);
              if (targetRangeObj) {
                console.log(`[GUI Trigger] Orchestrator routing to: ${targetRef}`);
                // Execute the AI on the *target* cell
                count += processHitlAiBatch(targetRangeObj.getSheet().getName(), targetRangeObj.getA1Notation(), "Orchestrator").count;
              }
            } catch (e) {
              console.warn(`[GUI Trigger] Orchestrator skipped invalid reference: ${targetRef}`);
            }
          }
        }
      }
    } else {
      // Normal Execution: Process the highlighted cells directly
      count = processHitlAiBatch(sheet.getName(), rangeNotation).count;
    }

    if (count > 0) {
      spreadsheet.toast(`✅ Processed ${count} cells successfully!`, "AI Engine Complete");
      console.info(`[GUI Trigger] Finished successfully. Count: ${count}`);
    } else {
      spreadsheet.toast(`No actionable AI targets found.`, "Skipped");
      console.log(`[GUI Trigger] Finished. No actionable notes found.`);
    }
  } catch (error) {
    console.error(`[GUI Trigger] Fatal Error: ${error.message}`);
    spreadsheet.toast(`❌ Error: ${error.message}`, "Failed");
  }
}

// =========================================================================
// 3. TRIGGER B: The API Webhook (Machine-driven)
// =========================================================================
function doPost(e) {
  console.info("[API Trigger] Received incoming webhook POST request.");
  try {
    // Expected Payload: { "sheet": "Sheet1", "range": "A1:B5" }
    const requestData = JSON.parse(e.postData.contents);
    console.log(`[API Trigger] Payload received: ${JSON.stringify(requestData)}`);

    if (!requestData.sheet || !requestData.range) {
      console.warn("[API Trigger] Payload rejected: Missing 'sheet' or 'range'.");
      return ContentService.createTextOutput(JSON.stringify({ error: "Missing 'sheet' or 'range' in payload." }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    // Pass the API payload to the EXACT same core logic
    const { count } = processHitlAiBatch(requestData.sheet, requestData.range);

    console.info(`[API Trigger] Success. Returning count: ${count}`);
    return ContentService.createTextOutput(JSON.stringify({ success: true, processed_cells: count }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.error(`[API Trigger] Execution failed: ${error.message}`);
    return ContentService.createTextOutput(JSON.stringify({ error: error.message }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Advanced State-Machine Parser to handle quoted sheet names containing semicolons
 */
function parseRangesSafe(inputStr, separator) {
  const result = [];
  let currentToken = "";
  let insideQuotes = false;

  for (let i = 0; i < inputStr.length; i++) {
    const char = inputStr[i];

    if (char === "'") {
      insideQuotes = !insideQuotes;
      currentToken += char;
    } else if (char === separator && !insideQuotes) {
      if (currentToken.trim() !== "") result.push(currentToken.trim());
      currentToken = "";
    } else {
      currentToken += char;
    }
  }

  if (currentToken.trim() !== "") result.push(currentToken.trim());
  return result;
}

/**
 * Universal Pointer Resolver.
 * Takes an A1 Notation. If it points to a range containing valid pointers (like Data!A1 or Named Ranges),
 * it returns an array of those pointers. If the range does not contain pointers, it returns an empty array.
 */
function resolvePointerRange(spreadsheet, rangeA1Notation) {
  const pointers = [];
  AImateLogger.debug("Starting pointer resolution", { range: rangeA1Notation });

  try {
    const range = spreadsheet.getRange(rangeA1Notation);
    const values = range.getValues();

    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        const val = String(values[r][c]).trim();
        // Heuristic: Must contain ! or be a single continuous word (Named Range)
        if (val && (val.includes('!') || /^[a-zA-Z0-9_]+$/.test(val))) {
          try {
            // Let Google mathematically prove if it's a valid pointer
            const target = spreadsheet.getRange(val);
            if (target) {
              pointers.push(val);
              AImateLogger.debug("Validated pointer", { pointer: val });
            }
          } catch(e) {
            // Not a valid pointer, ignore
            AImateLogger.debug("Candidate failed validation", { candidate: val, error: e.message });
          }
        }
      }
    }
  } catch (e) {
    AImateLogger.warn("Failed to resolve pointer range", { range: rangeA1Notation, error: e.message });
  }

  AImateLogger.info("Pointer resolution complete", { range: rangeA1Notation, pointerCount: pointers.length, pointers });
  return pointers;
}

/**
 * Fetches data from a specific A1 range and formats it for LLM ingestion.
 * @param {string} rangeA1Notation - A single range (e.g., 'Sheet1!A1:B10')
 * @returns {string[]} An array of pipe-separated row strings.
 */
function extractAndFormatRangeData(rangeA1Notation) {
  const data = SpreadsheetApp.getActiveSpreadsheet().getRange(rangeA1Notation).getValues();
  const formattedRows = [];

  data.forEach(row => {
    formattedRows.push(row.join(" | "));
  });

  return formattedRows;
}

// =========================================================================
// 6. NOTE SCHEMA HELPERS
// =========================================================================

/**
 * Reads a key-value pair from the __metadata sheet.
 * Cached per-call only — call once per batch, not per cell.
 * @param {string} key
 * @returns {string|null}
 */
function getMetadataValue(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const metaSheet = ss.getSheetByName("__metadata");
  if (!metaSheet) return null;
  const data = metaSheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === key.toLowerCase()) {
      return String(data[i][1]).trim();
    }
  }
  return null;
}

/**
 * Routes note parsing to the correct version-specific parser.
 * Identifies version by presence of 'schema:' key; defaults to v1.
 * @param {string} rawNote
 * @returns {Object|null} Normalised note fields.
 */
function parseNoteByVersion(rawNote) {
  if (!rawNote || rawNote.trim() === "") return null;

  const isV2Json = /\{[\s\S]*"status"[\s\S]*\}\s*$/.test(rawNote);
  const isV2Hyphens = rawNote.includes("---");
  const isV2Schema = /^schema:\s*(v\d+)/im.test(rawNote);

  if (isV2Json || isV2Hyphens || isV2Schema) {
    return parseNoteV2(rawNote);
  }

  return parseNoteV1(rawNote); // safe fallback for all unknown versions
}

/**
 * Parses a v1 (legacy, all-caps) cell note.
 * @param {string} rawNote
 * @returns {Object}
 */
function parseNoteV1(rawNote) {
  const statusMatch    = rawNote.match(/STATUS:\s*(.*)/i);
  const contextMatch   = rawNote.match(/CONTEXT:\s*(.*)/i);
  const memoMatch      = rawNote.match(/MEMO:\s*(.*)/i);
  const promptMatch    = rawNote.match(/^PROMPT:\s*([\s\S]*)/im);
  const promptRefMatch = rawNote.match(/^PROMPT_REF:\s*(.*)/im);
  const rawStatus = statusMatch ? statusMatch[1].trim().toUpperCase() : "UPDATE";
  return {
    schemaVersion: "v1",
    // Normalise UPDATE → READY so batch check 'status === STATUS_LOCKED' works for both
    status:        rawStatus === "UPDATE" ? NOTE_SCHEMA.STATUS_READY : rawStatus,
    context:       contextMatch   ? contextMatch[1].trim()   : null,
    memo:          memoMatch      ? memoMatch[1].trim()      : "",
    prompt:        promptMatch    ? promptMatch[1].trim()    : null,
    promptRef:        promptRefMatch ? promptRefMatch[1].trim() : null,
    runAt:            null,
    fullPromptRecord: null
  };
}

/**
 * Parses a v2 (lowercase, --- separated) cell note.
 * System fields live above '---'; user config fields live below.
 * @param {string} rawNote
 * @returns {Object}
 */
function parseNoteV2(rawNote) {
  // 1. Try the modern JSON-at-bottom format
  const jsonMatch = rawNote.match(/(\n*\{[\s\S]*"status"[\s\S]*\})\s*$/);
  if (jsonMatch) {
    try {
      const meta = JSON.parse(jsonMatch[1].trim());
      if (meta.status) {
        return {
          schemaVersion: "v2",
          status: meta.status || NOTE_SCHEMA.STATUS_READY,
          context: meta.context || null,
          memo: meta.memo || "",
          prompt: rawNote.substring(0, jsonMatch.index).trim() || null,
          promptRef: meta.prompt_ref || null,
          fullPromptRecord: meta.full_prompt_record || null
        };
      }
    } catch (e) {
      // Not valid JSON, fallback
    }
  }

  // 2. Fallback to old V2 formats
  const parts       = rawNote.split(/^---\s*$/m);
  const systemBlock = parts[0] || "";
  const userBlock   = parts[1] || rawNote;

  const statusMatch    = systemBlock.match(/^status:\s*(.*)/im);
  const recordMatch    = systemBlock.match(/^\[([^\]]+)\]/m) || systemBlock.match(/^full_prompt_record:\s*(.*)/im);

  const contextMatch   = userBlock.match(/^context:\s*(.*)/im);
  const memoMatch      = userBlock.match(/^memo:\s*(.*)/im);
  const promptRefMatch = userBlock.match(/^prompt_ref:\s*(.*)/im);

  let parsedPrompt = userBlock;
  parsedPrompt = parsedPrompt.replace(/^\/\/ DO NOT EDIT SYSTEM METADATA BELOW \/\/\n?/gim, '');
  parsedPrompt = parsedPrompt.replace(/^context:\s*.*\n?/gim, '');
  parsedPrompt = parsedPrompt.replace(/^memo:\s*.*\n?/gim, '');
  parsedPrompt = parsedPrompt.replace(/^prompt_ref:\s*.*\n?/gim, '');
  parsedPrompt = parsedPrompt.replace(/^prompt:\s*/gim, '');
  parsedPrompt = parsedPrompt.trim();

  return {
    schemaVersion: "v2",
    status:        statusMatch    ? statusMatch[1].trim().toUpperCase()    : NOTE_SCHEMA.STATUS_READY,
    context:       contextMatch   ? contextMatch[1].trim()                 : null,
    memo:          memoMatch      ? memoMatch[1].trim()                    : "",
    prompt:        parsedPrompt || null,
    promptRef:     promptRefMatch ? promptRefMatch[1].trim()               : null,
    fullPromptRecord: recordMatch ? recordMatch[1].trim()                  : null
  };
}
