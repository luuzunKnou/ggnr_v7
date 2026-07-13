# process.exit 재시작 전용 감시 루프
# - restartMode=exit 일 때만 npm 재실행
# - restartMode=command 이면 GGNR_RESTART_COMMAND에 맡기고 PowerShell은 재시작하지 않음
#
# 실행 위치: 이 스크립트의 바로 상위 폴더(= 저장소 루트). 상위 폴더 이름은 상관없음.
#   cd <저장소루트>
#   .\scripts\restart-watch.ps1 -Project build_yy -Type dev
#
# RepoRoot 는 스크립트 위치(scripts/)의 상위 폴더로 자동 결정됩니다.
#   .\scripts\restart-watch.ps1 -Project build_yy -Type demo
#   .\scripts\restart-watch.ps1 -Project river_yd -Type prod

param(
  [Parameter(Mandatory = $true)][string]$Project,
  [Parameter(Mandatory = $true)][string]$Type,
  [string]$RepoRoot = "",
  [int]$DelaySec = 2,
  [int]$PollSec = 2
)

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$SignalPath = Join-Path $RepoRoot ".cursor-runtime\restart-request.json"

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

Set-Location -LiteralPath $RepoRoot
Write-Host "감시 시작: $RepoRoot"
Write-Host "신호 파일: $SignalPath"
Write-Host "명령: npm run dev -- $Project $Type"
Write-Host "규칙: restartMode=exit 일 때만 PowerShell이 재기동합니다."
Write-Host ""

while ($true) {
  Write-Host "시작: npm run dev -- $Project $Type"
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

  if ($mode -eq "command" -and $requested) {
    Write-Host "명령 실행 재시작 — PowerShell은 재시작하지 않습니다. (GGNR_RESTART_COMMAND 담당)"
    Write-Host "다음 적용에서 restartMode=exit 가 될 때까지 대기합니다. (Ctrl+C 종료)"
    while ($true) {
      Start-Sleep -Seconds $PollSec
      $next = Get-RestartSignal
      if ($null -eq $next) { continue }
      $nextMode = [string]$next.restartMode
      $nextReq = $false
      if ($null -ne $next.restartRequested) {
        $nextReq = [bool]$next.restartRequested
      }
      if ($nextMode -eq "exit" -and $nextReq) {
        Write-Host "exit 신호 감지 — ${DelaySec}초 대기 후 PowerShell이 기동합니다..."
        Start-Sleep -Seconds $DelaySec
        break
      }
    }
    continue
  }

  Write-Host "재시작 대상 아님 (restartRequested=$requested, restartMode=$mode) — 감시 종료."
  break
}
