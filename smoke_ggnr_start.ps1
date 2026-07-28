# ggnr_start.bat 기동 스모크: 기동 확인 후 프로세스 트리·GeoServer 종료
# 사용: powershell -NoProfile -File smoke_ggnr_start.ps1 -StartBat "..." -Root "..."
#
# GeoServer: npm run start → ensureGeoServer → start-geoserver.bat (detached).
# 부모 트리 taskkill 로도 대부분 같이 죽지만, 보장을 위해 stop-geoserver.bat + 8080 정리를 명시 호출함.
# Ctrl+C / 예외 시에도 try/finally · CancelKeyPress 로 동일 정리 수행.
# CMD가 프로세스를 강제 종료해도 감시 프로세스가 포트를 한 번 더 정리함.
param(
  [Parameter(Mandatory = $true)][string]$StartBat,
  [Parameter(Mandatory = $true)][string]$Root,
  [int]$Port = 3000,
  [int]$TimeoutSec = 180,
  [int]$GeoPort = 8080
)

$ErrorActionPreference = 'Continue'
$logOut = Join-Path $env:TEMP 'ggnr_start_smoke.out.log'
$logErr = Join-Path $env:TEMP 'ggnr_start_smoke.err.log'
$cleanupPs1 = Join-Path $PSScriptRoot 'smoke_ggnr_cleanup.ps1'
foreach ($f in @($logOut, $logErr)) {
  if (Test-Path -LiteralPath $f) {
    Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
  }
}

$script:smokeCleaned = $false
$script:smokeCancelled = $false
$script:smokeProc = $null
$script:watchdogProc = $null
$script:smokeLockPath = Join-Path $env:TEMP ("ggnr_smoke_lock_{0}.txt" -f $PID)

function Write-Smoke([string]$Message) {
  Write-Host "[smoke] $Message"
}

function Get-SmokeLogText {
  $parts = @()
  foreach ($f in @($logOut, $logErr)) {
    if (Test-Path -LiteralPath $f) {
      $t = Get-Content -LiteralPath $f -Raw -ErrorAction SilentlyContinue
      if ($t) { $parts += $t }
    }
  }
  return ($parts -join "`n")
}

function Get-SmokeLogTail([int]$LineCount = 2) {
  $tail = @()
  foreach ($f in @($logOut, $logErr)) {
    if (Test-Path -LiteralPath $f) {
      $chunk = @(Get-Content -LiteralPath $f -Tail $LineCount -ErrorAction SilentlyContinue)
      if ($chunk.Count -gt 0) { $tail += $chunk }
    }
  }
  if ($tail.Count -eq 0) { return '(로그 아직 없음)' }
  return (($tail | Select-Object -Last $LineCount) -join ' | ')
}

function Stop-ProcessTreeHard([int]$ProcId) {
  if ($ProcId -le 0) { return }
  & taskkill.exe /PID $ProcId /T /F 2>$null | Out-Null
}

function Stop-PortListeners([int]$ListenPort) {
  $conns = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) { return }
  $pids = @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($ownPid in $pids) {
    if ($ownPid -le 0) { continue }
    Write-Smoke "포트 $ListenPort 점유 PID=$ownPid 종료"
    & taskkill.exe /PID $ownPid /T /F 2>$null | Out-Null
  }
}

function Test-PortFree([int]$ListenPort) {
  -not [bool](Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue)
}

function Assert-PortsCleared {
  for ($i = 0; $i -lt 5; $i++) {
    if ((Test-PortFree -ListenPort $Port) -and (Test-PortFree -ListenPort $GeoPort)) {
      return $true
    }
    Stop-PortListeners -ListenPort $Port
    Stop-PortListeners -ListenPort $GeoPort
    Start-Sleep -Seconds 1
  }
  return ((Test-PortFree -ListenPort $Port) -and (Test-PortFree -ListenPort $GeoPort))
}

