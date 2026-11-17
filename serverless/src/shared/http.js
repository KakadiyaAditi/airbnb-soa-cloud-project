"use strict";

class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": process.env.CORS_ORIGIN || "*",
      "access-control-allow-headers": "content-type,authorization,idempotency-key",
      "access-control-allow-methods": "GET,POST,PATCH,OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

function success(data, meta) {
  const body = { success: true, data };
  if (meta !== undefined) body.meta = meta;
  return response(200, body);
}

function created(data) {
  return response(201, { success: true, data });
}

function failure(statusCode, code, message, details) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return response(statusCode, { success: false, error });
}

function errorResponse(error) {
  if (error instanceof AppError) {
    return failure(error.statusCode, error.code, error.message, error.details);
  }

  console.error("Unhandled serverless error:", error);
  return failure(500, "INTERNAL_ERROR", "An unexpected error occurred.");
}

function parseJsonBody(event) {
  if (!event || !event.body) {
    throw new AppError(400, "INVALID_BODY", "A JSON request body is required.");
  }

  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Body must be a JSON object.");
    }

    return parsed;
  } catch {
    throw new AppError(400, "INVALID_JSON", "The request body must be a valid JSON object.");
  }
}

module.exports = {
  AppError,
  response,
  success,
  created,
  failure,
  errorResponse,
  parseJsonBody
};
