const { createHash, timingSafeEqual } = require('node:crypto');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');

function requireAdmin(req, res, next) {
  if (!config.adminToken || config.adminToken.length < 32) {
    return next(
      new ApiError(
        503,
        'ADMIN_NOT_CONFIGURED',
        'Booking management is not configured. Set a private ADMIN_API_TOKEN of at least 32 characters on the backend.'
      )
    );
  }
  const header = req.get('Authorization') || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  const hash = (value) => createHash('sha256').update(value).digest();
  if (
    !supplied ||
    supplied.length > 512 ||
    !timingSafeEqual(hash(supplied), hash(config.adminToken))
  ) {
    return next(
      new ApiError(401, 'UNAUTHORIZED', 'A valid booking-management access code is required.')
    );
  }
  next();
}

module.exports = requireAdmin;
