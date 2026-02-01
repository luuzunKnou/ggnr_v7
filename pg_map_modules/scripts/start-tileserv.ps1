# pg_tileserv 실행 스크립트
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$moduleRoot = Split-Path -Parent $scriptDir
$projectRoot = Split-Path -Parent $moduleRoot
$servicesDir = Join-Path $moduleRoot "services"
$tileservDir = Join-Path $servicesDir "pg_tileserv"
$tileservExe = Join-Path $tileservDir "pg_tileserv.exe"
$configFile = Join-Path $servicesDir "pg_tileserv.toml"

# .env.local에서 DB 정보 읽기 및 DATABASE_URL 생성
$envFile = Join-Path $projectRoot ".env.local"
$dbHost = "localhost"
$dbPort = "5432"
$dbName = "postgres"
$dbUser = "postgres"
$dbPassword = "postgres"

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^#][^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            
            switch ($key) {
                "DATABASE_HOST" { $dbHost = $value }
                "DATABASE_PORT" { $dbPort = $value }
                "DATABASE_NAME" { $dbName = $value }
                "DATABASE_USER" { $dbUser = $value }
                "DATABASE_PASSWORD" { $dbPassword = $value }
                "DATABASE_URL" { 
                    # DATABASE_URL이 직접 설정되어 있으면 사용
                    [Environment]::SetEnvironmentVariable("DATABASE_URL", $value, "Process")
                    return
                }
            }
        }
    }
    
    # DATABASE_URL이 설정되지 않았으면 개별 변수들로부터 생성
    if (-not [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")) {
        $databaseUrl = "postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}"
        [Environment]::SetEnvironmentVariable("DATABASE_URL", $databaseUrl, "Process")
        Write-Host "DATABASE_URL이 .env.local의 DB 정보로 설정되었습니다." -ForegroundColor Yellow
    }
}

if (-not (Test-Path $tileservExe)) {
    Write-Host "pg_tileserv가 설치되지 않았습니다. 수동으로 설치해주세요." -ForegroundColor Red
    exit 1
}

Write-Host "pg_tileserv를 시작합니다..." -ForegroundColor Green
Write-Host "서비스 URL: http://localhost:7800" -ForegroundColor Cyan

if (Test-Path $configFile) {
    & $tileservExe --config $configFile
} else {
    & $tileservExe
}
