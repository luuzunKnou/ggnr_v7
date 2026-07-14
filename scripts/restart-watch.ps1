# process.exit restart watcher (exit mode only)
# - restartMode=exit: re-run npm in this window
# - command / none / other: not handled here (watcher exits)
#
# Command-mode restart is handled by sourceVersionService
# (builds restart-watch / npm from GGNR_PROJECT + GGNR_ENV; new console + close old).
# Do not use this script for command mode itself - it is what command mode re-launches.
#
# Always runs npm from repo root (parent of scripts/), regardless of cwd.
# App start command reuse:
#   -NpmScript / GGNR_RUN_SCRIPT / restart-request.json .boot → else "dev"
#
# Examples:
#   powershell ...\restart-watch.ps1 -Project build_yy -Type dev
#   powershell ...\restart-watch.ps1 -Project build_yy -Type prod -NpmScript start
#
# Optional root override:
#   ...\restart-watch.ps1 -Project build_yy -Type prod -RepoRoot D:\ggnr_v7
#
# Logs are English/ASCII only (avoids Windows console encoding issues).

param(
  [Parameter(Mandatory = $true)][string]$Project,
  [Parameter(Mandatory = $true)][string]$Type,
  [string]$RepoRoot = "",
  [string]$NpmScript = "",
  [int]$DelaySec = 2
)

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
} else {
  $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}

$PackageJson = Join-Path $RepoRoot "package.json"
if (-not (Test-Path -LiteralPath $PackageJson)) {
  Write-Host "ERROR: Not a project root (package.json missing): $RepoRoot"
  exit 1
}

$RuntimeDir = Join-Path $RepoRoot ".cursor-runtime"
$SignalPath = Join-Path $RuntimeDir "restart-request.json"
$LogPath = Join-Path $RuntimeDir "restart-watch.log"

# Prefer: -NpmScript → GGNR_RUN_SCRIPT → restart-request.json .boot → "dev"
if (-not $NpmScript -or -not $NpmScript.Trim()) {
  if ($env:GGNR_RUN_SCRIPT -and ($env:GGNR_RUN_SCRIPT.Trim() -eq "dev" -or $env:GGNR_RUN_SCRIPT.Trim() -eq "start")) {
    $NpmScript = $env:GGNR_RUN_SCRIPT.Trim()
  } elseif (Test-Path -LiteralPath $SignalPath) {
    try {
      $bootSignal = Get-Content -LiteralPath $SignalPath -Raw -Encoding utf8 | ConvertFrom-Json
      $bootObj = $bootSignal.boot
      if ($bootObj -and ($bootObj.npmScript -eq "dev" -or $bootObj.npmScript -eq "start")) {
        $NpmScript = [string]$bootObj.npmScript
      } elseif ($bootSignal.npmScript -eq "dev" -or $bootSignal.npmScript -eq "start") {
        $NpmScript = [string]$bootSignal.npmScript
      }
    } catch {
    }
  }
}
if (-not $NpmScript -or -not $NpmScript.Trim()) {
  $NpmScript = "dev"
}
$NpmScript = $NpmScript.Trim()
if ($NpmScript -ne "dev" -and $NpmScript -ne "start") {
  Write-Host "ERROR: NpmScript must be 'dev' or 'start' (got: $NpmScript)"
  exit 1
}

$NpmCommand = "npm run $NpmScript -- $Project $Type"
$AppPort = if ($env:PORT -and $env:PORT.Trim()) { [int]$env:PORT } else { 3000 }
$RunCount = 0
$LastRestartAt = $null

function Write-WatchLog {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [ValidateSet("INFO", "OK", "WARN", "ERROR", "STEP")]
    [string]$Level = "INFO"
  )
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$ts] [$Level] $Message"
  switch ($Level) {
    "OK"    { Write-Host $line -ForegroundColor Green }
    "WARN"  { Write-Host $line -ForegroundColor Yellow }
    "ERROR" { Write-Host $line -ForegroundColor Red }
    "STEP"  { Write-Host $line -ForegroundColor Cyan }
    default { Write-Host $line }
  }
  try {
    if (-not (Test-Path -LiteralPath $RuntimeDir)) {
      New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
    }
    Add-Content -LiteralPath $LogPath -Value $line -Encoding ascii
  } catch {
  }
}

