const bookingService = require('../services/booking/booking.service');
const { validateCreateBooking, validateStatusUpdate } = require('../validators/booking.validator');
const { sendSuccess } = require('../utils/response');
const { getPagination } = require('../utils/pagination');
const ApiError = require('../utils/ApiError');

async function listBookings(req, res) {
  const status = req.query.status;
  if (status !== undefined && !['Pending', 'Confirmed', 'Cancelled'].includes(status))
    throw ApiError.badRequest('Invalid booking status filter');
  const { items, meta } = await bookingService.listBookings({
    status,
    ...getPagination(req.query),
  });
  sendSuccess(res, items, { meta });
}

async function createBooking(req, res) {
  const idempotencyKey = req.get('Idempotency-Key');
  if (idempotencyKey !== undefined && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey))
    throw ApiError.badRequest(
      'Idempotency-Key must contain 8–128 letters, digits, dots, colons, underscores or hyphens'
    );
  // A completed intent can be replayed after its dates have passed. New past-date
  // writes are still rejected by the service after checking the replay record.
  const input = validateCreateBooking(req.body, { allowPast: !!idempotencyKey });
  const booking = await bookingService.createBooking(input, { idempotencyKey });
  sendSuccess(res, booking, { status: 201 });
}

async function getBookingById(req, res) {
  const booking = await bookingService.getBookingById(req.params.id);
  sendSuccess(res, booking);
}

async function updateBookingStatus(req, res) {
  const status = validateStatusUpdate(req.body);
  const booking = await bookingService.updateBookingStatus(req.params.id, status);
  sendSuccess(res, booking);
}

module.exports = { createBooking, getBookingById, updateBookingStatus, listBookings };
