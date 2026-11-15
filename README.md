# Airbnb - integrated frontend and backend

Responsive Airbnb-inspired accommodation search and booking interface, compatible with Member 1's Listing, Search, Availability, and Booking APIs.

Features include saved stays, side-by-side comparison, amenity filters, reserved-date calendar, photo viewer, live booking estimates, and printable/calendar itineraries.

This integration branch contains both `backend/` and `frontend/`. The original member branches remain unchanged. The backend is restored exactly from Member 1's commit `512b4a8`, including its services, models, validators and tests. All frontend functionality and HD photo assets are retained.

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

Verified locally on 15 November 2026: all 111 backend tests passed against a fresh isolated MongoDB database, all 15 frontend unit/API tests passed, all 16 browser tests passed, the production frontend build passed, and all 12 HTTP contract checks passed. The browser suite was run serially after a parallel image-load timing failure on this Windows machine. Application code was not changed to bypass that failure. Source comparisons confirm the backend exactly matches Member 1 and the frontend application, assets, tests and scripts exactly match Member 2.

Discovery options are derived from all pages of the listing API, not a fixed destination list. List your space publishes through Member 1's existing API. See the detailed dynamic-discovery checklist and the temporary manual-demo backend command in [frontend/README.md](frontend/README.md).
