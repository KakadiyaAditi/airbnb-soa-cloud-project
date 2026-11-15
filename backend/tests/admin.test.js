const request = require('supertest');
const createApp = require('../src/app');
const config = require('../src/config/env');
const { BookedNight } = require('../src/models');
const { setupDB, clearDB, teardownDB, createListing, bookingBody, day } = require('./helpers');
const app = createApp();
const auth = () => `Bearer ${process.env.ADMIN_API_TOKEN}`;
let listing, booking;
beforeAll(setupDB);
afterAll(teardownDB);
beforeEach(async () => {
  await clearDB();
  listing = await createListing();
  booking = (await request(app).post('/api/bookings').send(bookingBody(listing._id))).body.data;
});
test('management list and status changes require authorization', async () => {
  expect((await request(app).get('/api/admin/bookings')).status).toBe(401);
  expect(
    (await request(app).get('/api/admin/bookings').set('Authorization', 'Bearer invalid')).status
  ).toBe(401);
  expect(
    (
      await request(app)
        .patch(`/api/admin/bookings/${booking._id}/status`)
        .send({ bookingStatus: 'Confirmed' })
    ).status
  ).toBe(401);
});
test('unconfigured management fails closed', async () => {
  const original = config.adminToken;
  config.adminToken = '';
  try {
    const res = await request(app).get('/api/admin/bookings').set('Authorization', auth());
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ADMIN_NOT_CONFIGURED');
  } finally {
    config.adminToken = original;
  }
});
test('manager sees actual guest requests with listing summary and pagination', async () => {
  const res = await request(app)
    .get('/api/admin/bookings?status=Pending&limit=1')
    .set('Authorization', auth());
  expect(res.status).toBe(200);
  expect(res.body.data[0]._id).toBe(booking._id);
  expect(res.body.data[0].listing.title).toBe('Test Loft');
  expect(res.body.meta.total).toBe(1);
});
test('confirmation is protected on the legacy route too', async () => {
  expect(
    (
      await request(app)
        .patch(`/api/bookings/${booking._id}/status`)
        .send({ bookingStatus: 'Confirmed' })
    ).status
  ).toBe(401);
});
test('manager accepts request and guest lookup reports Confirmed', async () => {
  const res = await request(app)
    .patch(`/api/admin/bookings/${booking._id}/status`)
    .set('Authorization', auth())
    .send({ bookingStatus: 'Confirmed' });
  expect(res.status).toBe(200);
  expect(res.body.data.bookingStatus).toBe('Confirmed');
  expect((await request(app).get(`/api/bookings/${booking._id}`)).body.data.bookingStatus).toBe(
    'Confirmed'
  );
});
test('manager decline releases reserved nights and cannot later be accepted', async () => {
  const res = await request(app)
    .patch(`/api/admin/bookings/${booking._id}/status`)
    .set('Authorization', auth())
    .send({ bookingStatus: 'Cancelled' });
  expect(res.status).toBe(200);
  expect(await BookedNight.countDocuments({ bookingId: booking._id })).toBe(0);
  expect(
    (
      await request(app)
        .patch(`/api/admin/bookings/${booking._id}/status`)
        .set('Authorization', auth())
        .send({ bookingStatus: 'Confirmed' })
    ).status
  ).toBe(409);
});
test('manager status filter and pagination remain accurate', async () => {
  await request(app)
    .post('/api/bookings')
    .send(bookingBody(listing._id, { checkInDate: day(20), checkOutDate: day(23) }));
  const res = await request(app)
    .get('/api/admin/bookings?limit=1&page=2')
    .set('Authorization', auth());
  expect(res.body.meta).toMatchObject({ total: 2, page: 2, totalPages: 2 });
  expect(res.body.data).toHaveLength(1);
  expect(
    (await request(app).get('/api/admin/bookings?status=Rejected').set('Authorization', auth()))
      .status
  ).toBe(400);
});
test('CORS accepts management authorization header preflights', async () => {
  const res = await request(app)
    .options('/api/admin/bookings')
    .set('Origin', 'http://localhost:5173')
    .set('Access-Control-Request-Method', 'GET')
    .set('Access-Control-Request-Headers', 'authorization');
  expect(res.status).toBe(204);
  expect(res.headers['access-control-allow-headers']).toContain('Authorization');
});
