# Airbnb - integrated frontend and backend

Responsive Airbnb-inspired accommodation search and booking interface, compatible with Member 1's Listing, Search, Availability, and Booking APIs.

Features include saved stays, side-by-side comparison, amenity filters, reserved-date calendar, photo viewer, live booking estimates, and printable/calendar itineraries.

The latest tested combined project is on `main` and `integration/frontend-backend`, containing both `backend/` and `frontend/`. `feature/member2-frontend` contains the matching frontend only. Member 1's original branch is unchanged; the combined API extends its services with protected booking management while retaining guest booking and cancellation workflows. See the detailed verification record in [backend/docs/TESTING.md](backend/docs/TESTING.md).

## Search and booking management

Typing a recognised city (for example Paris) in the top search and pressing Search stays automatically selects its country (France) in the results filters. City, country and area resolution uses current API inventory, including newly published stays. Choose a `City, Country` suggestion for ambiguous city names. Unknown places show normal search results or an empty state without inventing a country.

New requests are Pending and reserve their nights. Open the footer's **Manage bookings** link (`http://localhost:5173/#/manage`), enter the private backend access code, and accept or decline a request. Accept changes it to Confirmed; decline changes it to Cancelled and releases the nights. Guests can use **Refresh booking status** on their booking page to see the decision. The manager can filter by status, paginate, refresh, and cancel confirmed stays. Cancelled bookings cannot be reconfirmed.

For the temporary demo below, the backend prints a randomly generated management access code in its own terminal. For a persistent backend, set `ADMIN_API_TOKEN` in **backend/.env** to a private random value of at least 32 characters and restart the backend. Generate a value with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Never commit this value or put it in frontend/VITE variables. The dashboard keeps it in memory only; reload or sign out clears it. An unset or short code disables management with HTTP 503; invalid credentials return 401. Confirmation requires authorization on both the new admin endpoint and the legacy status endpoint.

This is a single-manager academic workflow. Guests still use booking references for lookup/cancellation, and publishing is public. It does not implement authenticated guest/host accounts, per-host permissions, payments/refunds, messaging, verified reviews, email notifications, automatic pending-request expiry, or Instant Book. Use sample guest information in demonstrations; production use requires proper account authorization and operational controls.

## Run the backend

Requires Node.js 22.12+ and a running local MongoDB server. From the repository root, open a terminal:

```powershell
cd backend
npm.cmd ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd run seed
npm.cmd run dev
```

Run `seed` only for initial sample setup or when deliberately resetting sample listings and bookings: it replaces data in the configured database. Check `.env` first. Health: http://localhost:5000/health must report a connected database.

## Run the frontend

```powershell
cd frontend
npm.cmd ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd run dev
```

Keep the backend terminal open, then run the frontend in another terminal. Open http://localhost:5173; the default API origin is http://localhost:5000. Default backend CORS settings already permit this frontend origin. Configure VITE_API_URL for another backend origin. If this frontend is already serving port 5173, use that server.

See [frontend/README.md](frontend/README.md) for API integration, tests, and deployment instructions.

## Temporary demonstration without a MongoDB Windows service

From the repository root:

```powershell
cd backend
npm.cmd ci
npm.cmd install --no-save --package-lock=false mongodb-memory-server
cd ../frontend
npm.cmd ci
npm.cmd run demo:backend -- "../backend"
```

Keep this terminal open and start the frontend in another terminal. The first demo run downloads MongoDB if needed. This runs the real backend with an isolated temporary database. New data survives browser refresh but is discarded when the process stops; the normal project database is not used.

## Verification

Unit tests, browser workflows, automated accessibility checks, backend HTTP contract checks, and isolated real-MongoDB integration verify the frontend. Live checks cover booking persistence, conflicts, cancellation and concurrent reservations. See [frontend/README.md](frontend/README.md) for commands and practical limits. This branch creates no cloud resources and claims no AWS performance results.

From `frontend/`, run:

```powershell
npm.cmd run format:check
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
node scripts/check-backend-contract.mjs "../backend"
node scripts/check-live-integration.mjs "../backend"
```

The live check requires the optional `mongodb-memory-server` dependency in `backend/` and Chromium installed using `npx.cmd playwright install chromium` in `frontend/`. It creates and discards its own database.

From `backend/`, `npm.cmd test` runs Member 1's full test suite. It clears the separate test database configured by `MONGODB_URI_TEST`; never use a database whose data you need to keep. See [backend/README.md](backend/README.md) for backend setup and test details.

## Merge preservation

The frontend history had intentionally removed `backend/` to keep the member branch frontend-only. This integration explicitly restores that folder from the backend branch after merging the frontend history. Neither member branch nor `main` is overwritten. Account authentication, payments, AWS deployment and cloud-load measurements remain separate project work; sample photography is illustrative.

At the original merge on 15 November 2026, all 111 backend tests, 15 frontend unit/API tests, 16 browser tests, the production build and 12 HTTP contract checks passed. The browser suite ran serially after a parallel image-load timing failure on this Windows machine. Application code was not changed to bypass that failure. Source comparisons at that merge confirmed both applications matched their member branches.

## Integration bug audit

Follow-up fixes on `integration/frontend-backend` address the skip-link route, stale automatic country filters after changing destinations, losing the current results page when returning from a listing, broken responsive-image fallbacks, removing deleted saved/comparison properties, request timeouts overridden by cancellation signals, and case-insensitive destination/country grouping. Each issue has a regression check. User-selected country filters and temporarily unavailable saved properties are preserved; only explicit 404 results can be removed with the new cleanup control. Backend source and the member branches remain unchanged.

Discovery options are derived from all pages of the listing API, not a fixed destination list. List your space publishes through Member 1's existing API. See the detailed dynamic-discovery checklist and the temporary manual-demo backend command in [frontend/README.md](frontend/README.md).