function Test-AppPortListening {
  param([int]$Port)
  $hit = netstat -ano 2>$null | Select-String -Pattern (":" + $Port + "\s") | Select-String "LISTENING"
  return [bool]$hit
}

function Invoke-ForceFreePort {
  param([int]$Port)
  Write-WatchLog "force-free-port $Port (self/parent PID protected)"
  npx --yes tsx scripts/force-free-port.ts $Port
  Start-Sleep -Seconds 1
}

function Wait-AppPortFree {
  param(
    [int]$Port,
    [int]$TimeoutSec = 90
  )
  Write-WatchLog "Waiting until port $Port is FREE (LISTENING gone)..."
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (-not (Test-AppPortListening -Port $Port)) {
      Write-WatchLog "Port $Port is FREE" "OK"
      Invoke-ForceFreePort -Port $Port
      return $true
    }
    Write-WatchLog "Port $Port still LISTENING - wait 1s"
    Start-Sleep -Seconds 1
  }
  Write-WatchLog "WARN: port $Port still busy after ${TimeoutSec}s - force-free then continue" "WARN"
  Invoke-ForceFreePort -Port $Port
  return $false
}

function Get-RestartSignal {
  if (-not (Test-Path -LiteralPath $SignalPath)) {
    return $null
  }
  try {
    return (Get-Content -LiteralPath $SignalPath -Raw -Encoding UTF8 | ConvertFrom-Json)
  } catch {
    Write-WatchLog "Failed to parse restart-request.json - $($_.Exception.Message)" "WARN"
    return $null
  }
}

function Enter-RepoRoot {
  Set-Location -LiteralPath $RepoRoot
  $cwd = (Get-Location).Path
  if ($cwd -ne $RepoRoot) {
    Write-WatchLog "Failed to cd into repo. expected=$RepoRoot current=$cwd" "ERROR"
    exit 1
  }
}

function Write-Banner {
  param([string]$Title)
  Write-Host ""
  Write-Host ("=" * 72) -ForegroundColor DarkGray
  Write-WatchLog $Title "STEP"
  Write-Host ("=" * 72) -ForegroundColor DarkGray
}

Enter-RepoRoot
Write-Banner "Watch started (process.exit restart only)"
Write-WatchLog "Repo root: $RepoRoot"
Write-WatchLog "cwd: $((Get-Location).Path)"
Write-WatchLog "Signal file: $SignalPath"
Write-WatchLog "Log file: $LogPath"
Write-WatchLog "Command: $NpmCommand"
Write-WatchLog "Expected app port: $AppPort (PORT env or 3000)"
Write-WatchLog "Rule: only restartMode=exit restarts in this window."
Write-Host ""

