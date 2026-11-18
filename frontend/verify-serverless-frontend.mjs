import { createApi } from "./src/api.js";

const api = createApi(
  "https://gv1cw6q1p2.execute-api.ap-south-1.amazonaws.com/dev"
);

const listingResult = await api.listing("seed-20-bondi-beach-house");
console.log("LISTING ID:", listingResult.data._id);
console.log("LISTING TITLE:", listingResult.data.title);

const bookingResult = await api.booking(
  "a03af129-6c72-4968-8065-ec841ac46f66"
);

console.log("BOOKING ID:", bookingResult.data._id);
console.log("BOOKING STATUS:", bookingResult.data.bookingStatus);
console.log("BOOKING LISTING:", bookingResult.data.listing?.title);
console.log("BOOKING CITY:", bookingResult.data.listing?.city);
