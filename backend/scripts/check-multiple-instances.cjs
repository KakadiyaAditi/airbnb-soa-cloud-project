// Actual independent Node processes, coordinated only by the shared test database.
const { fork } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { Listing, Booking, BookedNight } = require('../src/models');
const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
(async () => {
  if (!require('../src/utils/databaseName')(config.mongoUri).endsWith('_loadtest'))
    throw new Error('Use only a dedicated *_loadtest database.');
  const children = [];
  let listing;
  try {
    await connectDB();
    listing = await Listing.create({
      ...require('./seedData')[0],
      title: 'LOADTEST independent-process consistency probe',
    });
    const bases = [];
    for (let i = 0; i < 2; i++) {
      const port = await freePort();
      bases.push(`http://127.0.0.1:${port}`);
      children.push(
        fork(path.join(__dirname, '../src/server.js'), [], {
          stdio: 'ignore',
          env: {
            ...process.env,
            NODE_ENV: 'production',
            MONGODB_URI: config.mongoUri,
            PORT: String(port),
            METRICS_ENABLED: 'false',
          },
        })
      );
    }
    for (const base of bases) {
      let ready = false;
      for (let n = 0; n < 60; n++) {
        try {
          if ((await fetch(`${base}/health`)).ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      assert.ok(ready, 'Child API did not start');
    }
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const body = JSON.stringify({
      listingId: String(listing._id),
      guestName: 'Process test',
      guestEmail: 'process@example.invalid',
      numberOfGuests: 1,
      checkInDate: day(90),
      checkOutDate: day(93),
    });
    const keys = Array.from({ length: 20 }, () => randomUUID());
    const responses = await Promise.all(
      keys.map(async (key, i) => {
        const response = await fetch(`${bases[i % 2]}/api/bookings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body,
        });
        return { status: response.status, body: await response.json(), index: i };
      })
    );
    assert.equal(responses.filter((r) => r.status === 201).length, 1);
    assert.equal(responses.filter((r) => r.status === 409).length, 19);
    assert.equal(await Booking.countDocuments({ listingId: listing._id }), 1);
    assert.equal(await BookedNight.countDocuments({ listingId: listing._id }), 3);
    const winner = responses.find((r) => r.status === 201);
    const replay = await fetch(`${bases[(winner.index + 1) % 2]}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keys[winner.index] },
      body,
    }).then((r) => r.json());
    assert.equal(replay.data._id, winner.body.data._id);
    // Terminate the creating process, then cancel/retrieve through the other process.
    children[winner.index % 2].kill();
    const survivor = bases[(winner.index + 1) % 2];
    const cancel = await fetch(`${survivor}/api/bookings/${winner.body.data._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingStatus: 'Cancelled' }),
    });
    assert.equal(cancel.status, 200);
    assert.equal(await BookedNight.countDocuments({ listingId: listing._id }), 0);
    console.log(
      JSON.stringify(
        {
          source: 'actual-two-node-processes-shared-mongodb',
          measuredAt: new Date().toISOString(),
          attempts: 20,
          created: 1,
          conflicts: 19,
          crossProcessReplay: true,
          creatorTerminationSurvived: true,
          cancellationReleasedNights: true,
        },
        null,
        2
      )
    );
  } finally {
    for (const child of children) if (!child.killed) child.kill();
    if (listing) {
      await Booking.deleteMany({ listingId: listing._id });
      await BookedNight.deleteMany({ listingId: listing._id });
      await Listing.deleteOne({ _id: listing._id });
    }
    await disconnectDB();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