function Stop-SmokeGeoServer {
  $stopBat = Join-Path $Root 'geoserver_modules\scripts\stop-geoserver.bat'
  if (Test-Path -LiteralPath $stopBat) {
    Write-Smoke "GeoServer 중지 스크립트 실행..."
    $sp = Start-Process -FilePath 'cmd.exe' `
      -ArgumentList @('/c', 'call', "`"$stopBat`"") `
      -WorkingDirectory $Root `
      -Wait `
      -PassThru `
      -WindowStyle Hidden
    Write-Smoke "GeoServer stop exit=$($sp.ExitCode)"
  } else {
    Write-Smoke "GeoServer stop bat 없음 — 포트 $GeoPort 만 정리"
  }

  $geoListen = Get-NetTCPConnection -LocalPort $GeoPort -State Listen -ErrorAction SilentlyContinue
  if ($geoListen) {
    $geoPids = @($geoListen | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($geoPid in $geoPids) {
      Write-Smoke "GeoServer 포트 $GeoPort 점유 PID=$geoPid 종료"
      & taskkill.exe /PID $geoPid /T /F 2>$null | Out-Null
    }
    Start-Sleep -Seconds 1
  } else {
    Write-Smoke "GeoServer 포트 $GeoPort Listen 없음 (정리됨 또는 미기동)"
  }
}

function Stop-SmokeAll {
  if ($script:smokeCleaned) { return }
  $script:smokeCleaned = $true
  Write-Smoke "테스트 프로세스·자식 종료 (taskkill /T)..."
  if ($script:smokeProc) {
    Stop-ProcessTreeHard -ProcId $script:smokeProc.Id
  }
  Start-Sleep -Seconds 2
  Stop-PortListeners -ListenPort $Port
  Start-Sleep -Seconds 1
  Stop-SmokeGeoServer
}

function Clear-SmokeLock {
  if ($script:smokeLockPath -and (Test-Path -LiteralPath $script:smokeLockPath)) {
    Remove-Item -LiteralPath $script:smokeLockPath -Force -ErrorAction SilentlyContinue
  }
}

function Start-SmokeCleanupWatchdog {
  if (-not (Test-Path -LiteralPath $cleanupPs1)) { return }
  $parentPid = $PID
  $lockPath = $script:smokeLockPath
  Set-Content -LiteralPath $lockPath -Value $parentPid -Encoding ascii
  $rootLit = $Root.Replace("'", "''")
  $cleanupLit = $cleanupPs1.Replace("'", "''")
  $lockLit = $lockPath.Replace("'", "''")
  $cmd = @"
`$parent = $parentPid
while (Get-Process -Id `$parent -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 2 }
Start-Sleep -Seconds 2
if (Test-Path -LiteralPath '$lockLit') {
  & '$cleanupLit' -Root '$rootLit' -Port $Port -GeoPort $GeoPort
  Remove-Item -LiteralPath '$lockLit' -Force -ErrorAction SilentlyContinue
}
"@
  $script:watchdogProc = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd) `
    -WindowStyle Hidden `
    -PassThru
  Write-Smoke "정리 감시 PID=$($script:watchdogProc.Id) (강제 종료 시에만 포트 재정리)"
}

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  Write-Smoke "[오류] 포트 $Port 이 이미 사용 중입니다. 기존 서버를 종료한 뒤 다시 시도하세요."
  if (Test-Path -LiteralPath $cleanupPs1) {
    Write-Smoke "잔여 정리: powershell -NoProfile -File `"$cleanupPs1`" -Root `"$Root`" -Port $Port -GeoPort $GeoPort"
  }
  exit 2
}

if (-not (Test-Path -LiteralPath $StartBat)) {
  Write-Smoke "[오류] 없음: $StartBat"
  exit 1
}

$cancelHandler = [System.ConsoleCancelEventHandler]{
  param($sender, $e)
  $e.Cancel = $true
  $script:smokeCancelled = $true
  Write-Smoke "Ctrl+C — 백그라운드 프로세스 정리 중..."
  Stop-SmokeAll
}

[Console]::add_CancelKeyPress($cancelHandler)

$ok = $false
$portsCleared = $false
try {
  Write-Smoke "기동 시작: $StartBat"
  Write-Smoke "대기 한도 ${TimeoutSec}초 · Next 포트 $Port · GeoServer 포트 $GeoPort"
  Write-Smoke "로그 out=$logOut"
  Write-Smoke "로그 err=$logErr"
  Write-Smoke "취소(Ctrl+C) 시 Next·GeoServer 를 정리합니다."

  Start-SmokeCleanupWatchdog

  $p = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList @('/c', 'call', "`"$StartBat`"") `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $logOut `
    -RedirectStandardError $logErr `
    -PassThru `
    -WindowStyle Hidden
  $script:smokeProc = $p

  Write-Smoke "테스트 프로세스 PID=$($p.Id)"

  $startedAt = Get-Date
  $deadline = $startedAt.AddSeconds($TimeoutSec)
  $lastProgressAt = $startedAt
  $progressEverySec = 5

  while ((Get-Date) -lt $deadline) {
    if ($script:smokeCancelled) { break }

    Start-Sleep -Seconds 2
    if ($script:smokeCancelled) { break }

    $elapsed = [int]((Get-Date) - $startedAt).TotalSeconds

    if ($p.HasExited) {
      Write-Smoke "[오류] ggnr_start 가 조기 종료했습니다. exit=$($p.ExitCode) (${elapsed}초)"
      break
    }

    $t = Get-SmokeLogText
    $logHit = $t -and ($t -match 'Ready|Local:|started server on')
    $httpOk = $false
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) {
        $httpOk = $true
      }
    } catch {
      # 아직 listen 전
    }

    if ($logHit -or $httpOk) {
      $how = if ($httpOk) { 'HTTP' } elseif ($logHit) { '로그 Ready' } else { '확인' }
      Write-Smoke "기동 확인 OK ($how, ${elapsed}초)"
      $ok = $true
      break
    }

    if (((Get-Date) - $lastProgressAt).TotalSeconds -ge $progressEverySec) {
      $lastProgressAt = Get-Date
      $portBusy = [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
      $remain = [Math]::Max(0, $TimeoutSec - $elapsed)
      Write-Smoke "대기 중 ${elapsed}s / 남은 ~${remain}s · 포트${Port}=$portBusy · $(Get-SmokeLogTail 1)"
    }
  }
} finally {
  try { [Console]::remove_CancelKeyPress($cancelHandler) } catch { }
  Stop-SmokeAll
  $portsCleared = Assert-PortsCleared
  if (-not $portsCleared) {
    Write-Smoke "[경고] 정리 후에도 포트 $Port 또는 $GeoPort 가 사용 중일 수 있습니다."
  }
  # 정상 종료(취소·실패 포함 finally)면 감시가 추가 cleanup 하지 않도록 잠금 제거
  Clear-SmokeLock
}

if ($script:smokeCancelled) {
  Write-Smoke '[중단] 사용자 취소 — Next·GeoServer 정리 완료'
  if (Test-Path -LiteralPath $cleanupPs1) {
    Write-Smoke "폴더가 안 지워지면: powershell -NoProfile -File `"$cleanupPs1`" -Root `"$Root`" -Port $Port -GeoPort $GeoPort"
  }
  exit 130
}

if (-not $ok) {
  Write-Smoke '[오류] 기동 검사 실패 — 로그 끝부분:'
  Write-Host "  out: $logOut"
  Write-Host "  err: $logErr"
  foreach ($f in @($logOut, $logErr)) {
    if (Test-Path -LiteralPath $f) {
      Write-Host "----- $f -----"
      Get-Content -LiteralPath $f -Tail 40
    }
  }
  if (Test-Path -LiteralPath $cleanupPs1) {
    Write-Smoke "잔여 프로세스: powershell -NoProfile -File `"$cleanupPs1`" -Root `"$Root`" -Port $Port -GeoPort $GeoPort"
  }
  exit 1
}

if (-not $portsCleared) {
  Write-Smoke '[오류] 기동은 확인됐으나 정리 후 포트가 비지 않았습니다. nssm 등록 전 포트를 확인하세요.'
  if (Test-Path -LiteralPath $cleanupPs1) {
    Write-Smoke "잔여 정리: powershell -NoProfile -File `"$cleanupPs1`" -Root `"$Root`" -Port $Port -GeoPort $GeoPort"
  }
  exit 1
}

Write-Smoke '기동 확인 후 Next·GeoServer 정리 완료 (포트 비움 확인)'
exit 0
