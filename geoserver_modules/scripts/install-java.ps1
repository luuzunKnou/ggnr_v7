# Java 17 (Adoptium Temurin) portable 설치 스크립트
# 프로젝트 내 geoserver_modules/java 에 설치 (관리자 권한 불필요)

$ErrorActionPreference = "Stop"

Write-Host "Java 17 (Adoptium Temurin) install starting..." -ForegroundColor Green

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$moduleRoot = Split-Path -Parent $scriptDir
$projectRoot = Split-Path -Parent $moduleRoot
$javaDir = Join-Path $moduleRoot "java"

# 이미 설치되어 있는지 확인
$existingJava = Get-ChildItem $javaDir -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName "bin\java.exe") } | Select-Object -First 1
if ($existingJava) {
    Write-Host "Java is already installed at: $($existingJava.FullName)" -ForegroundColor Cyan
    exit 0
}

# Adoptium API에서 다운로드 URL 조회
Write-Host "Fetching download URL from Adoptium API..." -ForegroundColor Cyan
try {
    $apiUrl = "https://api.adoptium.net/v3/assets/feature_releases/17/ga?os=windows&architecture=x64&image_type=jdk&project=jdk&jvm_impl=hotspot"
    $response = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing -TimeoutSec 30
    $downloadUrl = $response[0].binary.package.link
    if (-not $downloadUrl) {
        throw "Could not get download URL from API"
    }
} catch {
    Write-Host "API failed, using fallback URL..." -ForegroundColor Yellow
    $downloadUrl = "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.16%2B8/OpenJDK17U-jdk_x64_windows_hotspot_17.0.16_8.zip"
}

$javaZip = Join-Path $env:TEMP "temurin17-jdk.zip"
$extractTemp = Join-Path $env:TEMP "temurin17-extract"

try {
    Write-Host "Downloading Java 17 (~180MB)..." -ForegroundColor Cyan
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $downloadUrl -OutFile $javaZip -UseBasicParsing -TimeoutSec 600

    if (-not (Test-Path $javaZip) -or (Get-Item $javaZip).Length -lt 50000000) {
        throw "Download failed or file too small"
    }
    Write-Host "Download complete" -ForegroundColor Green

    if (Test-Path $javaDir) { Remove-Item -Recurse -Force $javaDir }
    if (Test-Path $extractTemp) { Remove-Item -Recurse -Force $extractTemp }
    New-Item -ItemType Directory -Path $extractTemp -Force | Out-Null

    Write-Host "Extracting..." -ForegroundColor Cyan
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($javaZip, $extractTemp)

    $items = Get-ChildItem $extractTemp -Force
    $jdkFolder = $items | Where-Object { $_.PSIsContainer -and $_.Name -match '^jdk-' } | Select-Object -First 1
    if (-not $jdkFolder) {
        $jdkFolder = $items | Where-Object { $_.PSIsContainer } | Select-Object -First 1
    }

    if ($jdkFolder) {
        New-Item -ItemType Directory -Path $javaDir -Force | Out-Null
        Move-Item -Path $jdkFolder.FullName -Destination (Join-Path $javaDir $jdkFolder.Name)
        Write-Host "Java installed: $javaDir\$($jdkFolder.Name)" -ForegroundColor Green
    } else {
        throw "Could not find JDK folder in archive"
    }

    Remove-Item $javaZip -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $extractTemp -ErrorAction SilentlyContinue
} catch {
    Write-Host "Java install failed: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Install complete!" -ForegroundColor Green
