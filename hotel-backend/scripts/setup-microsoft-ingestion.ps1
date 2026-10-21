param(
  [string]$Project = 'hotelogx',
  [string]$Region = 'europe-west4',
  [string]$Service = 'hotelogx-connect-backend',
  [string]$TasksRegion = 'europe-west1'
)
$ErrorActionPreference = 'Stop'
function Invoke-Gcloud {
  & gcloud.cmd @args
  if ($LASTEXITCODE -ne 0) { throw 'gcloud command failed; review the preceding error' }
}
function Test-GcloudResource {
  # Windows PowerShell treats native stderr as an error even when redirected.
  # Missing resources are expected here; let the exit code decide whether to create them.
  $ErrorActionPreference = 'Continue'
  $PSNativeCommandUseErrorActionPreference = $false
  & gcloud.cmd @args >$null 2>$null
  return ($LASTEXITCODE -eq 0)
}
$backendUrl = (& gcloud.cmd run services describe $Service --project=$Project --region=$Region --format='value(status.url)').Trim()
if ($LASTEXITCODE -ne 0 -or !$backendUrl.StartsWith('https://')) { throw 'Cannot resolve Cloud Run URL' }
$runtimeIdentity = (& gcloud.cmd run services describe $Service --project=$Project --region=$Region --format='value(spec.template.spec.serviceAccountName)').Trim()
if ($LASTEXITCODE -ne 0 -or !$runtimeIdentity.Contains('@')) { throw 'Cannot resolve Cloud Run runtime identity' }
$workerName = 'microsoft-worker-v2'
$workerIdentity = "$workerName@$Project.iam.gserviceaccount.com"
$queueName = 'microsoft-inbound-v2'
Invoke-Gcloud services enable cloudtasks.googleapis.com cloudscheduler.googleapis.com --project=$Project
if (!(Test-GcloudResource iam service-accounts describe $workerIdentity --project=$Project)) { Invoke-Gcloud iam service-accounts create $workerName --display-name='Microsoft email workers' --project=$Project }
if (!(Test-GcloudResource tasks queues describe $queueName --project=$Project --location=$TasksRegion)) { Invoke-Gcloud tasks queues create $queueName --project=$Project --location=$TasksRegion }
Invoke-Gcloud tasks queues update $queueName --project=$Project --location=$TasksRegion --max-concurrent-dispatches=10 --max-dispatches-per-second=5 --min-backoff=30s --max-backoff=300s --max-attempts=100
Invoke-Gcloud projects add-iam-policy-binding $Project "--member=serviceAccount:$runtimeIdentity" --role=roles/cloudtasks.enqueuer --condition=None --quiet
Invoke-Gcloud iam service-accounts add-iam-policy-binding $workerIdentity --project=$Project "--member=serviceAccount:$runtimeIdentity" --role=roles/iam.serviceAccountUser --condition=None --quiet
Invoke-Gcloud run services add-iam-policy-binding $Service --project=$Project --region=$Region "--member=serviceAccount:$workerIdentity" --role=roles/run.invoker --condition=None --quiet
$ordinaryEnv = "MICROSOFT_GRAPH_NOTIFICATION_URL=$backendUrl/api/webhooks/email/microsoft/notifications,MICROSOFT_TASK_QUEUE=projects/$Project/locations/$TasksRegion/queues/$queueName,MICROSOFT_WORKER_AUDIENCE=$backendUrl,MICROSOFT_WORKER_SERVICE_ACCOUNT=$workerIdentity"
Invoke-Gcloud run deploy $Service --source . --project=$Project --region=$Region --timeout=900 "--update-env-vars=$ordinaryEnv"
foreach ($job in @(
  @{ Name='microsoft-fallback-poll-v2'; Schedule='*/5 * * * *'; Path='microsoft-poll' },
  @{ Name='microsoft-subscription-renew-v2'; Schedule='0 */6 * * *'; Path='microsoft-subscriptions/renew' }
)) {
  $action = if (Test-GcloudResource scheduler jobs describe $job.Name --project=$Project --location=$Region) { 'update' } else { 'create' }
  Invoke-Gcloud scheduler jobs $action http $job.Name --project=$Project --location=$Region "--schedule=$($job.Schedule)" --time-zone=Etc/UTC "--uri=$backendUrl/api/workers/email/$($job.Path)" --http-method=POST "--oidc-service-account-email=$workerIdentity" "--oidc-token-audience=$backendUrl" --attempt-deadline=600s
}
Write-Host 'Microsoft ingestion deployed and workers configured. Connect a Microsoft test mailbox and run the acceptance checks in docs/microsoft-ingestion.md.'
