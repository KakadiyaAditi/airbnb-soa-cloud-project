const { randomUUID } = require('node:crypto');
const config = require('../config/env');
const names = {
  listings: 'Listing',
  search: 'Search',
  availability: 'Availability',
  bookings: 'Booking',
  admin: 'Management',
  health: 'Health',
};
module.exports = function metrics(req, res, next) {
  if (!config.metricsEnabled || ['/health', '/api/health'].includes(req.path)) return next();
  const start = performance.now();
  const service = names[req.path.split('/')[2] || req.path.slice(1)] || 'Other';
  const requestId = randomUUID();
  res.setHeader('X-Request-ID', requestId);
  res.once('finish', () => {
    const booking = service === 'Booking' && req.method === 'POST';
    const conflict = res.locals.errorCode === 'BOOKING_CONFLICT';
    const event = {
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'AirbnbSOA',
            Dimensions: [['Environment', 'Service']],
            Metrics: [
              { Name: 'DurationMs', Unit: 'Milliseconds' },
              { Name: 'RequestCount', Unit: 'Count' },
              ...[
                'Http5xxCount',
                'ClientErrorCount',
                ...(booking
                  ? ['BookingAttemptCount', 'BookingConflictCount', 'BookingFailureCount']
                  : []),
              ].map((Name) => ({ Name, Unit: 'Count' })),
            ],
          },
        ],
      },
      Environment: config.metricsEnvironment,
      Service: service,
      RequestId: requestId,
      Method: req.method,
      Status: res.statusCode,
      DurationMs: performance.now() - start,
      RequestCount: 1,
      Http5xxCount: Number(res.statusCode >= 500),
      ClientErrorCount: Number(res.statusCode >= 400 && res.statusCode < 500),
      BookingAttemptCount: Number(booking),
      BookingConflictCount: Number(booking && conflict),
      BookingFailureCount: Number(booking && res.statusCode >= 400 && !conflict),
    };
    console.log(JSON.stringify(event));
  });
  next();
};
