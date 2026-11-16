# Docker setup — Windows PowerShell

Requirements: running Docker Desktop Linux engine/Compose v2.24+, network access to pull images, and a free localhost port 8080. The original development server on 5173 and backend on 5000 need not be stopped. Docker isolates its own database and volume.

## Windows installation

Follow the [official Docker Desktop Windows installation guide](https://docs.docker.com/desktop/setup/install/windows-install/) for supported Windows versions and hardware prerequisites. Enable virtualization and install/update WSL 2 if needed (`wsl --install` or `wsl --update` from administrator PowerShell, then restart when requested). Install Docker Desktop, choose its WSL 2 backend and Linux containers, launch it and wait for the engine to be ready. Verify `docker version` shows both client and server. Git is needed to clone; host Node.js 22.14+ is needed only for the optional host-run tests, not container startup.

The canonical root configuration is `docker-compose.yml`; do not create a second competing Compose file. It runs the four logical services inside the existing Express backend, not four independently deployed microservices.

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\airbnb-cloud-project\airbnb-cloud-project'
docker version
docker compose version
# Only if root .env does not already exist:
Copy-Item .env.example .env
```

Generate a private manager token and put it in root `.env` as `ADMIN_API_TOKEN=...`; do not commit this file. Do not overwrite an existing `.env`. If the token is blank, browsing/booking work but management returns 503 until configured.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
docker compose config --quiet
docker compose build
docker compose up -d --wait
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://localhost:8080/health
# Initial sample setup only: this replaces records in this Compose database.
docker compose exec backend node scripts/seed.js --force
Start-Process http://localhost:8080
```

The required `docker compose up --build` also works in foreground; keep that terminal open and run initial seed/checks in another terminal. Root `.env` is loaded by Compose automatically. `WEB_PORT=8088` can select another local port. Do not print full `docker compose config` in shared logs because it expands secrets; use `--quiet`.

Services: MongoDB 8.2 on an internal-only port with persistent `mongo-data`; a one-shot initializer configures `rs0` and waits for a primary; API waits for initialization and provides DB-aware health; Nginx serves the production build and forwards `/api/*` to backend. Only localhost frontend port is published. MongoDB is not authenticated in this **isolated development network**; it is not the AWS production DB.

```powershell
node scripts/check-deployment.cjs http://localhost:8080
docker compose logs --tail 30 backend
docker compose logs --tail 30 frontend mongo mongo-init
docker compose restart backend
Invoke-RestMethod http://localhost:8080/api/listings
docker compose down
```

`check-deployment.cjs` creates and cancels one synthetic booking, verifies replay/conflict/repeated cancellation, and must only target your approved demo/test deployment. `down` retains data. Do **not** add `-v` unless intentionally deleting this project's database volume.

`mongo-init` exiting with code 0 is expected; the other three containers should be healthy. Use `docker compose logs -f backend frontend` to follow logs (Ctrl+C stops log viewing). Browser requests go to `http://localhost:8080/api/...`; Nginx resolves the internal Docker name `backend:5000`. A browser must never use `http://backend:5000`. Local MongoDB is supplied by default, requires no Atlas credentials, and stores records in the named volume across container restarts and `down`/`up`. This setup does not migrate or alter an existing Atlas database.

## Verify each service

Open the website and search London, select future dates and create a synthetic booking. Save its reference; verify it in the trips interface, cancel it, then check those dates are available again. For approval testing configure the private manager token, open `http://localhost:8080/#/manage`, accept the request and refresh its guest status. Use a fresh booking for the cancellation check.

```powershell
Invoke-RestMethod http://localhost:8080/frontend-health
Invoke-RestMethod http://localhost:8080/health
Invoke-RestMethod 'http://localhost:8080/api/listings?limit=2'
Invoke-RestMethod 'http://localhost:8080/api/search?city=London&guests=2'
docker compose exec mongo mongosh --quiet --eval 'db.adminCommand({ping:1}).ok'
node scripts/check-deployment.cjs http://localhost:8080
```

The production browser verification can also run with `node scripts/check-browser-deployment.mjs http://localhost:8080` after `npm.cmd --prefix frontend ci` and `npx.cmd --prefix frontend playwright install chromium`. It reads the manager code privately from the root `.env` or process environment.

## Isolated tests

```powershell
Set-Location backend
npm.cmd ci
npm.cmd run test:isolated -- --coverage
Set-Location ../frontend
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e -- --workers=1
node scripts/check-live-integration.mjs ../backend
```

Tests/demo now use a temporary replica set (`mongodb-memory-server` is a backend dev dependency). First run may download MongoDB. No normal or Compose database is wiped. For OneDrive test-discovery issues use `node scripts/prepare-local-verification.mjs` from frontend and test in the printed copy. Never reinstall dependencies while a running dev server is using them.

## Dedicated load-test stack

```powershell
# From repository root; isolated from normal Compose volumes/network.
$env:WEB_PORT='8081'
docker compose -p airbnb-loadtest -f docker-compose.yml -f performance/compose.load.yaml up --build -d
docker compose -p airbnb-loadtest -f docker-compose.yml -f performance/compose.load.yaml exec -e ALLOW_LOAD_TEST_DATA=true backend node scripts/prepare-load-data.cjs
docker compose -p airbnb-loadtest -f docker-compose.yml -f performance/compose.load.yaml cp backend:/tmp/load-fixtures.json performance/fixtures.local.json
docker compose -p airbnb-loadtest -f docker-compose.yml -f performance/compose.load.yaml exec backend node scripts/check-multiple-instances.cjs
```

The load-data command refuses databases not ending `_loadtest` and requires an explicit reset flag. It replaces **only that dedicated test database**. Use synthetic guests. For cleanup use the same `-p` and `-f` arguments with `down`, without deleting unrelated containers or volumes. Unset `WEB_PORT` after working with the load stack: `Remove-Item Env:WEB_PORT`.

If a registry pull fails with network EOF, retry the image pull; do not disable TLS. If startup rejects standalone MongoDB, use the supplied replica-set Compose/demo rather than bypassing transaction checks. If ports are occupied, select another `WEB_PORT` and matching URL. See `PERFORMANCE_ANALYSIS.md` for the actual verification status.

### OneDrive / execution-policy note

If BuildKit reports `invalid file request` on this OneDrive checkout, run `node scripts/materialize-onedrive.cjs` from the repository root, then retry `docker compose up --build`. This rewrites tracked Docker inputs with identical verified bytes to remove cloud-placeholder attributes; it does not touch secrets, dependencies or database volumes. This procedure was verified in the actual project directory. For test discovery issues, use the physical verification copy: run `node scripts/prepare-local-verification.mjs` from frontend and use the printed root path. The helper excludes secrets. PowerShell scripts can be invoked for this process only with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <script.ps1> ...`; do not change the global execution policy.
