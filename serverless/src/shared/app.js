const crypto = require("node:crypto");
const {
  DynamoDBClient
} = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand
} = require("@aws-sdk/lib-dynamodb");

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-south-1"
}));

const T = {
  listings: process.env.LISTINGS_TABLE,
  bookings: process.env.BOOKINGS_TABLE,
  reservations: process.env.RESERVATIONS_TABLE,
  idempotency: process.env.IDEMPOTENCY_TABLE
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const reply = (statusCode, payload) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,authorization,idempotency-key",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS"
  },
  body: JSON.stringify(payload)
});

const ok = (data, meta) =>
  reply(200, { success: true, data, ...(meta ? { meta } : {}) });

const created = data => reply(201, { success: true, data });

const fail = (status, code, message) =>
  reply(status, { success: false, error: { code, message } });

function readBody(event) {
  try {
    const raw = event.body
      ? (event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body)
      : "{}";
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("JSON body must be an object");
    }
    return value;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function query(event) {
  return event.queryStringParameters || {};
}

function path(event) {
  const raw = event.rawPath || event.path || "/";
  const stage = event.requestContext?.stage;

  if (stage && stage !== "$default") {
    const prefix = `/${stage}`;
    if (raw === prefix) return "/";
    if (raw.startsWith(`${prefix}/`)) return raw.slice(prefix.length);
  }

  return raw;
}

function method(event) {
  return event.requestContext?.http?.method || event.httpMethod || "GET";
}

function dateOnly(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "INVALID_DATE", `${name} must use YYYY-MM-DD.`);
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, "INVALID_DATE", `${name} is not a valid calendar date.`);
  }
  return value;
}

function dateRange(checkIn, checkOut) {
  const start = dateOnly(checkIn, "checkIn");
  const end = dateOnly(checkOut, "checkOut");
  const today = new Date().toISOString().slice(0, 10);
  if (start < today) {
    throw new HttpError(400, "PAST_DATE", "Check-in date cannot be in the past.");
  }
  const nights = (Date.parse(end) - Date.parse(start)) / 86400000;
  if (nights < 1 || nights > 30) {
    throw new HttpError(400, "INVALID_DATE_RANGE", "A booking must be between 1 and 30 nights.");
  }
  const dates = [];
  for (let i = 0; i < nights; i++) {
    dates.push(new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10));
  }
  return { start, end, nights, dates };
}

async function getListing(id) {
  const result = await doc.send(new GetCommand({
    TableName: T.listings,
    Key: { listingId: id }
  }));
  return result.Item;
}

async function allListings() {
  const result = await doc.send(new ScanCommand({ TableName: T.listings }));
  return result.Items || [];
}

async function reservationsForNight(listingId, night) {
  const result = await doc.send(new QueryCommand({
    TableName: T.reservations,
    KeyConditionExpression: "listingId = :id AND #night = :night",
    ExpressionAttributeNames: { "#night": "night" },
    ExpressionAttributeValues: { ":id": listingId, ":night": night },
    Limit: 1
  }));
  return result.Items || [];
}

async function unavailable(listingId, dates) {
  for (const night of dates) {
    if ((await reservationsForNight(listingId, night)).length) return true;
  }
  return false;
}

function cleanListing(input) {
  const required = ["title", "description", "location", "pricePerNight", "maxGuests"];
  for (const key of required) {
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      throw new HttpError(400, "VALIDATION_ERROR", `${key} is required.`);
    }
  }
  const price = Number(input.pricePerNight);
  const guests = Number(input.maxGuests);
  if (!Number.isFinite(price) || price < 1 || !Number.isInteger(guests) || guests < 1 || guests > 20) {
    throw new HttpError(400, "VALIDATION_ERROR", "Price or guest capacity is invalid.");
  }
  return {
    title: String(input.title).trim().slice(0, 120),
    description: String(input.description).trim().slice(0, 2000),
    propertyType: input.propertyType || "Apartment",
    location: String(input.location).trim().slice(0, 120),
    city: input.city || "",
    state: input.state || "",
    country: input.country || "",
    pricePerNight: price,
    maxGuests: guests,
    bedrooms: Number(input.bedrooms || 0),
    bathrooms: Number(input.bathrooms || 0),
    amenities: Array.isArray(input.amenities) ? input.amenities : [],
    imageUrls: Array.isArray(input.imageUrls) ? input.imageUrls : [],
    rating: Number(input.rating || 0)
  };
}

