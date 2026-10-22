param(
  [Parameter(Mandatory=$true)][ValidatePattern('^\d+$')][string]$AppId,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$AppSecretName,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$VerifyTokenSecretName,
  [string]$Project = 'hotelogx',
  [string]$Region = 'europe-west4',
  [string]$Service = 'hotelogx-connect-backend',
  [ValidatePattern('^v\d+\.0$')][string]$GraphVersion = 'v25.0'
)
$ErrorActionPreference = 'Stop'
function Invoke-Gcloud {
  & gcloud.cmd @args
  if ($LASTEXITCODE -ne 0) { throw 'gcloud failed; review the preceding error' }
}
# Check existing secret names without reading their values. The Cloud Run runtime
# identity must already have secretAccessor permission for these secrets.
Invoke-Gcloud secrets describe $AppSecretName --project=$Project --format='value(name)'
Invoke-Gcloud secrets describe $VerifyTokenSecretName --project=$Project --format='value(name)'
$backendSource = Split-Path -Parent $PSScriptRoot
Invoke-Gcloud run deploy $Service --source $backendSource --project=$Project --region=$Region --timeout=900 "--update-env-vars=META_APP_ID=$AppId,META_GRAPH_VERSION=$GraphVersion" "--update-secrets=META_APP_SECRET=${AppSecretName}:latest,META_WEBHOOK_VERIFY_TOKEN=${VerifyTokenSecretName}:latest"
Write-Host 'Backend deployed. Configure the Meta messages webhook and rebuild Netlify with VITE_META_APP_ID, VITE_META_CONFIG_ID, and VITE_META_GRAPH_VERSION. Follow docs/whatsapp-onboarding.md for live tests.'
