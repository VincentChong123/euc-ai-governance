/**
 * Backend functions for the AI Sidebar UI.
 */

/**
 * Fetches PII and injection guardrail patterns from the gateway.
 * Called once on sidebar load via google.script.run so the sidebar can do
 * client-side PII detection before submitting a prompt.
 *
 * @returns {{ injection: Array, pii: Array } | null} Pattern lists, or null on failure.
 */
function getGuardrailPatterns() {
  try {
    const url = getBaseUrl() + '/guardrail/patterns';
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      console.warn('[Guardrails] Failed to fetch patterns, status:', response.getResponseCode());
      return null;
    }
    return JSON.parse(response.getContentText());
  } catch (e) {
    console.warn('[Guardrails] Could not fetch guardrail patterns:', e.message);
    return null;
  }
}

// Displays the Sidebar in Google Sheets
function showAiSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('sidebar')
      .setTitle('AImate')
      .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

// Called by [📍 Get Selected Range] button
function getMouseSelectionA1() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const range = sheet.getActiveRange();
  const sheetName = sheet.getName();

  // Format the sheet name according to Google Sheets native rules
  // If it contains spaces, commas, or special chars, wrap in single quotes and double the internal apostrophes
  let formattedSheetName = sheetName;
  if (!/^[a-zA-Z0-9_]+$/.test(sheetName)) {
    formattedSheetName = "'" + sheetName.replace(/'/g, "''") + "'";
  }

  return `${formattedSheetName}!${range.getA1Notation()}`;
}

function jumpToRange(rangeA1) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const range = ss.getRange(rangeA1);
    ss.setActiveSheet(range.getSheet());
    ss.setActiveRange(range);
  } catch (e) {
    console.error("Jump to range failed for " + rangeA1 + ": " + e.message);
  }
}

// Called by [📥 Load from Active Cell] button
function getActiveCellData() {
  const cell = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getActiveCell();
  const rawNote = cell.getNote();

  if (!rawNote || rawNote.trim() === "") return null;

  const parsed = parseNoteByVersion(rawNote);
  if (!parsed) return null;

  let contextStr = parsed.context || "";
  let memoStr = parsed.memo || "";

  // If the note was simplified (executed), restore context and memo dynamically from the audit sheet
  if (!contextStr && !memoStr && parsed.fullPromptRecord) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const recordRange = ss.getRange(parsed.fullPromptRecord);
      const sheet = recordRange.getSheet();
      const rowNum = recordRange.getRow();

      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const rowData = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];

      for (let i = 0; i < headers.length; i++) {
        const h = String(headers[i]).trim().toLowerCase();
        if (h === "context_json" || h === "resolved_context_json") {
          contextStr = String(rowData[i] || "");
        }
        if (h === "memo") {
          memoStr = String(rowData[i] || "");
        }
      }
    } catch(e) {
      // Graceful fallback if sheet is missing or range invalid
    }
  }

  return {
    status: parsed.status,
    context: contextStr,
    memo: memoStr,
    prompt: parsed.promptRef ? `PROMPT_REF: ${parsed.promptRef}` : (parsed.prompt || ""),
    fullPromptRecord: parsed.fullPromptRecord || null
  };
}

// Called by [💾 Save to Note] button
function saveNoteToActiveCell(payload) {
  const cell = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getActiveCell();
  const rawNote = cell.getNote();
  const parsed = parseNoteByVersion(rawNote) || {};

  const schemaVersion = getMetadataValue("schema_version") || NOTE_SCHEMA.CURRENT_VERSION;

  if (schemaVersion === "v2") {
    const metaJson = { status: payload.status };
    if (parsed.fullPromptRecord) metaJson.full_prompt_record = parsed.fullPromptRecord;
    if (payload.memo) metaJson.memo = payload.memo;
    if (payload.context && payload.context !== "None") metaJson.context = payload.context;

    let newNote = payload.prompt || "";
    newNote += "\n\n\n\n\n\n\n\n\n\n";
    newNote += JSON.stringify(metaJson);

    cell.setNote(newNote);
  } else {
    // v1 legacy
    let noteStr = `STATUS: ${payload.status}\nCONTEXT: ${payload.context || "None"}\n`;
    if (payload.memo) noteStr += `MEMO: ${payload.memo}\n`;

    if (payload.prompt && payload.prompt.startsWith("PROMPT_REF:")) {
      noteStr += `${payload.prompt}`; // preserve the exact syntax
    } else {
      noteStr += `PROMPT: ${payload.prompt}`;
    }
    cell.setNote(noteStr);
  }

  return true;
}

