const request = require('supertest');
const config = require('../src/config/env');
const createApp = require('../src/app');
test('CloudWatch EMF records bounded dimensions, errors and duration without guest details or keys', async () => {
  config.metricsEnabled = true;
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const response = await request(createApp())
      .post('/api/bookings')
      .set('Idempotency-Key', 'secret-request-key')
      .send({ guestName: 'Private Name', guestEmail: 'private@example.invalid' });
    expect(response.status).toBe(400);
    const event = JSON.parse(log.mock.calls[0][0]);
    expect(event._aws.CloudWatchMetrics[0].Dimensions).toEqual([['Environment', 'Service']]);
    expect(event.Service).toBe('Booking');
    expect(event.BookingFailureCount).toBe(1);
    expect(event.RequestCount).toBe(1);
    expect(event.DurationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(event)).not.toMatch(/Private Name|private@example|secret-request-key/);
    expect(response.headers['x-request-id']).toBe(event.RequestId);
  } finally {
    config.metricsEnabled = false;
    log.mockRestore();
  }
});
