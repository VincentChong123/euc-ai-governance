/**
 * A lightweight, Zero-Trust Masking Engine for Google Apps Script
 */
const PrivacyEngine = {

    // 1. Read the sensitive patterns LOB wants to hide from Config.js
    get rules() {
      return typeof CONFIG !== 'undefined' && CONFIG.PII_RULES ? CONFIG.PII_RULES : {};
    },

    // 2. The Masking Function (Run BEFORE sending to IT)
    mask: function(text) {
    let vault = {}; // This dictionary NEVER leaves Google Sheets
    let maskedText = text;
    let counter = 1;

    for (let [type, regex] of Object.entries(this.rules)) {
        maskedText = maskedText.replace(regex, (match) => {
        let token = `[${type}_${counter++}]`;
        vault[token] = match; // Store the real data in the local vault
        return token;
        });
    }

    return { safeText: maskedText, vault: vault };
    },

    // 3. The Re-hydration Function (Run AFTER receiving from IT)
    rehydrate: function(safeResponse, vault) {
    let hydratedText = safeResponse;

    // Swap the tokens back to the real data
    for (let [token, realData] of Object.entries(vault)) {
        // Use split/join to replace all occurrences of the token
        hydratedText = hydratedText.split(token).join(realData);
    }

    return hydratedText;
    }
};

function getBaseUrl() {
  const metadataSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("__Metadata");
  if (!metadataSheet) {
    throw new Error("❌ Error: Could not find '__Metadata' sheet.");
  }

  const url = metadataSheet.getRange("B3").getValue();
  if (!url) {
    throw new Error("❌ Error: API Gateway URL is missing in '__Metadata!B3'.");
  }

  // Return the URL, stripping any trailing slash just to be safe!
  return url.toString().replace(/\/$/, "");
}


  /**
   * Automatically watches for edits. If F1 is checked, it triggers the Approval Workflow.
   */

  // ====================================================================
  // CUSTOM MENU (Builds the UI automatically when the sheet opens)
  // ====================================================================
  function onOpen(e) {
    SpreadsheetApp.getUi()
      .createMenu('AImate')
      .addItem('Open Note Builder', 'showAiSidebar')
      .addSeparator()
      .addItem('Run AI on Selected Cells (Batch)', 'onGuiIconClick')
      .addItem('Convert Selection to Named Ranges', 'convertToNamedRanges')
      .addItem('Export Selected Drafts for Review', 'exportDraftsToSheet')
      .addToUi();
  }

  // ====================================================================
  // SETUP FUNCTION (Run this ONCE manually in the Apps Script Editor)
  // ====================================================================
function installTriggers() {
    const sheet = SpreadsheetApp.getActive();

    // Deletes any existing triggers to avoid duplicates
    const existing = ScriptApp.getProjectTriggers();
    existing.forEach(trigger => ScriptApp.deleteTrigger(trigger));

    // Creates the Installable Trigger which has full UrlFetchApp permissions!
    ScriptApp.newTrigger('onCheckboxClick')
        .forSpreadsheet(sheet)
        .onEdit()
        .create();

    SpreadsheetApp.getActiveSpreadsheet().toast("✅ Trigger installed successfully!", "Setup Complete");
  }

  function onCheckboxClick(e) {
    if (!e || !e.range) return;

    const sheetName = e.range.getSheet().getName();
    const cellA1 = e.range.getA1Notation();
    AImateLogger.info("[Router] Edit detected", { sheetName: sheetName, cellA1: cellA1, value: e.value });

    // If the edit wasn't a checkbox being checked, ignore it
    // Note: e.value can sometimes be a boolean instead of a string, so we check both!
    if (e.value !== "TRUE" && e.value !== true) {
      AImateLogger.debug("[Router] Ignoring edit. Value was not TRUE", { value: e.value });
      return;
    }

    const sheet = e.range.getSheet();
    const routeKey = `${sheetName}!${cellA1}`;
    AImateLogger.debug("[Router] Looking up Route Key", { routeKey: routeKey });

    // Look up the namespace path in our Config.js Plugin Registry (e.g. "AuthPlugin.handle")
    const namespacePath = CONFIG.ROUTER[routeKey];
    AImateLogger.info("[Router] Mapped Namespace lookup result", { namespacePath: namespacePath || 'NONE' });

    if (namespacePath) {
      // Safely traverse the global memory to find the nested function!
      // In the V8 Apps Script runtime, the root object is 'globalThis'
      const pathParts = namespacePath.split(".");
      let targetFunction = globalThis;

      for (const part of pathParts) {
        if (targetFunction) {
          targetFunction = targetFunction[part];
        }
      }

      AImateLogger.debug("[Router] Extracted function type", { type: typeof targetFunction });

      // Execute it if we found a valid function!
      if (typeof targetFunction === "function") {
        AImateLogger.info("[Router] Executing plugin", { namespacePath: namespacePath });
        // We bind it to the parent object (if any) so 'this' works inside the plugin!
        const parentObject = pathParts.length > 1 ? globalThis[pathParts[0]] : globalThis;
        targetFunction.call(parentObject, e, sheet);
      } else {
        AImateLogger.error("[Router] Failed to find the function in global memory", { namespacePath: namespacePath });
      }
    }
  }

  // The sub-functions for handleAuthCheckboxClick and handleRingishoCheckboxClick
  // have been moved to their own dedicated .js files!


