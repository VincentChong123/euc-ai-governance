/**
 * Structured Logging Engine for AImate.
 * Automatically formats logs as rich objects for Google Cloud Logging (Stackdriver).
 */
var AImateLogger = AImateLogger || {};

AImateLogger.info = function(message, data) {
  console.info(AImateLogger.format_("INFO", message, data));
};

AImateLogger.warn = function(message, data) {
  console.warn(AImateLogger.format_("WARN", message, data));
};

AImateLogger.error = function(message, data) {
  console.error(AImateLogger.format_("ERROR", message, data));
};

AImateLogger.debug = function(message, data) {
  if (!AImateLogger.isDebugEnabled_()) return;
  console.log(AImateLogger.format_("DEBUG", message, data));
};

AImateLogger.isDebugEnabled_ = function() {
  return typeof CONFIG !== "undefined" &&
         typeof CONFIG.LOG_LEVEL === "string" &&
         CONFIG.LOG_LEVEL.toLowerCase() === "debug";
};

/**
 * Normalizes and redacts sensitive data properties recursively.
 */
AImateLogger.redact_ = function(data) {
  if (!data) return null;
  try {
    const copy = JSON.parse(JSON.stringify(data));
    const sensitiveKeys = ["password", "token", "auth_token", "oauth_token", "secret", "api_key", "key"];

    const redactObject = (obj) => {
      for (const k in obj) {
        if (obj.hasOwnProperty(k)) {
          if (sensitiveKeys.includes(k.toLowerCase())) {
            obj[k] = "[REDACTED]";
          } else if (typeof obj[k] === "object" && obj[k] !== null) {
            redactObject(obj[k]);
          }
        }
      }
    };

    redactObject(copy);
    return copy;
  } catch (e) {
    return { _redactError: e.message };
  }
};

AImateLogger.format_ = function(level, message, data) {
  // Redact any credentials or keys before logging
  const safeData = AImateLogger.redact_(data);

  return {
    app: "AImate",
    level: level,
    message: message,
    data: safeData,
    ts: new Date().toISOString()
  };
};
