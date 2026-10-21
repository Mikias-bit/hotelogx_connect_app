param(
  [string]$Project = 'hotelogx',
  [string]$Region = 'europe-west4',
  [string]$Service = 'hotelogx-connect-backend'
)
$ErrorActionPreference = 'Stop'
function Invoke-Gcloud {
  & gcloud.cmd @args
  if ($LASTEXITCODE -ne 0) { throw 'gcloud command failed; review the preceding error' }
}
function Test-GcloudResource {
  # Windows PowerShell treats native stderr as an error even when redirected.
  # Missing resources are expected here; use the exit code to select creation.
  $ErrorActionPreference = 'Continue'
  $PSNativeCommandUseErrorActionPreference = $false
  & gcloud.cmd @args >$null 2>$null
  return ($LASTEXITCODE -eq 0)
}
function Invoke-GcloudIamBinding {
  # A newly created account can exist in IAM before Cloud Run recognizes it.
  $ErrorActionPreference = 'Continue'
  $PSNativeCommandUseErrorActionPreference = $false
  for ($attempt = 1; $attempt -le 7; $attempt++) {
    $output = & gcloud.cmd @args 2>&1
    $exitCode = $LASTEXITCODE
    $message = ($output | ForEach-Object { "$_" }) -join [Environment]::NewLine
    if ($exitCode -eq 0) { $output | Write-Output; return }
    if ($message -notmatch 'Service account .* does not exist' -or $attempt -eq 7) {
      throw "Cloud Run IAM binding failed: $message"
    }
    Write-Host 'Waiting for the new worker service account to propagate before retrying Cloud Run IAM...'
    Start-Sleep -Seconds 10
  }
}
$backendUrl = (& gcloud.cmd run services describe $Service --project=$Project --region=$Region --format='value(status.url)').Trim()
if ($LASTEXITCODE -ne 0 -or !$backendUrl.StartsWith('https://')) { throw 'Cannot resolve Cloud Run URL' }
$workerName = 'imap-worker-v2'
$workerIdentity = "$workerName@$Project.iam.gserviceaccount.com"
Invoke-Gcloud services enable cloudscheduler.googleapis.com --project=$Project
if (!(Test-GcloudResource iam service-accounts describe $workerIdentity --project=$Project)) { Invoke-Gcloud iam service-accounts create $workerName --display-name='IMAP email polling worker' --project=$Project }
Invoke-GcloudIamBinding run services add-iam-policy-binding $Service --project=$Project --region=$Region "--member=serviceAccount:$workerIdentity" --role=roles/run.invoker --condition=None --quiet
$ordinaryEnv = "IMAP_WORKER_AUDIENCE=$backendUrl,IMAP_WORKER_SERVICE_ACCOUNT=$workerIdentity"
Invoke-Gcloud run deploy $Service --source . --project=$Project --region=$Region --timeout=900 "--update-env-vars=$ordinaryEnv"
$jobName = 'imap-poll-v2'
$action = if (Test-GcloudResource scheduler jobs describe $jobName --project=$Project --location=$Region) { 'update' } else { 'create' }
Invoke-Gcloud scheduler jobs $action http $jobName --project=$Project --location=$Region '--schedule=* * * * *' --time-zone=Etc/UTC "--uri=$backendUrl/api/workers/email/imap-poll" --http-method=POST "--oidc-service-account-email=$workerIdentity" "--oidc-token-audience=$backendUrl" --attempt-deadline=600s
Write-Host 'IMAP worker deployed and scheduled every minute. Deploy the frontend, connect a test mailbox, and follow docs/imap-ingestion.md.'