/*
 * ************ */

function getConfiguredContractVersion() {
  return (typeof CONFIG !== "undefined" && CONFIG.CONTRACT_VERSION) ? CONFIG.CONTRACT_VERSION : "unknown";
}

function getConfiguredContractClient() {
  return (typeof CONFIG !== "undefined" && CONFIG.CONTRACT_CLIENT) ? CONFIG.CONTRACT_CLIENT : "google-sheets-ui";
}

function getConfiguredRequestIdHeader() {
  return (typeof CONFIG !== "undefined" && CONFIG.REQUEST_ID_HEADER) ? CONFIG.REQUEST_ID_HEADER : "x-request-id";
}

function getConfiguredContractSourcePath() {
  return (typeof CONFIG !== "undefined" && CONFIG.CONTRACT_SOURCE_PATH) ? CONFIG.CONTRACT_SOURCE_PATH : "";
}

function getConfiguredContractSourceUrl() {
  return (typeof CONFIG !== "undefined" && CONFIG.CONTRACT_SOURCE_URL) ? CONFIG.CONTRACT_SOURCE_URL : "";
}

function getSchemaVersionFromMetadata() {
  try {
    const metadata = SpreadsheetApp.getActiveSpreadsheet().getDeveloperMetadata();
    for (let i = 0; i < metadata.length; i++) {
      if (metadata[i].getKey() === "schema_version") {
        return metadata[i].getValue();
      }
    }
  } catch (e) {
    console.warn("[Contract] Unable to read schema_version metadata: " + e.message);
  }

  return getConfiguredContractVersion();
}

function normalizeTextField(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function buildSheetsRequestMeta(userEmail) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const activeSheet = spreadsheet ? spreadsheet.getActiveSheet() : null;
  const activeRange = activeSheet ? activeSheet.getActiveRange() : null;
  const requestId = Utilities.getUuid();
  const idempotencyKey = requestId;

  return {
    request_id: requestId,
    idempotency_key: idempotencyKey,
    client: getConfiguredContractClient(),
    client_version: getSchemaVersionFromMetadata(),
    user_email: userEmail,
    spreadsheet_id: spreadsheet ? spreadsheet.getId() : "",
    sheet_name: activeSheet ? activeSheet.getName() : "",
    source_range: activeRange ? activeRange.getA1Notation() : "",
    run_at: new Date().toISOString()
  };
}

function extractAiResultText(responseJson) {
  if (responseJson && responseJson.ok === true && responseJson.result && typeof responseJson.result.text === "string") {
    return responseJson.result.text;
  }

  if (responseJson && typeof responseJson.result === "string") {
    return responseJson.result;
  }

  return "";
}

function extractAiResponseMeta(responseJson) {
  if (responseJson && responseJson.meta) {
    return responseJson.meta;
  }

  return {};
}

/**
 * Core AI Engine. Returns text plus transport metadata for audit logging.
 * Existing string-only callers should continue using callCorporateAiEngine().
 */
