# pg_tileserv와 pg_featureserv 설치 스크립트
# PowerShell에서 실행: .\pg_map_modules\scripts\install-pg-services.ps1

$ErrorActionPreference = "Stop"

Write-Host "pg_tileserv 및 pg_featureserv 설치를 시작합니다..." -ForegroundColor Green

# 서비스 디렉토리 경로
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$moduleRoot = Split-Path -Parent $scriptDir
$servicesDir = Join-Path $moduleRoot "services"

if (-not (Test-Path $servicesDir)) {
    New-Item -ItemType Directory -Path $servicesDir | Out-Null
    Write-Host "서비스 디렉토리 생성: $servicesDir" -ForegroundColor Yellow
}

# pg_tileserv 다운로드 및 설치
Write-Host "`npg_tileserv 다운로드 중..." -ForegroundColor Cyan
$tileservUrl = "https://postgisftw.s3.amazonaws.com/pg_tileserv_latest_windows.zip"
$tileservZip = "$servicesDir\pg_tileserv.zip"
$tileservDir = Join-Path $servicesDir "pg_tileserv"

try {
    Invoke-WebRequest -Uri $tileservUrl -OutFile $tileservZip
    Write-Host "다운로드 완료" -ForegroundColor Green
    
    if (Test-Path $tileservDir) {
        Remove-Item -Recurse -Force $tileservDir
    }
    Expand-Archive -Path $tileservZip -DestinationPath $tileservDir -Force
    Remove-Item $tileservZip
    Write-Host "pg_tileserv 설치 완료: $tileservDir" -ForegroundColor Green
} catch {
    Write-Host "pg_tileserv 다운로드 실패: $_" -ForegroundColor Red
    exit 1
}

# pg_featureserv 다운로드 및 설치
Write-Host "`npg_featureserv 다운로드 중..." -ForegroundColor Cyan
$featureservUrl = "https://postgisftw.s3.amazonaws.com/pg_featureserv_latest_windows.zip"
$featureservZip = "$servicesDir\pg_featureserv.zip"
$featureservDir = Join-Path $servicesDir "pg_featureserv"

try {
    Invoke-WebRequest -Uri $featureservUrl -OutFile $featureservZip
    Write-Host "다운로드 완료" -ForegroundColor Green
    
    if (Test-Path $featureservDir) {
        Remove-Item -Recurse -Force $featureservDir
    }
    Expand-Archive -Path $featureservZip -DestinationPath $featureservDir -Force
    Remove-Item $featureservZip
    Write-Host "pg_featureserv 설치 완료: $featureservDir" -ForegroundColor Green
} catch {
    Write-Host "pg_featureserv 다운로드 실패: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`n설치가 완료되었습니다!" -ForegroundColor Green
Write-Host "다음 단계:" -ForegroundColor Yellow
Write-Host "1. .env.local 파일에 DATABASE_URL을 설정하세요" -ForegroundColor Yellow
Write-Host "2. npm run tileserv 또는 npm run featureserv로 서비스를 실행하세요" -ForegroundColor Yellow
