/**
 * BOOKING SERVICE
 * Creates and manages bookings. Before accepting a booking it:
 *   1. validates the request (validators/booking.validator.js),
 *   2. loads the listing through the Listing Service,
 *   3. checks guest capacity,
 *   4. asks the Availability Service for overlapping bookings,
 *   5. atomically reserves each night (unique index on BookedNight),
 *   6. stores the booking with a server-calculated price.
 *
 * Night locks, booking and idempotency replay response commit in one transaction.
 * Unique database indexes coordinate competing instances.
 */
const mongoose = require('mongoose');
const { Booking, BookedNight } = require('../../models');
const ApiError = require('../../utils/ApiError');
const { assertObjectId } = require('../../utils/validateObjectId');
const { eachNight, toDateString, todayUtc } = require('../../utils/dates');
const listingService = require('../listing/listing.service');
const availabilityService = require('../availability/availability.service');

function isDuplicateKeyError(err) {
  return (
    err &&
    (err.code === 11000 ||
      (Array.isArray(err.writeErrors) && err.writeErrors.some((e) => e.code === 11000)))
  );
}

function conflictError(conflicts = []) {
  return ApiError.conflict(
    'The listing is not available for the selected dates',
    conflicts.map((b) => ({
      checkInDate: toDateString(b.checkInDate),
      checkOutDate: toDateString(b.checkOutDate),
    }))
  );
}

