const request = require('supertest');
const createApp = require('../src/app');
const { setupDB, clearDB, teardownDB, baseListing, bookingBody } = require('./helpers');
const { Listing, Booking, BookedNight } = require('../src/models');
const app = createApp();
beforeAll(setupDB);
beforeEach(clearDB);
afterAll(teardownDB);

test.each(['pricePerNight', 'bedrooms', 'bathrooms'])(
  'rejects overflowing %s without persisting corrupt numeric data',
  async (field) => {
    const res = await request(app)
      .post('/api/listings')
      .send({ ...baseListing, [field]: '1e309' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((detail) => detail.field === field)).toBe(true);
    expect(await Listing.countDocuments()).toBe(0);
  }
);

test('rejects nightly prices whose 30-night total would exceed safe monetary arithmetic', async () => {
  const res = await request(app)
    .post('/api/listings')
    .send({ ...baseListing, pricePerNight: 1e307 });
  expect(res.status).toBe(400);
  expect(await Listing.countDocuments()).toBe(0);
});

test('a legacy corrupt price cannot create a null booking total or reserve nights', async () => {
  const listing = await Listing.create(baseListing);
  await Listing.collection.updateOne({ _id: listing._id }, { $set: { pricePerNight: Infinity } });
  const res = await request(app).post('/api/bookings').send(bookingBody(listing._id));
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('INVALID_LISTING_PRICE');
  expect(await Booking.countDocuments()).toBe(0);
  expect(await BookedNight.countDocuments()).toBe(0);
});
