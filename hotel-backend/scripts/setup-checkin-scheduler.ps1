param(
  [string]$Project = 'hotelogx',
  [string]$Region = 'europe-west4',
  [string]$Service = 'hotelogx-connect-backend',
  [string]$Job = 'hotelogx-checkin-worker'
)
$ErrorActionPreference = 'Stop'

# Keep credentials in memory. Never print full Scheduler requests/responses,
# which include the worker Authorization header, or write them to temporary files.
function Invoke-PrivateApi {
  param([string]$Uri, [string]$Method = 'Get', $Payload = $null, [switch]$AllowMissing)
  $request = @{ Uri = $Uri; Method = $Method; Headers = @{ Authorization = "Bearer $script:setupToken" }; ErrorAction = 'Stop' }
  if ($null -ne $Payload) {
    $request.ContentType = 'application/json'
    $request.Body = ConvertTo-Json -InputObject $Payload -Depth 12 -Compress
  }
  try { return Invoke-RestMethod @request }
  catch {
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($AllowMissing -and $status -eq 404) { return $null }
    throw "Google Cloud API request failed (HTTP $status). No credentials have been printed."
  }
}

try {
  $serviceJson = & gcloud.cmd run services describe $Service --project=$Project --region=$Region --format=json
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the Cloud Run service' }
  $backend = $serviceJson | ConvertFrom-Json
  $backendUrl = $backend.status.url
  if (!$backendUrl -or !$backendUrl.StartsWith('https://')) { throw 'Cloud Run has no HTTPS URL' }
  $reference = ($backend.spec.template.spec.containers[0].env | Where-Object { $_.name -eq 'CHECKIN_WORKER_SECRET' }).valueFrom.secretKeyRef
  if (!$reference.name -or !$reference.key) { throw 'Attach CHECKIN_WORKER_SECRET from Secret Manager to the backend before scheduling' }
  $deadline = [Math]::Min(900, [int]$backend.spec.template.spec.timeoutSeconds)
  if ($deadline -lt 15) { throw 'Cloud Run request timeout must be at least 15 seconds' }

  $script:setupToken = (& gcloud.cmd auth print-access-token --project=$Project).Trim()
  if ($LASTEXITCODE -ne 0 -or !$script:setupToken) { throw 'Cannot obtain Google Cloud authentication' }
  $secretResource = if ($reference.name.StartsWith('projects/')) { $reference.name } else { "projects/$Project/secrets/$($reference.name)" }
  $secretResult = Invoke-PrivateApi -Uri "https://secretmanager.googleapis.com/v1/$secretResource/versions/$($reference.key):access"
  $workerSecret = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($secretResult.payload.data))
  if ($workerSecret.Length -lt 32 -or $workerSecret -match '\s') { throw 'Worker secret must contain at least 32 characters without whitespace' }

  $parent = "projects/$Project/locations/$Region"
  $name = "$parent/jobs/$Job"
  $jobUri = "https://cloudscheduler.googleapis.com/v1/$name"
  $existing = Invoke-PrivateApi -Uri $jobUri -AllowMissing
  $payload = @{
    name = $name
    description = 'Process automatic guest messaging invitations and recover missed Mews check-in events'
    schedule = '* * * * *'
    timeZone = 'Etc/UTC'
    attemptDeadline = "${deadline}s"
    retryConfig = @{ retryCount = 3; minBackoffDuration = '60s'; maxBackoffDuration = '300s'; maxDoublings = 2 }
    httpTarget = @{
      uri = "$backendUrl/api/pms/guest-messaging-worker"
      httpMethod = 'POST'
      headers = @{ Authorization = "Bearer $workerSecret"; 'Content-Type' = 'application/json' }
      body = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{}'))
    }
  }
  if ($existing) {
    $saved = Invoke-PrivateApi -Uri "${jobUri}?updateMask=description,schedule,timeZone,attemptDeadline,retryConfig,httpTarget" -Method Patch -Payload $payload
    if ($saved.state -eq 'PAUSED') { $saved = Invoke-PrivateApi -Uri "${jobUri}:resume" -Method Post -Payload @{} }
  } else {
    $saved = Invoke-PrivateApi -Uri "https://cloudscheduler.googleapis.com/v1/$parent/jobs" -Method Post -Payload $payload
  }
  [PSCustomObject]@{
    Job = $saved.name; State = $saved.state; Schedule = $saved.schedule
    Timezone = $saved.timeZone; Endpoint = $saved.httpTarget.uri; Deadline = $saved.attemptDeadline
    SecretReference = "$secretResource/versions/$($reference.key)"
  } | ConvertTo-Json
} finally {
  $script:setupToken = $null
  $workerSecret = $null
  $secretResult = $null
  $payload = $null
  $saved = $null
  $existing = $null
}