async function listingService(event, p, m) {
  if (p === "/api/health" && m === "GET") {
    return ok({ status: "ok", service: "StayFinder serverless API", database: "DynamoDB" });
  }

  if (p === "/api/listings" && m === "GET") {
    const items = (await allListings()).sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );
    const q = query(event);
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const total = items.length;
    return ok(items.slice((page - 1) * limit, page * limit), {
      page, limit, total, pages: Math.ceil(total / limit)
    });
  }

  if (p === "/api/listings" && m === "POST") {
    const data = cleanListing(readBody(event));
    const item = {
      ...data,
      listingId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await doc.send(new PutCommand({
      TableName: T.listings,
      Item: item,
      ConditionExpression: "attribute_not_exists(listingId)"
    }));
    return created(item);
  }

  const match = p.match(/^\/api\/listings\/([^/]+)$/);
  if (match && m === "GET") {
    const item = await getListing(decodeURIComponent(match[1]));
    if (!item) throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
    return ok(item);
  }

  throw new HttpError(404, "NOT_FOUND", "Listing route was not found.");
}

async function searchService(event) {
  const q = query(event);
  let items = await allListings();

  if (q.city) items = items.filter(x => (x.city || "").toLowerCase() === q.city.toLowerCase());
  if (q.country) items = items.filter(x => (x.country || "").toLowerCase() === q.country.toLowerCase());
  if (q.location) {
    const term = q.location.toLowerCase();
    items = items.filter(x =>
      [x.location, x.city, x.state, x.country].some(v => String(v || "").toLowerCase().includes(term))
    );
  }
  if (q.propertyType) items = items.filter(x => x.propertyType === q.propertyType);
  if (q.minPrice) items = items.filter(x => x.pricePerNight >= Number(q.minPrice));
  if (q.maxPrice) items = items.filter(x => x.pricePerNight <= Number(q.maxPrice));
  if (q.guests) items = items.filter(x => x.maxGuests >= Number(q.guests));

  if (q.amenities) {
    const wanted = q.amenities.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
    items = items.filter(x => wanted.every(a =>
      (x.amenities || []).some(v => String(v).toLowerCase() === a)
    ));
  }

  if (q.checkIn || q.checkOut) {
    if (!q.checkIn || !q.checkOut) {
      throw new HttpError(400, "INVALID_DATE_RANGE", "Both checkIn and checkOut are required.");
    }
    const range = dateRange(q.checkIn, q.checkOut);
    const filtered = [];
    for (const item of items) {
      if (!(await unavailable(item.listingId, range.dates))) filtered.push(item);
    }
    items = filtered;
  }

  const sorts = {
    price_asc: (a, b) => a.pricePerNight - b.pricePerNight,
    price_desc: (a, b) => b.pricePerNight - a.pricePerNight,
    rating_desc: (a, b) => (b.rating || 0) - (a.rating || 0)
  };
  if (sorts[q.sort]) items.sort(sorts[q.sort]);
  else items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(q.limit) || 10));
  const total = items.length;
  return ok(items.slice((page - 1) * limit, page * limit), {
    page, limit, total, pages: Math.ceil(total / limit)
  });
}

async function availabilityService(event, p, m) {
  if (p === "/api/availability" && m === "GET") {
    const q = query(event);
    if (!q.listingId) throw new HttpError(400, "VALIDATION_ERROR", "listingId is required.");
    const range = dateRange(q.checkIn, q.checkOut);
    const listing = await getListing(q.listingId);
    if (!listing) throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
    const isAvailable = !(await unavailable(q.listingId, range.dates));
    return ok({
      listingId: q.listingId,
      checkIn: range.start,
      checkOut: range.end,
      available: isAvailable
    });
  }

  const match = p.match(/^\/api\/availability\/([^/]+)\/bookings$/);
  if (match && m === "GET") {
    const listingId = decodeURIComponent(match[1]);
    const result = await doc.send(new QueryCommand({
      TableName: T.reservations,
      KeyConditionExpression: "listingId = :id",
      ExpressionAttributeValues: { ":id": listingId }
    }));
    const byBooking = new Map();
    for (const r of result.Items || []) {
      if (!byBooking.has(r.bookingId)) {
        byBooking.set(r.bookingId, { checkIn: r.checkInDate, checkOut: r.checkOutDate });
      }
    }
    return ok([...byBooking.values()]);
  }

  throw new HttpError(404, "NOT_FOUND", "Availability route was not found.");
}

