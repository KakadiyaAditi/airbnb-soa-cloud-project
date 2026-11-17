"use strict";

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");

let documentClient;

const TABLES = Object.freeze({
  listings: process.env.LISTINGS_TABLE || "StayFinder-Listings",
  bookings: process.env.BOOKINGS_TABLE || "StayFinder-Bookings",
  reservations: process.env.RESERVATIONS_TABLE || "StayFinder-Reservations",
  idempotency: process.env.IDEMPOTENCY_TABLE || "StayFinder-Idempotency"
});

function getDocumentClient() {
  if (!documentClient) {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || "ap-south-1"
    });

    documentClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true
      }
    });
  }

  return documentClient;
}

function resetDocumentClientForTests() {
  documentClient = undefined;
}

function getTableName(name) {
  const table = TABLES[name];
  if (!table) {
    throw new Error(`Unknown DynamoDB table: ${name}`);
  }
  return table;
}

module.exports = {
  TABLES,
  getDocumentClient,
  getTableName,
  resetDocumentClientForTests
};
