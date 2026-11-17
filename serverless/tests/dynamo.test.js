"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TABLES,
  getTableName,
  getDocumentClient,
  resetDocumentClientForTests
} = require("../src/shared/dynamo");

test("all four DynamoDB tables have independent configured names", () => {
  assert.equal(TABLES.listings, process.env.LISTINGS_TABLE || "StayFinder-Listings");
  assert.equal(TABLES.bookings, process.env.BOOKINGS_TABLE || "StayFinder-Bookings");
  assert.equal(TABLES.reservations, process.env.RESERVATIONS_TABLE || "StayFinder-Reservations");
  assert.equal(TABLES.idempotency, process.env.IDEMPOTENCY_TABLE || "StayFinder-Idempotency");
  assert.equal(new Set(Object.values(TABLES)).size, 4);
});

test("table lookup returns the configured table name", () => {
  assert.equal(getTableName("listings"), TABLES.listings);
  assert.equal(getTableName("reservations"), TABLES.reservations);
});

test("unknown table names are rejected", () => {
  assert.throws(() => getTableName("unknown"), /Unknown DynamoDB table/);
});

test("DynamoDB document client is initialized lazily and reused", () => {
  resetDocumentClientForTests();

  const first = getDocumentClient();
  const second = getDocumentClient();

  assert.ok(first);
  assert.equal(first, second);

  resetDocumentClientForTests();
});
