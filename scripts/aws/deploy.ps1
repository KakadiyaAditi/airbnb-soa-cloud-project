param(
  [Parameter(Mandatory=$true)][string]$ParametersFile,
  [string]$Region = 'ap-south-1',
  [string]$StackName = 'airbnb-option-b',
  [switch]$ApproveCharges
)
$ErrorActionPreference = 'Stop'
if (!$ApproveCharges) { throw 'Deployment creates chargeable AWS resources. Obtain explicit budget approval, then pass -ApproveCharges yourself.' }
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$parameters = Get-Content -LiteralPath $ParametersFile -Raw | ConvertFrom-Json
$overrides = @($parameters | ForEach-Object { "$($_.ParameterKey)=$($_.ParameterValue)" })
if (($overrides -join '') -match 'REPLACE') { throw 'Replace all example parameters before deploying.' }
$deployArgs = @('cloudformation','deploy','--region',$Region,'--stack-name',$StackName,'--template-file', (Join-Path $repoRoot 'infra/option-b.json'),'--capabilities','CAPABILITY_IAM','--parameter-overrides') + $overrides
& aws @deployArgs
if ($LASTEXITCODE -ne 0) { throw 'CloudFormation deployment failed. Inspect stack events; do not claim deployment success.' }
& aws cloudformation describe-stacks --region $Region --stack-name $StackName --query 'Stacks[0].Outputs'