function adminAuthorized(event) {
  const expected = process.env.ADMIN_API_TOKEN || "";
  const supplied = (event.headers?.authorization || event.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
  if (expected.length < 32) {
    throw new HttpError(503, "ADMIN_NOT_CONFIGURED", "Admin API is not configured.");
  }
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(supplied).digest();
  if (!supplied || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, "UNAUTHORIZED", "A valid admin token is required.");
  }
}

async function bookingService(event, p, m) {
  if (p === "/api/bookings" && m === "POST") {
    const input = readBody(event);
    const listingId = String(input.listingId || "");
    const guestName = String(input.guestName || "").trim();
    const guestEmail = String(input.guestEmail || "").trim().toLowerCase();
    const guests = Number(input.numberOfGuests);
    if (!listingId || guestName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail) ||
        !Number.isInteger(guests) || guests < 1) {
      throw new HttpError(400, "VALIDATION_ERROR", "Booking details are invalid.");
    }
    const range = dateRange(input.checkInDate || input.checkIn, input.checkOutDate || input.checkOut);
    const listing = await getListing(listingId);
    if (!listing) throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
    if (guests > listing.maxGuests) {
      throw new HttpError(400, "GUEST_LIMIT_EXCEEDED", "Guest count exceeds listing capacity.");
    }

    const idemKey = event.headers?.["idempotency-key"] || event.headers?.["Idempotency-Key"];
    if (!idemKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idemKey)) {
      throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.");
    }

    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
      listingId, guestName, guestEmail, guests, checkIn: range.start, checkOut: range.end
    })).digest("hex");
    const keyHash = crypto.createHash("sha256").update(idemKey).digest("hex");

    const previous = await doc.send(new GetCommand({
      TableName: T.idempotency, Key: { keyHash }, ConsistentRead: true
    }));
    if (previous.Item) {
      if (previous.Item.fingerprint !== fingerprint) {
        throw new HttpError(409, "IDEMPOTENCY_CONFLICT", "This idempotency key was used for a different request.");
      }
      return created(previous.Item.response);
    }

    if (await unavailable(listingId, range.dates)) {
      throw new HttpError(409, "DATES_UNAVAILABLE", "The listing is not available for the selected dates.");
    }

    const now = new Date().toISOString();
    const booking = {
      bookingId: crypto.randomUUID(),
      listingId,
      guestName,
      guestEmail,
      checkInDate: range.start,
      checkOutDate: range.end,
      numberOfGuests: guests,
      numberOfNights: range.nights,
      pricePerNight: listing.pricePerNight,
      totalPrice: listing.pricePerNight * range.nights,
      bookingStatus: "Pending",
      createdAt: now,
      updatedAt: now
    };

    const actions = range.dates.map(night => ({
      Put: {
        TableName: T.reservations,
        Item: {
          listingId, night, bookingId: booking.bookingId,
          checkInDate: range.start, checkOutDate: range.end
        },
        ConditionExpression: "attribute_not_exists(listingId) AND attribute_not_exists(#night)",
        ExpressionAttributeNames: { "#night": "night" }
      }
    }));
    actions.push({
      Put: {
        TableName: T.bookings,
        Item: booking,
        ConditionExpression: "attribute_not_exists(bookingId)"
      }
    });
    actions.push({
      Put: {
        TableName: T.idempotency,
        Item: {
          keyHash, fingerprint, response: booking,
          expiresAt: Math.floor(Date.now() / 1000) + 86400
        },
        ConditionExpression: "attribute_not_exists(keyHash)"
      }
    });

    try {
      await doc.send(new TransactWriteCommand({ TransactItems: actions }));
      return created(booking);
    } catch (err) {
      const replay = await doc.send(new GetCommand({
        TableName: T.idempotency, Key: { keyHash }, ConsistentRead: true
      }));
      if (replay.Item) {
        if (replay.Item.fingerprint !== fingerprint) {
          throw new HttpError(409, "IDEMPOTENCY_CONFLICT", "This idempotency key was used for a different request.");
        }
        return created(replay.Item.response);
      }
      if (err.name === "TransactionCanceledException") {
        throw new HttpError(409, "DATES_UNAVAILABLE", "The selected dates were just booked by another guest.");
      }
      throw err;
    }
  }

  const adminList = p === "/api/admin/bookings" && m === "GET";
  const adminStatus = /^\/api\/admin\/bookings\/([^/]+)\/status$/.exec(p);
  const publicStatus = /^\/api\/bookings\/([^/]+)\/status$/.exec(p);
  if (adminList || adminStatus) adminAuthorized(event);

  if (adminList) {
    const result = await doc.send(new ScanCommand({ TableName: T.bookings }));
    let items = result.Items || [];
    const q = query(event);
    if (q.status) items = items.filter(x => x.bookingStatus === q.status);
    items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 10));
    const total = items.length;
    return ok(items.slice((page - 1) * limit, page * limit), {
      page, limit, total, pages: Math.ceil(total / limit)
    });
  }

  if (adminStatus || publicStatus) {
    const id = decodeURIComponent((adminStatus || publicStatus)[1]);
    const input = readBody(event);
    const status = input.bookingStatus;
    if (!["Confirmed", "Cancelled"].includes(status)) {
      throw new HttpError(400, "INVALID_STATUS", "Status must be Confirmed or Cancelled.");
    }
    const found = await doc.send(new GetCommand({
      TableName: T.bookings, Key: { bookingId: id }
    }));
    if (!found.Item) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking was not found.");
    const booking = found.Item;
    if (booking.bookingStatus === "Cancelled") return ok(booking);
    if (status === "Confirmed" && booking.bookingStatus !== "Pending") {
      throw new HttpError(409, "INVALID_TRANSITION", "Only pending bookings can be confirmed.");
    }

    if (status === "Cancelled") {
      const reservations = await doc.send(new QueryCommand({
        TableName: T.reservations,
        IndexName: "BookingIdIndex",
        KeyConditionExpression: "bookingId = :id",
        ExpressionAttributeValues: { ":id": id }
      }));
      const actions = (reservations.Items || []).map(r => ({
        Delete: { TableName: T.reservations, Key: { listingId: r.listingId, night: r.night } }
      }));
      actions.push({
        Update: {
          TableName: T.bookings,
          Key: { bookingId: id },
          UpdateExpression: "SET bookingStatus = :status, updatedAt = :now",
          ConditionExpression: "bookingStatus IN (:pending, :confirmed)",
          ExpressionAttributeValues: {
            ":status": "Cancelled", ":now": new Date().toISOString(),
            ":pending": "Pending", ":confirmed": "Confirmed"
          }
        }
      });
      await doc.send(new TransactWriteCommand({ TransactItems: actions }));
    } else {
      await doc.send(new UpdateCommand({
        TableName: T.bookings,
        Key: { bookingId: id },
        UpdateExpression: "SET bookingStatus = :status, updatedAt = :now",
        ConditionExpression: "bookingStatus = :pending",
        ExpressionAttributeValues: {
          ":status": "Confirmed", ":pending": "Pending", ":now": new Date().toISOString()
        }
      }));
    }

    return ok({
      ...booking,
      bookingStatus: status,
      updatedAt: new Date().toISOString()
    });
  }

  const idMatch = p.match(/^\/api\/bookings\/([^/]+)$/);
  if (idMatch && m === "GET") {
    const result = await doc.send(new GetCommand({
      TableName: T.bookings,
      Key: { bookingId: decodeURIComponent(idMatch[1]) }
    }));
    if (!result.Item) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking was not found.");
    return ok(result.Item);
  }

  throw new HttpError(404, "NOT_FOUND", "Booking route was not found.");
}

exports.handler = async event => {
  try {
    if (method(event) === "OPTIONS") return reply(204, {});
    const p = path(event);
    const m = method(event);
    const service = process.env.SERVICE_NAME;

    if (service === "listings") return await listingService(event, p, m);
    if (service === "search" && p === "/api/search" && m === "GET") return await searchService(event);
    if (service === "availability") return await availabilityService(event, p, m);
    if (service === "bookings") return await bookingService(event, p, m);

    throw new HttpError(404, "NOT_FOUND", "Route was not found.");
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.code, err.message);
    console.error("Unhandled serverless error:", err);
    return fail(500, "INTERNAL_ERROR", "An unexpected server error occurred.");
  }
};