// Called by [🚀 Save & Run AI Now] button
function saveAndExecuteSingleCell(payload) {
  // 1. Save the payload to the note first
  saveNoteToActiveCell(payload);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const cellNotation = sheet.getActiveCell().getA1Notation();

  try {
    // 2. Re-use the core engine logic to process this specific cell!
    const { steps } = processHitlAiBatch(sheet.getName(), cellNotation, "Single", {
      piiRedactionLog: payload.piiRedactionLog || null
    });
    return { success: true, steps: steps || [] };
  } catch(e) {
    return { error: e.message };
  }
}

// Called from the Custom Menu to export all selected cell notes to a table
function exportDraftsToSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const activeSheet = ss.getActiveSheet();
  const activeRange = activeSheet.getActiveRange();

  if (!activeRange) {
    SpreadsheetApp.getUi().alert("Please select a range of cells first.");
    return;
  }

  const numRows = activeRange.getNumRows();
  const numCols = activeRange.getNumColumns();
  const drafts = [];

  for (let r = 1; r <= numRows; r++) {
    for (let c = 1; c <= numCols; c++) {
      const cell = activeRange.getCell(r, c);
      const rawNote = cell.getNote();
      if (rawNote && rawNote.trim() !== "") {
        const parsed = parseNoteByVersion(rawNote);
        if (parsed) {
          const promptOut = parsed.promptRef ? `PROMPT_REF: ${parsed.promptRef}` : (parsed.prompt || "");
          drafts.push([
            `'${activeSheet.getName()}'!${cell.getA1Notation()}`,
            parsed.status,
            parsed.context || "",
            promptOut
          ]);
        }
      }
    }
  }

  if (drafts.length === 0) {
    SpreadsheetApp.getUi().alert("No AI drafts found in the selected range.");
    return;
  }

  let exportSheet = ss.getSheetByName("__Review_Drafts");
  if (!exportSheet) {
    exportSheet = ss.insertSheet("__Review_Drafts");
  } else {
    exportSheet.clear();
  }

  exportSheet.getRange("A1:D1").setValues([["Cell Reference", "Status", "Context", "Prompt"]]);
  exportSheet.getRange("A1:D1").setFontWeight("bold").setBackground("#f3f3f3");
  exportSheet.getRange(2, 1, drafts.length, 4).setValues(drafts);
  exportSheet.autoResizeColumns(1, 3);

  exportSheet.activate();
  SpreadsheetApp.getUi().alert(`Exported ${drafts.length} drafts to the __Review_Drafts sheet!`);
}

// Called from the Custom Menu to convert hardcoded A1 strings into Named Ranges
function convertToNamedRanges() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const range = sheet.getActiveRange();
  const namedRanges = ss.getNamedRanges();

  if (!namedRanges || namedRanges.length === 0) {
    SpreadsheetApp.getUi().alert("No Named Ranges found in this spreadsheet.");
    return;
  }

  // Build a fast lookup dictionary of A1 Notation -> Named Range Name
  const rangeMap = {};
  namedRanges.forEach(nr => {
    try {
      const nrRange = nr.getRange();
      const sheetName = nrRange.getSheet().getName();

      // We store both the plain and auto-quoted versions to catch all user inputs
      let formattedSheetName = sheetName;
      if (!/^[a-zA-Z0-9_]+$/.test(sheetName)) {
        formattedSheetName = "'" + sheetName.replace(/'/g, "''") + "'";
      }

      const fullA1 = `${formattedSheetName}!${nrRange.getA1Notation()}`.toUpperCase();
      const plainA1 = `${sheetName}!${nrRange.getA1Notation()}`.toUpperCase();

      rangeMap[fullA1] = nr.getName();
      rangeMap[plainA1] = nr.getName();
    } catch (e) {
      // Ignore named ranges with invalid/broken references (#REF!)
    }
  });

  const values = range.getValues();
  let matchCount = 0;

  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const cellValue = String(values[r][c]).trim().toUpperCase();

      if (rangeMap[cellValue]) {
        // Replace the hardcoded string with the Named Range Name
        values[r][c] = rangeMap[cellValue];
        matchCount++;
      }
    }
  }

  if (matchCount > 0) {
    range.setValues(values);
    SpreadsheetApp.getUi().alert(`✅ Successfully converted ${matchCount} hardcoded references into robust Named Ranges!`);
  } else {
    SpreadsheetApp.getUi().alert("No matching hardcoded references found in the selected cells.");
  }
}