while ($true) {
  Enter-RepoRoot
  $RunCount += 1
  $startedAt = Get-Date

  if ($null -ne $LastRestartAt) {
    $gapSec = [math]::Round(($startedAt - $LastRestartAt).TotalSeconds, 1)
    Write-Banner "Start #$RunCount (restart) - ${gapSec}s after previous exit"
    Write-WatchLog "Restart confirmed: starting server again. (run=$RunCount)" "OK"
    Wait-AppPortFree -Port $AppPort | Out-Null
  } else {
    Write-Banner "Start #$RunCount (first)"
    if (Test-AppPortListening -Port $AppPort) {
      Write-WatchLog "WARN: port $AppPort already LISTENING before start" "WARN"
    } else {
      Write-WatchLog "Port $AppPort is free before first start" "OK"
    }
  }

  Write-WatchLog "cwd=$((Get-Location).Path) -> $NpmCommand"
  Write-WatchLog "Starting app (expected listen port=$AppPort)"
  Write-WatchLog "Waiting for npm process... (exit will print Exit detected below)"

  npm run $NpmScript -- $Project $Type
  $code = $LASTEXITCODE
  $endedAt = Get-Date
  $aliveSec = [math]::Round(($endedAt - $startedAt).TotalSeconds, 1)

  Write-Banner "Exit detected #$RunCount"
  Write-WatchLog "exitCode=$code uptime=${aliveSec}s (start=$($startedAt.ToString('HH:mm:ss')) end=$($endedAt.ToString('HH:mm:ss')))"
  if (Test-AppPortListening -Port $AppPort) {
    Write-WatchLog "Port $AppPort still LISTENING right after process exit" "WARN"
  } else {
    Write-WatchLog "Port $AppPort released after process exit" "OK"
  }

  $signal = Get-RestartSignal
  if ($null -eq $signal) {
    Write-WatchLog "No/invalid restart-request.json - will not restart. Stopping watch." "WARN"
    Write-WatchLog "Result: stopped, not restarted (no signal)." "WARN"
    break
  }

  $mode = [string]$signal.restartMode
  $requested = $false
  if ($null -ne $signal.restartRequested) {
    $requested = [bool]$signal.restartRequested
  }
  $sigAt = [string]$signal.at
  $sigVer = [string]$signal.version
  $sigBy = [string]$signal.requestedBy
  $sigSource = [string]$signal.source

  Write-WatchLog "Signal: restartRequested=$requested restartMode=$mode"
  if ($sigAt) { Write-WatchLog "Signal at=$sigAt version=$sigVer by=$sigBy source=$sigSource" }

  if ($mode -eq "exit" -and $requested) {
    Write-WatchLog "Decision: process.exit restart - wait ${DelaySec}s then pipeline then start again." "OK"
    Write-WatchLog "Waiting ${DelaySec}s..."
    Start-Sleep -Seconds $DelaySec
    Wait-AppPortFree -Port $AppPort | Out-Null

    $runNpm = $false
    if ($null -ne $signal.runNpmInstallBefore) { $runNpm = [bool]$signal.runNpmInstallBefore }
    $runBuild = $true
    if ($null -ne $signal.runBuild) { $runBuild = [bool]$signal.runBuild }
    $startGeo = $false
    if ($null -ne $signal.startGeoServerAfter) { $startGeo = [bool]$signal.startGeoServerAfter }

    if ($runNpm) {
      Write-WatchLog "Running npm install --no-audit --no-fund"
      npm install --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) {
        Write-WatchLog "npm install FAILED exit=$LASTEXITCODE" "ERROR"
        exit $LASTEXITCODE
      }
    }
    if ($runBuild) {
      Write-WatchLog "Running npm run build (app stopped)"
      npm run build
      if ($LASTEXITCODE -ne 0) {
        Write-WatchLog "npm run build FAILED exit=$LASTEXITCODE" "ERROR"
        exit $LASTEXITCODE
      }
      Write-WatchLog "npm run build OK" "OK"
    }
    if ($startGeo) {
      Write-WatchLog "Ensuring GeoServer (npx tsx scripts/ensure-geoserver.ts)"
      npx --yes tsx scripts/ensure-geoserver.ts
      if ($LASTEXITCODE -ne 0) {
        Write-WatchLog "WARN: ensure-geoserver exit=$LASTEXITCODE (continuing)" "WARN"
      }
    }

    # Clear one-shot flags so a later exit mode is not blocked by stale command/consumed state
    try {
      $signal.restartRequested = $false
      $signal.launcherConsumed = $false
      if ($signal.PSObject.Properties.Name -contains "launcherConsumedAt") {
        $signal.PSObject.Properties.Remove("launcherConsumedAt")
      }
      ($signal | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $SignalPath -Encoding utf8
      Write-WatchLog "Cleared restartRequested after exit pipeline" "OK"
    } catch {
      Write-WatchLog "WARN: failed to clear restart signal: $($_.Exception.Message)" "WARN"
    }

    $LastRestartAt = Get-Date
    Write-WatchLog "Pipeline done. Entering restart loop. (next run=$($RunCount + 1))" "OK"
    continue
  }

  if ($mode -eq "command") {
    Write-WatchLog "Decision: restartMode=command — one-shot apply already handled elsewhere; stop watch (not an error)." "OK"
    Write-WatchLog "Result: stopped after command-mode signal (use exit/startB/launcher for supervised restart)." "OK"
    break
  }

  Write-WatchLog "Decision: not exit restart (restartRequested=$requested restartMode=$mode) - stop watch." "WARN"
  Write-WatchLog "Result: stopped; this script will not restart (command/none use other paths)." "WARN"
  break
}

Write-Host ""
Write-Banner "Watch stopped"
Write-WatchLog "Total runs=$RunCount. Log file: $LogPath"
Write-Host ""
