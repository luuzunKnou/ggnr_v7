# ggnr_start.bat 기동 스모크: 기동 확인 후 프로세스 트리·GeoServer 종료
# 사용: powershell -NoProfile -File smoke_ggnr_start.ps1 -StartBat "..." -Root "..."
#
# GeoServer: npm run start → ensureGeoServer → start-geoserver.bat (detached).
# 부모 트리 taskkill 로도 대부분 같이 죽지만, 보장을 위해 stop-geoserver.bat + 8080 정리를 명시 호출함.
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
foreach ($f in @($logOut, $logErr)) {
  if (Test-Path -LiteralPath $f) {
    Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
  }
}

function Write-Smoke([string]$Message) {
  Write-Host "[smoke] $Message"
}

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  Write-Smoke "[오류] 포트 $Port 이 이미 사용 중입니다. 기존 서버를 종료한 뒤 다시 시도하세요."
  exit 2
}

if (-not (Test-Path -LiteralPath $StartBat)) {
  Write-Smoke "[오류] 없음: $StartBat"
  exit 1
}

Write-Smoke "기동 시작: $StartBat"
Write-Smoke "대기 한도 ${TimeoutSec}초 · Next 포트 $Port · GeoServer 포트 $GeoPort"
Write-Smoke "로그 out=$logOut"
Write-Smoke "로그 err=$logErr"

$p = Start-Process -FilePath 'cmd.exe' `
  -ArgumentList @('/c', 'call', "`"$StartBat`"") `
  -WorkingDirectory $Root `
  -RedirectStandardOutput $logOut `
  -RedirectStandardError $logErr `
  -PassThru `
  -WindowStyle Hidden

Write-Smoke "테스트 프로세스 PID=$($p.Id)"

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

function Get-SmokeLogTail([int]$Lines = 2) {
  $tail = @()
  foreach ($f in @($logOut, $logErr)) {
    if (Test-Path -LiteralPath $f) {
      $lines = @(Get-Content -LiteralPath $f -Tail $Lines -ErrorAction SilentlyContinue)
      if ($lines.Count -gt 0) { $tail += $lines }
    }
  }
  if ($tail.Count -eq 0) { return '(로그 아직 없음)' }
  return (($tail | Select-Object -Last $Lines) -join ' | ')
}

function Stop-ProcessTreeHard([int]$ProcId) {
  if ($ProcId -le 0) { return }
  # /T = 자식 포함 (npm→node→next 등). GeoServer detached 는 아래에서 별도 정리.
  & taskkill.exe /PID $ProcId /T /F 2>$null | Out-Null
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

$ok = $false
$startedAt = Get-Date
$deadline = $startedAt.AddSeconds($TimeoutSec)
$lastProgressAt = $startedAt
$progressEverySec = 5

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
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

Write-Smoke "테스트 프로세스·자식 종료 (taskkill /T)..."
if ($p -and -not $p.HasExited) {
  Stop-ProcessTreeHard -ProcId $p.Id
} elseif ($p) {
  # 이미 종료했어도 잔여 자식 대비
  Stop-ProcessTreeHard -ProcId $p.Id
}
Start-Sleep -Seconds 2

$left = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($left) {
  $left | ForEach-Object {
    Write-Smoke "Next 포트 $Port 잔여 PID=$($_.OwningProcess) 종료"
    & taskkill.exe /PID $_.OwningProcess /T /F 2>$null | Out-Null
  }
  Start-Sleep -Seconds 1
}

Stop-SmokeGeoServer

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
  exit 1
}

Write-Smoke '기동 확인 후 Next·GeoServer 정리 완료'
exit 0
