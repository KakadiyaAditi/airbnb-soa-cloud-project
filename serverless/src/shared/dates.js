"use strict";

const { AppError } = require("./http");

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_NIGHTS = 30;

function parseDate(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, "INVALID_DATE", `${fieldName} must use YYYY-MM-DD format.`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, "INVALID_DATE", `${fieldName} is not a valid calendar date.`);
  }

  return date;
}

function validateDateRange(checkIn, checkOut, options = {}) {
  const start = parseDate(checkIn, "checkIn");
  const end = parseDate(checkOut, "checkOut");

  if (end <= start) {
    throw new AppError(400, "INVALID_DATE_RANGE", "Check-out must be after check-in.");
  }

  const nights = Math.round((end - start) / DAY_MS);

  if (nights > MAX_NIGHTS) {
    throw new AppError(400, "STAY_TOO_LONG", `A stay cannot exceed ${MAX_NIGHTS} nights.`);
  }

  if (options.rejectPast !== false) {
    const today = new Date().toISOString().slice(0, 10);
    if (checkIn < today) {
      throw new AppError(400, "CHECK_IN_IN_PAST", "Check-in date cannot be in the past.");
    }
  }

  return { checkIn, checkOut, nights };
}

function eachNight(checkIn, checkOut) {
  const start = parseDate(checkIn, "checkIn");
  const end = parseDate(checkOut, "checkOut");

  if (end <= start) {
    throw new AppError(400, "INVALID_DATE_RANGE", "Check-out must be after check-in.");
  }

  const nights = Math.round((end - start) / DAY_MS);
  if (nights > MAX_NIGHTS) {
    throw new AppError(400, "STAY_TOO_LONG", `A stay cannot exceed ${MAX_NIGHTS} nights.`);
  }

  const result = [];
  for (let time = start.getTime(); time < end.getTime(); time += DAY_MS) {
    result.push(new Date(time).toISOString().slice(0, 10));
  }

  return result;
}

function intervalsOverlap(existingCheckIn, existingCheckOut, requestedCheckIn, requestedCheckOut) {
  return existingCheckIn < requestedCheckOut &&
    existingCheckOut > requestedCheckIn;
}

module.exports = {
  MAX_NIGHTS,
  parseDate,
  validateDateRange,
  eachNight,
  intervalsOverlap
};
