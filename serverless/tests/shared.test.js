"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AppError,
  success,
  created,
  errorResponse,
  parseJsonBody
} = require("../src/shared/http");

const {
  parseDate,
  validateDateRange,
  eachNight,
  intervalsOverlap
} = require("../src/shared/dates");

test("success response follows the existing API response contract", () => {
  const result = success([{ id: "1" }], { page: 1 });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), {
    success: true,
    data: [{ id: "1" }],
    meta: { page: 1 }
  });
});

test("created response uses HTTP 201", () => {
  const result = created({ id: "booking-1" });
  assert.equal(result.statusCode, 201);
  assert.equal(JSON.parse(result.body).success, true);
});

test("application errors return a safe structured error", () => {
  const result = errorResponse(new AppError(409, "CONFLICT", "Dates are unavailable."));
  assert.equal(result.statusCode, 409);
  assert.deepEqual(JSON.parse(result.body).error, {
    code: "CONFLICT",
    message: "Dates are unavailable."
  });
});

test("unexpected errors do not expose internal messages", () => {
  const result = errorResponse(new Error("private database details"));
  assert.equal(result.statusCode, 500);
  assert.equal(JSON.parse(result.body).error.message, "An unexpected error occurred.");
  assert.doesNotMatch(result.body, /private database details/);
});

test("JSON request bodies are parsed", () => {
  assert.deepEqual(parseJsonBody({ body: '{"guestName":"Alex"}' }), {
    guestName: "Alex"
  });
});

test("invalid JSON request bodies are rejected", () => {
  assert.throws(
    () => parseJsonBody({ body: "{invalid}" }),
    (error) => error instanceof AppError && error.code === "INVALID_JSON"
  );
});

test("calendar dates reject impossible dates", () => {
  assert.throws(
    () => parseDate("2026-02-30", "checkIn"),
    (error) => error.code === "INVALID_DATE"
  );
});

test("date ranges use exclusive checkout dates", () => {
  const range = validateDateRange("2026-12-10", "2026-12-13", { rejectPast: false });
  assert.equal(range.nights, 3);
  assert.deepEqual(
    eachNight("2026-12-10", "2026-12-13"),
    ["2026-12-10", "2026-12-11", "2026-12-12"]
  );
});

test("date ranges reject checkout before or equal to check-in", () => {
  assert.throws(
    () => validateDateRange("2026-12-13", "2026-12-13", { rejectPast: false }),
    (error) => error.code === "INVALID_DATE_RANGE"
  );
});

test("date ranges reject stays longer than 30 nights", () => {
  assert.throws(
    () => validateDateRange("2026-12-01", "2027-01-01", { rejectPast: false }),
    (error) => error.code === "STAY_TOO_LONG"
  );
});

test("overlap logic allows same-day checkout and check-in turnover", () => {
  assert.equal(
    intervalsOverlap("2026-12-10", "2026-12-13", "2026-12-13", "2026-12-15"),
    false
  );
  assert.equal(
    intervalsOverlap("2026-12-10", "2026-12-14", "2026-12-13", "2026-12-15"),
    true
  );
});
