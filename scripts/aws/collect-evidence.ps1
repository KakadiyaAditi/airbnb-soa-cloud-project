param(
  [Parameter(Mandatory=$true)][string]$StackName,
  [Parameter(Mandatory=$true)][datetime]$StartUtc,
  [Parameter(Mandatory=$true)][datetime]$EndUtc,
  [string]$Region = 'ap-south-1',
  [string]$OutputDirectory = './performance/results/aws'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$stack = (& aws cloudformation describe-stacks --region $Region --stack-name $StackName --output json | ConvertFrom-Json).Stacks[0]
if ($LASTEXITCODE -ne 0) { throw 'Cannot read the actual deployed stack.' }
$outputs = @{}; foreach ($item in $stack.Outputs) { $outputs[$item.OutputKey] = $item.OutputValue }
$asg = $outputs.AutoScalingGroupName; $alb = $outputs.LoadBalancerFullName
function Query($id,$ns,$name,$dimension,$value,$stat) {
  @{ Id=$id; MetricStat=@{ Metric=@{Namespace=$ns;MetricName=$name;Dimensions=@(@{Name=$dimension;Value=$value})}; Period=60; Stat=$stat };ReturnData=$true }
}
$queries = @(
  (Query 'cpu' 'AWS/EC2' 'CPUUtilization' 'AutoScalingGroupName' $asg 'Average'),
  (Query 'instances' 'AWS/AutoScaling' 'GroupInServiceInstances' 'AutoScalingGroupName' $asg 'Average'),
  (Query 'requests' 'AWS/ApplicationELB' 'RequestCount' 'LoadBalancer' $alb 'Sum'),
  (Query 'p95' 'AWS/ApplicationELB' 'TargetResponseTime' 'LoadBalancer' $alb 'p95'),
  (Query 'p99' 'AWS/ApplicationELB' 'TargetResponseTime' 'LoadBalancer' $alb 'p99'),
  (Query 'errors' 'AWS/ApplicationELB' 'HTTPCode_Target_5XX_Count' 'LoadBalancer' $alb 'Sum')
)
foreach ($pair in @(@('booking_attempts','BookingAttemptCount'),@('booking_failures','BookingFailureCount'),@('booking_conflicts','BookingConflictCount'))) {
  $queries += @{ Id=$pair[0]; MetricStat=@{ Metric=@{Namespace='AirbnbSOA';MetricName=$pair[1];Dimensions=@(@{Name='Environment';Value=$StackName},@{Name='Service';Value='Booking'})};Period=60;Stat='Sum'};ReturnData=$true }
}
$queryFile = Join-Path (Resolve-Path $OutputDirectory) 'metric-queries.json'
$queries | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $queryFile -Encoding ASCII
$metrics = & aws cloudwatch get-metric-data --region $Region --metric-data-queries "file://$queryFile" --start-time $StartUtc.ToUniversalTime().ToString('o') --end-time $EndUtc.ToUniversalTime().ToString('o') --scan-by TimestampAscending --output json
if ($LASTEXITCODE -ne 0) { throw 'CloudWatch query failed; no cloud evidence claimed.' }
$metrics | Set-Content (Join-Path $OutputDirectory 'cloudwatch.json')
$parsed = $metrics | ConvertFrom-Json
$rows = foreach ($series in $parsed.MetricDataResults) { for ($i=0; $i -lt $series.Values.Count; $i++) { [PSCustomObject]@{ metric=$series.Id; timestampUtc=([datetime]$series.Timestamps[$i]).ToUniversalTime().ToString('o'); value=$series.Values[$i]; source='ACTUAL_AWS_CLOUDWATCH' } } }
if (!$rows) { throw 'No actual CloudWatch data returned. Missing observations must not be replaced with zeroes.' }
$rows | Export-Csv -NoTypeInformation (Join-Path $OutputDirectory 'cloudwatch.csv')
& aws autoscaling describe-scaling-activities --region $Region --auto-scaling-group-name $asg --output json | Set-Content (Join-Path $OutputDirectory 'scaling-activities.json')
Write-Output 'Actual AWS observations saved. ALB latency is seconds, not client milliseconds; request count is per 60-second period.'