function callCorporateAiEngineV2(prompt, context, instruction, endpointConfig) {
  // ========================================================
  // 1. USER IDENTITY (From Secure Storage)
  // ========================================================
  // Because formulas are blocked from reading identity, we read the memory
  // saved by the Checkbox click!
  const userEmail = PropertiesService.getUserProperties().getProperty("AI_BILLING_EMAIL");

  if (!userEmail) {
    // Gracefully fail and instruct the user on exactly how to authenticate
    return {
      text: `❌ Auth Required: Please tick the checkbox at 'get_user_email_address!B1' to authenticate.`,
      meta: {}
    };
  }

  // ========================================================
  // 2. CLIENT-SIDE PII MASKING (ZERO TRUST)
  // ========================================================
  const contextString = normalizeTextField(context);
  const instructionString = normalizeTextField(instruction);

  // Mask the prompt and context locally
  const maskedPrompt = PrivacyEngine.mask(prompt);
  const maskedContext = PrivacyEngine.mask(contextString);
  const maskedInstruction = PrivacyEngine.mask(instructionString);

  // Merge the vaults so we can rehydrate everything later
  const mergedVault = { ...maskedPrompt.vault, ...maskedContext.vault, ...maskedInstruction.vault };

  // ========================================================
  // 3. SECURE API CALL TO PYTHON BACKEND
  // ========================================================
  const proxyUrl = `${getBaseUrl()}${endpointConfig}`;
  const requestMeta = buildSheetsRequestMeta(userEmail);

  const payload = {
    meta: requestMeta,
    payload: {
      prompt: maskedPrompt.safeText,
      context: maskedContext.safeText,
      instruction: maskedInstruction.safeText,
      masking: {
        enabled: true,
        tokens_present: Object.keys(mergedVault).length > 0
      }
    }
  };

  if (typeof AImateLogger !== 'undefined') {
    AImateLogger.debug("Outbound API Gateway Request Payload", {
      prompt: payload.payload.prompt,
      context: payload.payload.context,
      instruction: payload.payload.instruction
    });
  }

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    headers: {
      [getConfiguredRequestIdHeader()]: requestMeta.request_id
    }
  };

  try {
    // NOTE: Because COMPANY_AI is a Custom Function (runs inside a cell),
    // it is blocked by Google from using your OAuth token!
    // It must connect directly to the public API Gateway.
    // options.headers = { "Authorization": `Bearer ${idToken}` };

    const response = UrlFetchApp.fetch(proxyUrl, options);
    if (response.getResponseCode() === 200) {
      const json = JSON.parse(response.getContentText());
      const responseMeta = extractAiResponseMeta(json);
      const responseText = extractAiResultText(json);

      // LLMOps Trace
      AImateLogger.info("[LLMOps Trace] Execution succeeded", {
        requestId: responseMeta.request_id || requestMeta.request_id,
        runId: responseMeta.run_id,
        latencyMs: responseMeta.latency_ms,
        modelInvoked: responseMeta.model_invoked,
        upstreamService: responseMeta.upstream_service
      });

      // ========================================================
      // 4. CLIENT-SIDE PII RE-HYDRATION
      // ========================================================
      const finalSafeAnswer = PrivacyEngine.rehydrate(responseText, mergedVault);
      return {
        text: finalSafeAnswer,
        meta: {
          request_id: responseMeta.request_id || requestMeta.request_id,
          idempotency_key: responseMeta.idempotency_key || requestMeta.idempotency_key,
          run_id: responseMeta.run_id || "",
          run_at: responseMeta.run_at || requestMeta.run_at,
          latency_ms: responseMeta.latency_ms,
          model_invoked: responseMeta.model_invoked || "",
          upstream_service: responseMeta.upstream_service || ""
        }
      };

    } else {
      let errorMessage = response.getContentText();
      let errorCode = "UPSTREAM_FAILURE";
      let guardrailReason = null;

      try {
        const errorJson = JSON.parse(errorMessage);
        if (errorJson && errorJson.error) {
          errorMessage = errorJson.error.message || errorMessage;
          errorCode = errorJson.error.code || errorCode;
          guardrailReason = errorJson.error.details?.guardrail || null;
        }
      } catch (e) {
        // Keep the raw response text when the upstream error is not JSON.
      }

      const prefix = guardrailReason ? "⚠️ Content blocked" : "❌ Proxy Error";
      const displayMessage = guardrailReason
        ? `${prefix}: ${guardrailReason}`
        : `${prefix}: ${errorMessage}`;

      return {
        text: displayMessage,
        meta: {
          request_id: requestMeta.request_id,
          idempotency_key: requestMeta.idempotency_key,
          run_at: requestMeta.run_at,
          error_code: errorCode,
          guardrail: guardrailReason
        }
      };
    }
  } catch (e) {
    return {
      text: "❌ Connection Failed: " + e.message,
      meta: {
        request_id: requestMeta.request_id,
        idempotency_key: requestMeta.idempotency_key,
        run_at: requestMeta.run_at
      }
    };
  }
}

/**
 * Backward-compatible string return for legacy custom-function callers.
 */
function callCorporateAiEngine(prompt, context, instruction, endpointConfig) {
  return callCorporateAiEngineV2(prompt, context, instruction, endpointConfig).text;
}

function updateSchemaMetadataFromGithub() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  const schemaVersion = getConfiguredContractVersion();
  const schemaUrl = getConfiguredContractSourceUrl();
  const schemaPath = getConfiguredContractSourcePath();

  try {
    Logger.log("Updating sheet metadata from generated contract config...");

    const existingMetadata = sheet.getDeveloperMetadata();
    for (let i = 0; i < existingMetadata.length; i++) {
      const key = existingMetadata[i].getKey();
      if (key === "schema_version" || key === "schema_url" || key === "schema_path") {
        existingMetadata[i].remove();
        Logger.log("Removed old metadata key: " + key);
      }
    }

    sheet.addDeveloperMetadata(
      "schema_version",
      schemaVersion,
      SpreadsheetApp.DeveloperMetadataVisibility.DOCUMENT
    );

    if (schemaUrl) {
      sheet.addDeveloperMetadata(
        "schema_url",
        schemaUrl,
        SpreadsheetApp.DeveloperMetadataVisibility.DOCUMENT
      );
    }

    if (schemaPath) {
      sheet.addDeveloperMetadata(
        "schema_path",
        schemaPath,
        SpreadsheetApp.DeveloperMetadataVisibility.DOCUMENT
      );
    }

    Logger.log("✅ Successfully updated Spreadsheet Metadata from contract config!");
    Logger.log("Schema version: " + schemaVersion);
    if (schemaUrl) {
      Logger.log("Schema URL: " + schemaUrl);
    }
    if (schemaPath) {
      Logger.log("Schema path: " + schemaPath);
    }
  } catch (error) {
    Logger.log("Error updating schema metadata: " + error.message);
    SpreadsheetApp.getUi().alert("Error: " + error.message);
  }
}