/** Shape a booking document for API responses (dates as YYYY-MM-DD). */
function formatBooking(booking, listing) {
  const out = {
    _id: booking._id,
    listingId: booking.listingId,
    guestName: booking.guestName,
    guestEmail: booking.guestEmail,
    checkInDate: toDateString(booking.checkInDate),
    checkOutDate: toDateString(booking.checkOutDate),
    numberOfGuests: booking.numberOfGuests,
    numberOfNights: booking.numberOfNights,
    pricePerNight: booking.pricePerNight,
    totalPrice: booking.totalPrice,
    bookingStatus: booking.bookingStatus,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
  if (listing) {
    out.listing = {
      _id: listing._id,
      title: listing.title,
      city: listing.city,
      country: listing.country,
      imageUrls: listing.imageUrls,
    };
  }
  return out;
}

// The key is scoped to POST /api/bookings. No guest details enter the key index.
const { createHash } = require('node:crypto');
const transaction = require('../../utils/transaction');
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function replay(keyHash, fingerprint) {
  if (!keyHash) return null;
  const previous = await Booking.findOne({ idempotencyKeyHash: keyHash })
    .select('+idempotencyFingerprint +idempotencyResponse')
    .lean();
  if (!previous) return null;
  if (previous.idempotencyFingerprint !== fingerprint)
    throw new ApiError(
      409,
      'IDEMPOTENCY_MISMATCH',
      'This request key was already used for different booking details.'
    );
  return previous.idempotencyResponse;
}

async function createBooking(input, { idempotencyKey } = {}) {
  const { listingId, guestName, guestEmail, numberOfGuests, checkIn, checkOut, nights } = input;
  const keyHash = idempotencyKey ? hash(idempotencyKey) : undefined;
  const fingerprint = hash(
    JSON.stringify([
      listingId.toLowerCase(),
      guestName,
      guestEmail,
      numberOfGuests,
      toDateString(checkIn),
      toDateString(checkOut),
    ])
  );
  const previous = await replay(keyHash, fingerprint);
  if (previous) return previous;
  if (checkIn < todayUtc())
    throw ApiError.badRequest('Check-in cannot be in the past', [
      { field: 'checkInDate', message: 'Check-in cannot be in the past' },
    ]);
  try {
    const listing = await listingService.getListingById(listingId, 'listingId');
    if (
      !Number.isFinite(listing.pricePerNight) ||
      listing.pricePerNight < 1 ||
      !Number.isSafeInteger(Math.round(listing.pricePerNight * nights * 100))
    )
      throw new ApiError(
        409,
        'INVALID_LISTING_PRICE',
        'This listing has an invalid price. Please choose another stay.'
      );
    if (numberOfGuests > listing.maxGuests)
      throw new ApiError(
        400,
        'GUEST_CAPACITY_EXCEEDED',
        'The guest count exceeds this property capacity.',
        [{ field: 'numberOfGuests', message: 'Too many guests for this property' }]
      );
    const conflicts = await availabilityService.findOverlappingBookings(
      listingId,
      checkIn,
      checkOut
    );
    if (conflicts.length) throw conflictError(conflicts);
    return await transaction(async (session) => {
      const bookingId = new mongoose.Types.ObjectId();
      await BookedNight.insertMany(
        eachNight(checkIn, checkOut).map((night) => ({ listingId: listing._id, night, bookingId })),
        { ordered: true, session }
      );
      const [booking] = await Booking.create(
        [
          {
            _id: bookingId,
            listingId: listing._id,
            guestName,
            guestEmail,
            checkInDate: checkIn,
            checkOutDate: checkOut,
            numberOfGuests,
            numberOfNights: nights,
            pricePerNight: listing.pricePerNight,
            totalPrice: Math.round(listing.pricePerNight * nights * 100) / 100,
            bookingStatus: 'Pending',
            ...(keyHash
              ? { idempotencyKeyHash: keyHash, idempotencyFingerprint: fingerprint }
              : {}),
          },
        ],
        { session }
      );
      const response = formatBooking(booking, listing);
      if (keyHash)
        await Booking.updateOne(
          { _id: bookingId },
          { $set: { idempotencyResponse: response } },
          { session }
        );
      return response;
    });
  } catch (error) {
    // Another instance may have committed this same intent while we waited.
    if (keyHash) {
      const original = await replay(keyHash, fingerprint);
      if (original) return original;
    }
    if (isDuplicateKeyError(error)) throw conflictError();
    throw error;
  }
}

async function getBookingById(id) {
  assertObjectId(id, 'id');
  const booking = await Booking.findById(id).lean();
  if (!booking) throw ApiError.notFound(`Booking ${id} not found`);
  const listing = await listingService.getListingById(String(booking.listingId)).catch(() => null);
  return formatBooking(booking, listing);
}

// Which statuses each target status may be reached from.
const ALLOWED_FROM = {
  Confirmed: ['Pending'],
  Cancelled: ['Pending', 'Confirmed'],
};

/**
 * Change a booking's status. The status condition is part of the update
 * filter, so two simultaneous updates cannot both apply.
 */
async function updateBookingStatus(id, newStatus) {
  assertObjectId(id, 'id');
  const updated = await transaction(async (session) => {
    const current = await Booking.findById(id).session(session).lean();
    if (!current) throw ApiError.notFound(`Booking ${id} not found`);
    // Terminal cancellation is safe to repeat, including after a lost response.
    if (newStatus === 'Cancelled' && current.bookingStatus === 'Cancelled') {
      await BookedNight.deleteMany({ bookingId: current._id }, { session });
      return current;
    }
    if (!ALLOWED_FROM[newStatus]?.includes(current.bookingStatus))
      throw new ApiError(
        409,
        'INVALID_STATUS_TRANSITION',
        `Cannot change booking status from ${current.bookingStatus} to ${newStatus}`
      );
    const result = await Booking.findOneAndUpdate(
      { _id: id, bookingStatus: current.bookingStatus },
      { $set: { bookingStatus: newStatus } },
      { returnDocument: 'after', runValidators: true, session }
    ).lean();
    if (newStatus === 'Cancelled')
      await BookedNight.deleteMany({ bookingId: current._id }, { session });
    return result;
  });

  const listing = await listingService.getListingById(String(updated.listingId)).catch(() => null);
  return formatBooking(updated, listing);
}

async function listBookings({ status, page, limit, skip }) {
  const filter = status ? { bookingStatus: status } : {};
  const [bookings, total] = await Promise.all([
    Booking.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Booking.countDocuments(filter),
  ]);
  const listings = await Promise.all(
    [...new Set(bookings.map((b) => String(b.listingId)))].map(async (id) => [
      id,
      await listingService.getListingById(id).catch(() => null),
    ])
  );
  const byId = new Map(listings);
  return {
    items: bookings.map((b) => formatBooking(b, byId.get(String(b.listingId)))),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

module.exports = {
  createBooking,
  getBookingById,
  updateBookingStatus,
  formatBooking,
  listBookings,
};
