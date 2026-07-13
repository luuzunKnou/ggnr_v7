# process.exit 재시작 전용 감시 루프
# - restartMode=exit 일 때만 이 창에서 npm 재실행
# - command / none / 그 외는 이 스크립트 관여 대상이 아님 (감시 종료만)
#
# 「명령 실행 재시작(GGNR_RESTART_COMMAND)」은 sourceVersionService가
# 새 창 기동·기존 콘솔 종료를 담당한다. 이 스크립트를 쓰지 않는다.
#
# npm / 감시 명령은 항상 프로젝트 루트(이 스크립트의 상위 폴더)에서 실행됩니다.
# 현재 디렉터리와 무관하게 스크립트 경로만으로 루트를 잡습니다.
#
# 실행 예 (어느 폴더에서든):
#   powershell -NoProfile -ExecutionPolicy Bypass -File D:\ggnr_v7\scripts\restart-watch.ps1 -Project build_yy -Type dev
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\restart-watch.ps1 -Project build_yy -Type demo
#
# 루트를 직접 지정할 때:
#   ...\restart-watch.ps1 -Project build_yy -Type prod -RepoRoot D:\ggnr_v7

param(
  [Parameter(Mandatory = $true)][string]$Project,
  [Parameter(Mandatory = $true)][string]$Type,
  [string]$RepoRoot = "",
  [int]$DelaySec = 2
)

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
} else {
  $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}

$PackageJson = Join-Path $RepoRoot "package.json"
if (-not (Test-Path -LiteralPath $PackageJson)) {
  Write-Host "ERROR: 프로젝트 루트가 아닙니다. package.json 없음: $RepoRoot"
  exit 1
}

$RuntimeDir = Join-Path $RepoRoot ".cursor-runtime"
$SignalPath = Join-Path $RuntimeDir "restart-request.json"
$LogPath = Join-Path $RuntimeDir "restart-watch.log"
$NpmCommand = "npm run dev -- $Project $Type"
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
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  } catch {
    # 파일 기록 실패해도 화면 로그는 유지
  }
}

function Get-RestartSignal {
  if (-not (Test-Path -LiteralPath $SignalPath)) {
    return $null
  }
  try {
    return (Get-Content -LiteralPath $SignalPath -Raw -Encoding UTF8 | ConvertFrom-Json)
  } catch {
    Write-WatchLog "restart-request.json 파싱 실패 — $($_.Exception.Message)" "WARN"
    return $null
  }
}

function Enter-RepoRoot {
  Set-Location -LiteralPath $RepoRoot
  $cwd = (Get-Location).Path
  if ($cwd -ne $RepoRoot) {
    Write-WatchLog "작업 폴더 이동 실패. 기대=$RepoRoot, 현재=$cwd" "ERROR"
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
Write-Banner "감시 시작 (process.exit 재시작 전용)"
Write-WatchLog "프로젝트 루트: $RepoRoot"
Write-WatchLog "현재 작업 폴더: $((Get-Location).Path)"
Write-WatchLog "신호 파일: $SignalPath"
Write-WatchLog "로그 파일: $LogPath"
Write-WatchLog "실행 명령: $NpmCommand"
Write-WatchLog "규칙: restartMode=exit 일 때만 이 창에서 재기동합니다."
Write-Host ""

while ($true) {
  Enter-RepoRoot
  $RunCount += 1
  $startedAt = Get-Date

  if ($null -ne $LastRestartAt) {
    $gapSec = [math]::Round(($startedAt - $LastRestartAt).TotalSeconds, 1)
    Write-Banner "기동 #$RunCount (재시작) — 이전 종료 후 ${gapSec}초 경과"
    Write-WatchLog "재기동 확인: 서버를 다시 시작합니다. (회차=$RunCount)" "OK"
  } else {
    Write-Banner "기동 #$RunCount (최초)"
  }

  Write-WatchLog "cwd=$((Get-Location).Path) → $NpmCommand"
  Write-WatchLog "npm 프로세스 시작 대기 중... (종료되면 아래 '종료 감지'가 찍힙니다)"

  npm run dev -- $Project $Type
  $code = $LASTEXITCODE
  $endedAt = Get-Date
  $aliveSec = [math]::Round(($endedAt - $startedAt).TotalSeconds, 1)

  Write-Banner "종료 감지 #$RunCount"
  Write-WatchLog "exitCode=$code, 가동시간=${aliveSec}초 (시작=$($startedAt.ToString('HH:mm:ss')) ~ 종료=$($endedAt.ToString('HH:mm:ss')))"

  $signal = Get-RestartSignal
  if ($null -eq $signal) {
    Write-WatchLog "restart-request.json 없음/읽기 실패 — 재시작 안 함. 감시 종료." "WARN"
    Write-WatchLog "결과: 껐지만 다시 켜지 않음 (신호 없음)." "WARN"
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

  Write-WatchLog "신호 읽음: restartRequested=$requested, restartMode=$mode"
  if ($sigAt) { Write-WatchLog "신호 at=$sigAt, version=$sigVer, by=$sigBy, source=$sigSource" }

  if ($mode -eq "exit" -and $requested) {
    Write-WatchLog "판정: process.exit 재시작 → ${DelaySec}초 대기 후 같은 창에서 다시 기동합니다." "OK"
    Write-WatchLog "대기 시작 (${DelaySec}초)..."
    Start-Sleep -Seconds $DelaySec
    $LastRestartAt = Get-Date
    Write-WatchLog "대기 종료. 재기동 루프로 진입합니다. (다음 회차=$($RunCount + 1))" "OK"
    continue
  }

  Write-WatchLog "판정: exit 재시작 아님 (restartRequested=$requested, restartMode=$mode) — 감시 종료." "WARN"
  Write-WatchLog "결과: 껐지만 이 스크립트는 다시 켜지 않음. (command/none 등은 각자 방식)" "WARN"
  break
}

Write-Host ""
Write-Banner "감시 종료"
Write-WatchLog "총 기동 회차=$RunCount. 로그 파일: $LogPath"
Write-Host ""
