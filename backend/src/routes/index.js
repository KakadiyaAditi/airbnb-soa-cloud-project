/**
 * API gateway-style router: each service gets its own URL prefix.
 * Express 5 forwards errors thrown in async handlers to the error handler.
 */
const express = require('express');
const listing = require('../controllers/listing.controller');
const search = require('../controllers/search.controller');
const availability = require('../controllers/availability.controller');
const booking = require('../controllers/booking.controller');
const requireAdmin = require('../middleware/requireAdmin');

const listingRouter = express.Router();
listingRouter.get('/', listing.getListings);
listingRouter.post('/', listing.createListing);
listingRouter.get('/:id', listing.getListingById);

const searchRouter = express.Router();
searchRouter.get('/', search.search);

const availabilityRouter = express.Router();
availabilityRouter.get('/', availability.checkAvailability);
availabilityRouter.get('/:listingId/bookings', availability.getActiveBookings);

const bookingRouter = express.Router();
bookingRouter.post('/', booking.createBooking);
bookingRouter.get('/:id', booking.getBookingById);
bookingRouter.patch(
  '/:id/status',
  (req, res, next) =>
    req.body?.bookingStatus === 'Confirmed' ? requireAdmin(req, res, next) : next(),
  booking.updateBookingStatus
);

const adminRouter = express.Router();
adminRouter.use(requireAdmin);
adminRouter.get('/bookings', booking.listBookings);
adminRouter.patch('/bookings/:id/status', booking.updateBookingStatus);

const apiRouter = express.Router();
apiRouter.use('/listings', listingRouter);
apiRouter.use('/search', searchRouter);
apiRouter.use('/availability', availabilityRouter);
apiRouter.use('/bookings', bookingRouter);
apiRouter.use('/admin', adminRouter);

module.exports = apiRouter;
