# 스모크/기동 잔여 프로세스 수동 정리 (콘솔 강제 종료 후 폴더 삭제 전 등)
# 사용: powershell -NoProfile -File smoke_ggnr_cleanup.ps1 -Root "C:\path\to\install" [-Port 3000] [-GeoPort 8080]
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [int]$Port = 3000,
  [int]$GeoPort = 8080
)

$ErrorActionPreference = 'Continue'

function Write-Cleanup([string]$Message) {
  Write-Host "[cleanup] $Message"
}

function Stop-PortListeners([int]$ListenPort) {
  $conns = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) {
    Write-Cleanup "포트 $ListenPort Listen 없음"
    return
  }
  $pids = @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($ownPid in $pids) {
    if ($ownPid -le 0) { continue }
    Write-Cleanup "포트 $ListenPort 점유 PID=$ownPid 종료"
    & taskkill.exe /PID $ownPid /T /F 2>$null | Out-Null
  }
}

Write-Cleanup "Root=$Root · Next 포트 $Port · GeoServer 포트 $GeoPort"

Stop-PortListeners -ListenPort $Port

$stopBat = Join-Path $Root 'geoserver_modules\scripts\stop-geoserver.bat'
if (Test-Path -LiteralPath $stopBat) {
  Write-Cleanup "GeoServer 중지 스크립트 실행..."
  $sp = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList @('/c', 'call', "`"$stopBat`"") `
    -WorkingDirectory $Root `
    -Wait `
    -PassThru `
    -WindowStyle Hidden
  Write-Cleanup "GeoServer stop exit=$($sp.ExitCode)"
} else {
  Write-Cleanup "GeoServer stop bat 없음 — 포트 $GeoPort 만 정리"
}

Stop-PortListeners -ListenPort $GeoPort
Start-Sleep -Seconds 1

Write-Cleanup '정리 완료. 설치 폴더 삭제를 다시 시도하세요.'
exit 0
