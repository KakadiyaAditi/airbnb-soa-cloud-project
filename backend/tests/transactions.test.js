const request = require('supertest');
const { MongoClient } = require('mongodb');
const app = require('../src/app')();
const { Listing, Booking, BookedNight } = require('../src/models');
const { setupDB, clearDB, teardownDB, createListing, bookingBody, day } = require('./helpers');
beforeAll(setupDB);
beforeEach(clearDB);
afterEach(() => jest.restoreAllMocks());
afterAll(teardownDB);
const book = (body, key) =>
  request(app).post('/api/bookings').set('Idempotency-Key', key).send(body);

test('concurrent identical keys replay one booking and one set of night locks', async () => {
  const listing = await createListing();
  const body = bookingBody(listing._id);
  const results = await Promise.all(
    Array.from({ length: 10 }, () => book(body, 'same-intent-key-0001'))
  );
  expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
  expect(new Set(results.map((r) => r.body.data._id)).size).toBe(1);
  expect(await Booking.countDocuments()).toBe(1);
  expect(await BookedNight.countDocuments()).toBe(3);
});

test('key mismatch is rejected and replay remains original after cancellation', async () => {
  const listing = await createListing();
  const body = bookingBody(listing._id),
    key = 'stable-intent-key-0002';
  const first = await book(body, key);
  expect((await book({ ...body, guestName: 'Someone Else' }, key)).body.error.code).toBe(
    'IDEMPOTENCY_MISMATCH'
  );
  await request(app)
    .patch(`/api/bookings/${first.body.data._id}/status`)
    .send({ bookingStatus: 'Cancelled' });
  const replay = await book(body, key);
  expect(replay.body).toEqual(first.body);
  expect(
    (await request(app).get(`/api/bookings/${first.body.data._id}`)).body.data.bookingStatus
  ).toBe('Cancelled');
});

test('booking insert failure rolls back all previously inserted nights and permits safe retry', async () => {
  const listing = await createListing();
  const body = bookingBody(listing._id);
  jest.spyOn(Booking, 'create').mockRejectedValueOnce(new Error('injected insert failure'));
  expect((await book(body, 'retry-after-failure-0003')).status).toBe(500);
  expect(await BookedNight.countDocuments()).toBe(0);
  expect(await Booking.countDocuments()).toBe(0);
  expect((await book(body, 'retry-after-failure-0003')).status).toBe(201);
});

test('failed cancellation rolls back status; retry and repeated cancellation safely release nights', async () => {
  const listing = await createListing();
  const first = await book(bookingBody(listing._id), 'cancellation-key-0004');
  const id = first.body.data._id;
  jest
    .spyOn(BookedNight, 'deleteMany')
    .mockRejectedValueOnce(new Error('injected release failure'));
  const cancel = () =>
    request(app).patch(`/api/bookings/${id}/status`).send({ bookingStatus: 'Cancelled' });
  expect((await cancel()).status).toBe(500);
  expect((await Booking.findById(id)).bookingStatus).toBe('Pending');
  expect(await BookedNight.countDocuments()).toBe(3);
  expect((await cancel()).status).toBe(200);
  expect((await cancel()).status).toBe(200);
  expect(await BookedNight.countDocuments()).toBe(0);
});

test('two independent app instances share database conflict safeguards', async () => {
  const listing = await createListing();
  const body = bookingBody(listing._id);
  const otherApp = require('../src/app')();
  const results = await Promise.all([
    request(app).post('/api/bookings').send(body),
    request(otherApp)
      .post('/api/bookings')
      .send({ ...body, checkInDate: day(11), checkOutDate: day(14) }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(await Booking.countDocuments()).toBe(1);
});

test('a second database client sees no uncommitted reservations', async () => {
  const listing = await createListing();
  const mongoose = require('mongoose');
  const session = await mongoose.startSession();
  const other = new MongoClient(process.env.MONGODB_URI_TEST);
  await other.connect();
  try {
    session.startTransaction();
    await BookedNight.create(
      [{ listingId: listing._id, night: day(10), bookingId: new mongoose.Types.ObjectId() }],
      { session }
    );
    expect(await other.db().collection('bookednights').countDocuments()).toBe(0);
    await session.abortTransaction();
  } finally {
    await session.endSession();
    await other.close();
  }
});

test.each(['short', 'invalid key with spaces'])(
  'invalid request key is rejected: %s',
  async (key) => {
    const listing = await createListing();
    expect((await book(bookingBody(listing._id), key)).status).toBe(400);
    expect(await Booking.countDocuments()).toBe(0);
  }
);

test('late replay remains valid, while a new key cannot create a past booking', async () => {
  const listing = await createListing();
  const { createHash } = require('node:crypto');
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const body = bookingBody(listing._id, { checkInDate: day(-10), checkOutDate: day(-7) });
  const key = 'replay-over-day-boundary';
  const record = await Booking.create({
    listingId: listing._id,
    guestName: body.guestName,
    guestEmail: body.guestEmail,
    checkInDate: body.checkInDate,
    checkOutDate: body.checkOutDate,
    numberOfGuests: body.numberOfGuests,
    numberOfNights: 3,
    pricePerNight: 100,
    totalPrice: 300,
    bookingStatus: 'Cancelled',
    idempotencyKeyHash: hash(key),
    idempotencyFingerprint: hash(
      JSON.stringify([
        String(listing._id),
        body.guestName,
        body.guestEmail,
        body.numberOfGuests,
        body.checkInDate,
        body.checkOutDate,
      ])
    ),
  });
  const response = require('../src/services/booking/booking.service').formatBooking(
    record,
    listing
  );
  response.bookingStatus = 'Pending';
  await Booking.updateOne({ _id: record._id }, { $set: { idempotencyResponse: response } });
  const replayed = await book(body, key);
  expect(replayed.status).toBe(201);
  expect(replayed.body.data._id).toBe(String(record._id));
  expect((await book(body, 'new-key-after-date-passed')).status).toBe(400);
});
