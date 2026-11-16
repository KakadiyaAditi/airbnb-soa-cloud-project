# Holiday traffic simulation with k6

These are controlled experiments on **our application**, not Airbnb production traffic or a claim about a real holiday outage. The script refuses a target unless `/health` reports transaction/idempotency support and load testing explicitly enabled on a database whose name ends `_loadtest`. Remote targets additionally require `CONFIRM_OWNED_TARGET=true`; obtain permission and a resource budget first.

## Scenarios and workload

`performance/holiday.js` runs five sequential open-model arrival-rate scenarios. Defaults: 60 seconds each; normal 5, weekend 10, holiday 20, extreme 40 and recovery 5 **iterations/second**. Each phase ramps then holds. Read iterations use Listing (40%), Search (40%) and Availability (10%); booking iterations (10%) perform creation, same-key replay and cancellation. Therefore iterations/second is **not** total HTTP requests/second. Actual request throughput is measured, never inferred from the configured iteration rate.

`PHASE_SECONDS` accepts 10–600. Rates are configurable by `NORMAL_RATE`, `WEEKEND_RATE`, `HOLIDAY_RATE`, `EXTREME_RATE` (1–200); VUs by `PREALLOCATED_VUS`, `MAX_VUS`. These caps are guardrails, not permission to stress an unapproved system. Dropped iterations are recorded and fail the default threshold so an overloaded generator cannot be called successful peak handling.

Expected 409 `BOOKING_CONFLICT` is counted separately, not hidden and not treated as an unexpected HTTP failure. Other failures count against thresholds. The script checks same-key replay IDs and cancellation results. Test fixtures contain synthetic property IDs/run IDs, not credentials or real guest details. Dedicated data preparation is destructive **only within the explicit isolated test DB**.

## Local container workflow (PowerShell)

First follow `DOCKER_SETUP.md` to start the separate `airbnb-loadtest` Compose project on port 8081 and prepare/copy `performance/fixtures.local.json`.

Install k6 from its official release/distribution and Python plotting tools in a virtual environment if preferred:

```powershell
python -m pip install -r performance/requirements.txt
k6 version
./performance/run-local.ps1 -K6Path k6 -PhaseSeconds 60
```

For a short functional verification use `-PhaseSeconds 10`; that 50-second test is not a sustained/cloud capacity result. `run-local.ps1` records Docker CPU only for the dedicated local load stack; it never equates containers with EC2 instances. It retains raw NDJSON, summary, run metadata, CSV and graphs under ignored `performance/results/<UTC timestamp>`.

If registry downloads prevent local Compose startup, an explicitly labelled non-container fallback is available. It needs backend dev dependencies and creates a disposable replica-set database:

```powershell
# Terminal 1, backend; stopping discards this experiment data.
npm.cmd run load:demo
# Terminal 2, repository root:
./performance/run-local.ps1 -K6Path k6 -PhaseSeconds 10 -BaseUrl http://localhost:5188
```

This fallback measures Node + temporary MongoDB on the laptop. It is **not evidence of Docker, AWS, ASG scaling or durable cloud deployment**. No Docker/AWS CPU series is invented if unavailable.

## Raw invocation and analysis

```powershell
k6 run --out json=performance/results/requests.ndjson --env BASE_URL=http://localhost:8081 --env FIXTURE=./fixtures.local.json --env SUMMARY_FILE=performance/results/summary.json --env PHASE_SECONDS=60 performance/holiday.js
python performance/analyse.py --raw performance/results/requests.ndjson --summary performance/results/summary.json --out performance/results/analysis
```

Create `performance/results` first. Relative `FIXTURE` is resolved from the script directory by k6. The wrapper supplies absolute paths to avoid ambiguity. Analysis streams actual point records; reports count, observed completion-window RPS, mean, median, nearest-rank p95/p99, failure rate/count, expected conflicts and dropped iterations per phase. It does not average per-instance percentiles. Small samples have unstable tails and must be labelled as such.

Default thresholds are starting academic SLOs, not guaranteed capacity: HTTP failures <1%, checks >99%, p95 <1500 ms, p99 <3000 ms, no dropped iterations and unexpected booking failure rate <1%. Failed threshold exit codes are retained/reported; results are not silently relabelled successful. Change thresholds only with a documented reason, not to conceal an observed regression.

## AWS experiments after charge approval and actual deployment

Use a separate approved test DB and deployment with restricted access. Set `LOAD_TEST_DATA_ENABLED=true` only for that environment, prepare its fixture, and run k6 with the real HTTPS origin plus explicit ownership confirmation. The published normal template does not automatically enable load writes.

Record generator hardware/location, Git commit/dirty state, image digests, database tier/topology/pool limits, region, instance type, ASG min/desired/max/CPU policy, test UTC interval, configured arrival rates, dropped work and actual HTTP counts. Run the full durations and repeats agreed with the team; account for generator limits, cold/warm instances and DB saturation.

Use `scripts/aws/collect-evidence.ps1` for matching UTC times. Keep real CPU, in-service count, target latency/errors and scaling activity exports alongside client observations. Missing AWS data stays `NOT_MEASURED`, not zero. `PERFORMANCE_ANALYSIS.md` distinguishes completed local tests from pending AWS experiments.

If PowerShell refuses unsigned local scripts, use `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\performance\run-local.ps1 -K6Path k6 -PhaseSeconds 30 -BaseUrl http://127.0.0.1:8081`. This changes policy only for that invocation. Requests have a 15-second timeout and phase transitions allow 5 seconds to drain. Use IPv4 loopback for reproducible local tests.
