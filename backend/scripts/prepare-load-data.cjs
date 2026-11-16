// Destructive reset is allowed ONLY in a dedicated *_loadtest database.
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { Listing, Booking, BookedNight } = require('../src/models');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
(async () => {
  const database = require('../src/utils/databaseName')(config.mongoUri);
  if (process.env.ALLOW_LOAD_TEST_DATA !== 'true' || !database.endsWith('_loadtest'))
    throw new Error(
      'Refusing to reset data: explicitly set ALLOW_LOAD_TEST_DATA=true and use a separate *_loadtest database.'
    );
  await connectDB();
  await Booking.deleteMany({});
  await BookedNight.deleteMany({});
  await Listing.deleteMany({});
  const inventory = require('./seedData').map((item) => ({
    ...item,
    title: `LOADTEST ${item.title}`,
  }));
  const listings = await Listing.insertMany(inventory);
  const fixture = {
    runId: randomUUID(),
    contract: 1,
    preparedAt: new Date().toISOString(),
    bookingIds: listings.map((item) => String(item._id)),
  };
  fs.writeFileSync(process.argv[2] || '/tmp/load-fixtures.json', JSON.stringify(fixture, null, 2));
  console.log(
    `Prepared ${listings.length} synthetic properties in dedicated load-test database; fixture contains no credentials.`
  );
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(disconnectDB);
