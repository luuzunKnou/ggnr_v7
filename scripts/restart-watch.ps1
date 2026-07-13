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

$SignalPath = Join-Path $RepoRoot ".cursor-runtime\restart-request.json"
$NpmCommand = "npm run dev -- $Project $Type"

function Get-RestartSignal {
  if (-not (Test-Path -LiteralPath $SignalPath)) {
    return $null
  }
  try {
    return (Get-Content -LiteralPath $SignalPath -Raw -Encoding UTF8 | ConvertFrom-Json)
  } catch {
    Write-Host "WARNING: restart-request.json 파싱 실패 — $($_.Exception.Message)"
    return $null
  }
}

function Enter-RepoRoot {
  Set-Location -LiteralPath $RepoRoot
  $cwd = (Get-Location).Path
  if ($cwd -ne $RepoRoot) {
    Write-Host "ERROR: 작업 폴더 이동 실패. 기대=$RepoRoot, 현재=$cwd"
    exit 1
  }
}

Enter-RepoRoot
Write-Host "감시 시작 (프로젝트 루트): $RepoRoot"
Write-Host "현재 작업 폴더: $((Get-Location).Path)"
Write-Host "신호 파일: $SignalPath"
Write-Host "실행 명령: $NpmCommand"
Write-Host "규칙: restartMode=exit 일 때만 이 창에서 재기동합니다."
Write-Host ""

while ($true) {
  Enter-RepoRoot
  Write-Host "시작 (cwd=$((Get-Location).Path)): $NpmCommand"
  npm run dev -- $Project $Type
  $code = $LASTEXITCODE
  Write-Host "종료 감지 (exitCode=$code)."

  $signal = Get-RestartSignal
  if ($null -eq $signal) {
    Write-Host "restart-request.json 없음/읽기 실패 — PowerShell 재시작 안 함. 감시 종료."
    break
  }

  $mode = [string]$signal.restartMode
  $requested = $false
  if ($null -ne $signal.restartRequested) {
    $requested = [bool]$signal.restartRequested
  }

  Write-Host "신호: restartRequested=$requested, restartMode=$mode"

  if ($mode -eq "exit" -and $requested) {
    Write-Host "process.exit 재시작 — ${DelaySec}초 후 PowerShell이 다시 실행합니다..."
    Start-Sleep -Seconds $DelaySec
    continue
  }

  Write-Host "exit 재시작 아님 (restartRequested=$requested, restartMode=$mode) — 감시 종료."
  break
}
