param(
  [string]$K6Path = 'k6',
  [int]$PhaseSeconds = 60,
  [string]$BaseUrl = 'http://127.0.0.1:8081',
  [string]$Fixture = (Join-Path $PSScriptRoot 'fixtures.local.json'),
  [switch]$ConfirmOwnedTarget
)
$ErrorActionPreference = 'Stop'
try { $ready = Invoke-RestMethod "$BaseUrl/health" -TimeoutSec 5 } catch { throw 'Load target is not ready. Start it and wait for /health before running the experiment.' }
if (!$ready.data.loadTestingAllowed) { throw 'Target has not enabled isolated load testing.' }
$repoRoot = Split-Path $PSScriptRoot -Parent
$resultPath = Join-Path $PSScriptRoot ('results/' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))
New-Item -ItemType Directory -Path $resultPath -Force | Out-Null
$stopFile = Join-Path $resultPath 'collection.stop'
$cpuPath = Join-Path $resultPath 'docker-cpu.ndjson'
$containerIds = @(& docker compose -p airbnb-loadtest -f (Join-Path $repoRoot 'compose.yaml') -f (Join-Path $PSScriptRoot 'compose.load.yaml') ps -q)
$collector = $null
if ($containerIds.Count -gt 0 -and $BaseUrl -match ':8081$') { $collector = Start-Job -ArgumentList $containerIds,$stopFile,$cpuPath -ScriptBlock {
  param($ids,$stop,$output)
  while (!(Test-Path -LiteralPath $stop)) {
    $samples = & docker stats --no-stream --format '{{json .}}' @ids 2>$null
    foreach ($line in $samples) {
      $sample = $line | ConvertFrom-Json
      $sample | Add-Member -NotePropertyName observedAt -NotePropertyValue (Get-Date).ToUniversalTime().ToString('o')
      $sample | ConvertTo-Json -Compress | Add-Content -LiteralPath $output -Encoding UTF8
    }
    Start-Sleep -Seconds 1
  }
} }
$raw = Join-Path $resultPath 'requests.ndjson'
$summary = Join-Path $resultPath 'summary.json'
$runArgs = @('run','--out',"json=$raw",'--env',"SUMMARY_FILE=$summary",'--env',"BASE_URL=$BaseUrl",'--env',"FIXTURE=$Fixture",'--env',"PHASE_SECONDS=$PhaseSeconds")
if ($ConfirmOwnedTarget) { $runArgs += @('--env','CONFIRM_OWNED_TARGET=true') }
$runArgs += (Join-Path $PSScriptRoot 'holiday.js')
$resultCode = 1
try { & $K6Path @runArgs; $resultCode = $LASTEXITCODE }
finally { if ($collector) { Set-Content -LiteralPath $stopFile -Value 'stop'; Wait-Job $collector -Timeout 10 | Out-Null; Stop-Job $collector; Remove-Job $collector } }
@{ source='actual-local-run'; gitCommit=(& git -C $repoRoot rev-parse HEAD); dirty= [bool](& git -C $repoRoot status --porcelain); target=$BaseUrl; phaseSeconds=$PhaseSeconds; exitCode=$resultCode; awsMetrics='NOT_MEASURED' } | ConvertTo-Json | Set-Content (Join-Path $resultPath 'run-metadata.json')
if (Test-Path -LiteralPath $summary) {
  & python (Join-Path $PSScriptRoot 'analyse.py') --raw $raw --summary $summary --out $resultPath --cpu $cpuPath
  if ($LASTEXITCODE -ne 0) { throw 'Analysis failed; raw measurements are retained.' }
}
Write-Output "Evidence directory: $resultPath"
if ($resultCode -ne 0) { throw "k6 thresholds failed (exit $resultCode). Evidence is retained; do not report this as a passing test." }
