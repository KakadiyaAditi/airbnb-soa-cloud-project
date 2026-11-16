# Final demonstration guide

## Explain the architecture accurately

The approved choice is Option B, preserving four logical SOA service modules inside one Node API image, repeated across EC2 instances behind an ALB. MongoDB is shared and persistent; transactions and unique night locks coordinate writes across processes. Frontend is a production Vite build served by Nginx. CloudWatch receives actual logs/metrics only after AWS is deployed. Do not call these four independently deployed microservices.

## Local application demonstration

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\airbnb-cloud-project\airbnb-cloud-project'
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://localhost:8080/health
Start-Process http://localhost:8080
```

Prepare synthetic seed data only once/intentionally as in `DOCKER_SETUP.md`. Search a city and demonstrate country inference, dates/guests/amenity/prices, details and availability. Submit a sample booking, show Pending and its real reference. Open `/#/manage`, enter the private configured code, accept it and refresh guest status. Decline another request, demonstrate released dates and repeat-safe cancellation. Return home/reload to show cleared search; show comparison clearing on mobile.

## Correctness evidence

```powershell
Set-Location backend
npm.cmd run test:isolated -- --coverage
```

Explain same-key replay versus a different guest's conflicting dates. Show rollback tests, mismatch rejection and cancellation retry. For two actual API processes use the dedicated `_loadtest` stack and `scripts/check-multiple-instances.cjs`; do not present two local processes as EC2 instances.

## Traffic experiment

Prepare the isolated test data, run `performance/run-local.ps1` and open its generated `performance.csv`, `latency-throughput.png` and metadata. Show all five scenarios, actual HTTP request counts/RPS, p95/p99, failures/conflicts and dropped work. Explicitly state local run duration and target. A short verification is not sustained holiday capacity evidence.

## AWS demonstration — only after real deployment

Show the actual HTTPS domain, current image/commit, healthy ALB targets and persistent database configuration without exposing credentials. Show the ASG CPU policy, actual in-service counts/scaling activity, and CloudWatch graphs covering the k6 UTC interval. Show DB-backed booking retrieval after replacing a backend instance. Explain why adding API instances cannot eliminate popular-property contention or database bottlenecks.

If AWS is not deployed yet, say so and show the validated template/procedure as preparation. Do not substitute local Docker CPU or a diagram for actual cloud scaling evidence. Do not claim cloud savings or p95/p99 improvement without measured comparison data.

## Member ownership and limitations

Member 1 explains API contracts, service boundaries and database correctness. Member 2 explains frontend integration and workflows. Member 3 explains deployment, monitoring, traffic generation, analysis, costs and cleanup. All members should understand the complete flow.

The manager is one protected project role, not per-property host accounts. Public listing creation and reference-based guest lookup remain demo interfaces. Payments, automatic pending expiry and a full marketplace identity system are not claimed. These limitations do not change the research focus: service boundaries, simulated spikes, correct bookings and measured behaviour.
