# Cost estimation and spending boundary

Option B architecture was approved; chargeable AWS resource creation was **not**. No AWS bill or monetary savings were measured. Region, account eligibility, database tier, instance hours, retention, transfer and testing duration must be agreed before producing a defensible numeric estimate.

## Cost model

| Component | Estimate input |
|---|---|
| EC2 | Sum of each actual instance's running hours × selected regional rate; include baseline, warmup and scale-in delay |
| ALB | Running hours plus capacity-unit usage; stopping the app alone does not stop ALB charges |
| EBS | Per-instance storage and any retained volumes/snapshots |
| Public networking | Applicable IPv4, internet transfer, NAT/endpoints, load-generator traffic |
| Persistent MongoDB | Provider/tier, replica topology, storage, backups and network connectivity; not an instance-local free replacement |
| ECR | Image storage and applicable transfer; delete only unneeded approved artifacts |
| Monitoring | CloudWatch logs, custom metrics, dashboard/alarms and retention; EMF can create billable custom metrics |
| Domain/TLS/DNS | Existing certificate/domain assumptions; DNS/domain costs where applicable |

Default ASG max 3 (allowed up to 5) bounds compute count, not total spend. Desired/min 1 retains baseline cost. Template log retention is seven days; the retained log group can continue to cost after stack deletion. EMF dimensions are bounded and health polling is excluded to avoid unnecessary metric cardinality/traffic. No per-booking/email/key dimension is created.

Do not assume free credits cover EC2, ALB, database, public IPv4, NAT or stress traffic. A budget alert is a notification, not a hard spending stop. Keeping a database on a free/shared tier may limit connections/throughput and distort conclusions; document the actual tier.

## Approval record needed before deployment

Record: AWS account/region, pricing-check date, instance type, maximum capacity, maximum test duration, DB provider/topology, estimated upper cost for that window, retained resources, billing-alert recipient and cleanup owner. Use current regional prices from the official calculator; do not copy an old region's rate as an actual estimate.

- [AWS Pricing Calculator](https://calculator.aws/)
- [EC2 pricing](https://aws.amazon.com/ec2/pricing/on-demand/)
- [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
- [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)
- [ECR pricing](https://aws.amazon.com/ecr/pricing/)

See `AWS_DEPLOYMENT_GUIDE.md` for the explicit deploy switch. No billing-producing commands were executed for this implementation. After the demonstration, review the named stack, retained logs, ECR artifacts, independent MongoDB and backups deliberately; never run a blanket account deletion command.
