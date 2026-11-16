# AWS deployment guide — prepared, not deployed

Option B is approved. **Creating chargeable AWS resources still needs separate explicit approval of account, region, budget, database, capacity and cleanup.** No AWS resources were created by the implementation. The commands below are a reviewable deployment procedure for the authorized operator.

## Prerequisites to agree with Member 3

- Existing VPC and at least two ALB public subnets in different AZs. Application subnets need approved egress to ECR, Secrets Manager, logs and MongoDB. Private instances need working NAT/endpoints; this template does not create a hidden NAT gateway.
- Persistent transaction-capable MongoDB, shared by every instance, outside the ASG. Plan TLS, credentials, restricted connectivity, backups and restore tests. Do not use the local memory-server demo or an ASG-local database. Do not broadly open database ingress to solve connectivity.
- Existing ACM certificate in the deployment region for your public application domain, plus permission to create its DNS alias. The ALB DNS hostname is not itself your custom certificate name.
- Existing ECR backend/frontend repositories, or separately approved creation. Images must be built for Linux amd64 and supplied by immutable digest.
- Existing Secrets Manager secret using its AWS-managed key, containing string fields `MONGODB_URI`, `ADMIN_API_TOKEN` (32+ characters), `CORS_ORIGIN` (your exact HTTPS origin). Use the AWS console/approved secret workflow; never put values in Git, parameters examples, shell screenshots or frontend builds. A customer-managed KMS key needs a separately reviewed decrypt grant.
- AWS CLI with the intended account/region and least-privilege deployment access. Architecture approval is not a spending approval.

## Build and publish images after approval

```powershell
Set-Location 'C:\Users\HP\OneDrive\Desktop\airbnb-cloud-project\airbnb-cloud-project'
$region='ap-south-1' # Example only; choose with your team.
$account=aws sts get-caller-identity --query Account --output text
$registry="$account.dkr.ecr.$region.amazonaws.com"
$tag=git rev-parse --short HEAD
aws ecr get-login-password --region $region | docker login --username AWS --password-stdin $registry
docker buildx build --platform linux/amd64 --load -t "$registry/airbnb-api:$tag" backend
docker buildx build --platform linux/amd64 --load --build-arg VITE_API_URL=/ -t "$registry/airbnb-web:$tag" frontend
docker push "$registry/airbnb-api:$tag"
docker push "$registry/airbnb-web:$tag"
$apiDigest=aws ecr describe-images --region $region --repository-name airbnb-api --image-ids "imageTag=$tag" --query 'imageDetails[0].imageDigest' --output text
$webDigest=aws ecr describe-images --region $region --repository-name airbnb-web --image-ids "imageTag=$tag" --query 'imageDetails[0].imageDigest' --output text
```

Use `$registry/airbnb-api@$apiDigest` and `$registry/airbnb-web@$webDigest` in a private copy of `infra/parameters.example.json`, named `infra/parameters.local.json` (ignored). The file contains **secret ARN**, not secret values, as well as VPC/subnets, certificate ARN and exact repository ARNs. Replace every example. Optional parameters bound instances and CPU target; defaults are desired/min 1, max 3, target 60%. Confirm the database supports the aggregate connection pool of that bound.

## Validate and deploy

```powershell
python -m pip install cfn-lint
cfn-lint infra/option-b.json
aws cloudformation validate-template --region $region --template-body file://infra/option-b.json
# ONLY after explicit charge approval; this creates paid resources:
./scripts/aws/deploy.ps1 -ParametersFile ./infra/parameters.local.json -Region $region -StackName airbnb-option-b -ApproveCharges
```

`deploy.ps1` refuses deployment without `-ApproveCharges`. Bootstrap retrieves only its allowed secret, authenticates to ECR, pulls images, starts containers and signals CloudFormation after `/health` is ready. IMDSv2, root-only secret file, no SSH ingress and ALB-only application ingress are configured. Logs are retained seven days; the log group is retained on stack deletion and may still incur storage charges.

If editing `infra/bootstrap.sh`, synchronize the embedded CloudFormation userdata with `node scripts/aws/sync-bootstrap.cjs`, then lint again. Startup/secret/image failures must be inspected in stack events and EC2 console/SSM; do not claim successful deployment from a pushed template alone.

Add the approved domain's ALB DNS alias. Visit `https://your-domain`, check `/health`, and use the backend's configured manager code at `/#/manage`. No token is bundled into the frontend. All replicas use the same secret. Secret updates require an approved instance refresh/restart; boot-time retrieval is not live secret rotation.

## Acceptance before traffic tests

1. Verify CloudFormation signals, healthy ALB targets, certificate/domain, production frontend and API response envelopes from another network.
2. Seed only a deliberate synthetic demo DB using an approved maintenance procedure; never seed/reset each ASG instance. The normal seed is destructive and must not run on a database containing records to keep.
3. Test booking, replay, conflicting dates, manager acceptance/decline, cancellation, a backend restart and cross-instance persistence.
4. For load experiments use a **separate** MongoDB database ending `_loadtest` and set `LOAD_TEST_DATA_ENABLED=true` in the isolated test deployment's environment. The production template deliberately does not enable load writes automatically. Prepare fixtures there with `ALLOW_LOAD_TEST_DATA=true` and explicit DB confirmation.
5. Confirm CloudWatch has real API EMF events, ALB latency/errors, CPU and ASG in-service counts. The dashboard can exist while containing no actual observations.
6. Run the approved k6 scenario. Save raw client metrics and CloudWatch data for identical UTC times. Demonstrate actual scale-out and recovery; a fixed instance count is not evidence of scaling.

## Collect evidence after an actual run

```powershell
./scripts/aws/collect-evidence.ps1 -StackName airbnb-option-b -Region $region -StartUtc '2026-11-16T10:00:00Z' -EndUtc '2026-11-16T10:15:00Z'
```

Replace those example dates with the actual run interval. The collector is read-only and refuses an empty CloudWatch result. ALB latency is in seconds; client latency is in milliseconds. It also exports scaling activities. No cloud metrics are manufactured from local Docker measurements.

## Costs and cleanup

Review `COST_ESTIMATION.md` first. IAM is not a spending cap; ALB/EC2/EBS/IPv4/database/logs/ECR/transfer can cost money. ASG maximum 3 is a bound, not a guarantee of zero cost. Idle instances may keep costs running.

After evidence capture, explicitly decide database retention, backups and log retention. Only with approval delete the **named** CloudFormation stack and verify EC2/ALB/volumes/retained logs/ECR and independent database resources. Do not publish or execute a blanket account cleanup command. This template does not delete your external MongoDB on teardown.

For an isolated AWS load-test stack, explicitly set parameter `EnableLoadTesting=true` and use its own secret with a database ending `_loadtest`; the default is false. Invoke unsigned local scripts with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\aws\deploy.ps1 ...` only after charge approval. T3 CPU credit mode is standard to avoid surplus-credit charges; exhausted credits can limit performance and must be discussed. Alarms are defined, but no email/SNS recipient is silently configured.
