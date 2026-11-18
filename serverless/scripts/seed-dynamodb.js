const crypto = require("node:crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand
} = require("@aws-sdk/lib-dynamodb");

const seedListings = require("../../backend/scripts/seedData");

const region = process.env.AWS_REGION || "ap-south-1";
const tableName = process.env.LISTINGS_TABLE;

if (!tableName) {
  console.error("Set LISTINGS_TABLE to the deployed DynamoDB listings table name.");
  process.exit(1);
}

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region })
);

function stableId(item, index) {
  const slug = item.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return `seed-${String(index + 1).padStart(2, "0")}-${slug}`;
}

async function main() {
  let count = 0;

  for (let i = 0; i < seedListings.length; i++) {
    const listing = seedListings[i];
    const now = new Date().toISOString();

    const item = {
      ...listing,
      listingId: stableId(listing, i),
      createdAt: now,
      updatedAt: now
    };

    await client.send(new PutCommand({
      TableName: tableName,
      Item: item
    }));

    count++;
    console.log(`Seeded ${count}/${seedListings.length}: ${item.title}`);
  }

  console.log(`Successfully seeded ${count} listings into ${tableName}.`);
}

main().catch(error => {
  console.error("DynamoDB seed failed:", error.name || "Error", error.message);
  process.exitCode = 1;
});
