import { withPhotoAssets } from "./photos.js";

export class ApiError extends Error {
  constructor(status, error) {
    super(error?.message || "The request could not be completed.");
    this.status = status;
    this.code = error?.code;
    this.details = error?.details || [];
  }
}

// Preserve the existing frontend's _id convention while accepting
// the serverless API's listingId and bookingId fields.
function normalizeData(value) {
  if (Array.isArray(value)) return value.map(normalizeData);
  if (!value || typeof value !== "object") return value;

  const result = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizeData(item)]),
  );

  if (!result._id && result.bookingId) result._id = result.bookingId;
  else if (!result._id && result.listingId) result._id = result.listingId;

  return result;
}

export function createApi(
  base = "http://localhost:5000",
  fetcher = globalThis.fetch,
) {
  async function request(path, options = {}) {
    const timeout = AbortSignal.timeout(15000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;

    let response;
    try {
      response = await fetcher(`${base.replace(/\/$/, "")}${path}`, {
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
        signal,
      });

      const body = await response.json().catch((error) => {
        if (signal.aborted) throw error;
        return {};
      });

      if (!response.ok || !body.success) {
        const error = new ApiError(response.status, body.error);
        const seconds = Number(response.headers?.get("Retry-After"));
        error.retryAfterMs =
          Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
        throw error;
      }

      const meta = body.meta
        ? {
            ...body.meta,
            totalPages: body.meta.totalPages ?? body.meta.pages,
          }
        : body.meta;

      return {
        ...body,
        meta,
        data: withPhotoAssets(normalizeData(body.data)),
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (options.signal?.aborted) throw options.signal.reason;
      if (signal.aborted && signal.reason?.name === "TimeoutError")
        throw new ApiError(0, {
          code: "REQUEST_TIMEOUT",
          message:
            "The booking service took too long to respond. Please try again.",
        });
      if (error.name === "AbortError") throw error;
      throw new ApiError(0, {
        message:
          "We could not reach the booking service. Please try again shortly.",
      });
    }
  }

  const query = (params) =>
    new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== "" && v != null),
    ).toString();

  async function book(booking, key) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request("/api/bookings", {
          method: "POST",
          headers: key ? { "Idempotency-Key": key } : {},
          body: JSON.stringify(booking),
        });
      } catch (error) {
        if (
          !key ||
          attempt >= 2 ||
          ![0, 429, 502, 503, 504].includes(error.status) ||
          error.retryAfterMs > 3000
        )
          throw error;

        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.max(
              error.retryAfterMs || 0,
              200 * 2 ** attempt + Math.random() * 100,
            ),
          ),
        );
      }
    }
  }

  async function listing(id) {
    return request(`/api/listings/${encodeURIComponent(id)}`);
  }

  async function booking(id) {
    const result = await request(`/api/bookings/${encodeURIComponent(id)}`);
    const record = result.data;

    // The serverless booking response stores listingId, not a nested listing.
    if (record?.listingId && !record.listing) {
      const listingResult = await listing(record.listingId);
      record.listing = listingResult.data;
    }

    return result;
  }

  async function managerBookings(token, status = "Pending", page = 1) {
    const result = await request(
      `/api/admin/bookings?${query({ status, page, limit: 10 })}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    // The management UI displays listing details alongside each booking.
    result.data = await Promise.all(
      result.data.map(async (record) => {
        if (record.listingId && !record.listing) {
          const listingResult = await listing(record.listingId);
          record.listing = listingResult.data;
        }
        return record;
      }),
    );

    return result;
  }

  return {
    managerBookings,
    managerStatus: (token, id, bookingStatus) =>
      request(`/api/admin/bookings/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookingStatus }),
      }),
    listings: (page = 1, limit = 50, signal) =>
      request(`/api/listings?${query({ page, limit })}`, { signal }),
    createListing: (listingData) =>
      request("/api/listings", {
        method: "POST",
        body: JSON.stringify(listingData),
      }),
    search: (filters, signal) =>
      request(`/api/search?${query(filters)}`, { signal }),
    listing,
    ranges: (id) =>
      request(`/api/availability/${encodeURIComponent(id)}/bookings`),
    availability: (listingId, checkIn, checkOut) =>
      request(`/api/availability?${query({ listingId, checkIn, checkOut })}`),
    book,
    booking,
    cancel: (id) =>
      request(`/api/bookings/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ bookingStatus: "Cancelled" }),
      }),
  };
}
