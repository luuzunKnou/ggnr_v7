# GeoServer 설치 스크립트
# PowerShell: .\geoserver_modules\scripts\install-geoserver.ps1
# GeoServer 2.28.2 (Platform Independent Binary) - Java 17 or 21 required

$ErrorActionPreference = "Stop"

Write-Host "GeoServer install starting..." -ForegroundColor Green

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$moduleRoot = Split-Path -Parent $scriptDir
$projectRoot = Split-Path -Parent $moduleRoot
$javaDir = Join-Path $moduleRoot "java"

# Java 확인: 1) geoserver_modules/java, 2) 시스템 PATH
$javaExe = $null
$existingJava = Get-ChildItem $javaDir -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName "bin\java.exe") } | Select-Object -First 1
if ($existingJava) {
    $javaExe = Join-Path $existingJava.FullName "bin\java.exe"
}
if (-not $javaExe) {
    try {
        $null = java -version 2>&1
        $javaExe = "java"
    } catch { }
}
if (-not $javaExe) {
    Write-Host "Java not found. GeoServer requires Java 17 or 21." -ForegroundColor Red
    Write-Host "Use 'Java 설치' button in DevTest, or download: https://adoptium.net/" -ForegroundColor Yellow
    exit 1
}
Write-Host "Java OK" -ForegroundColor Cyan

$geoserverDir = Join-Path $moduleRoot "geoserver"

if (-not (Test-Path $geoserverDir)) {
    New-Item -ItemType Directory -Path $geoserverDir -Force | Out-Null
    Write-Host "Created: $geoserverDir" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "GeoServer 2.28.2 downloading (about 124MB)..." -ForegroundColor Cyan
$geoserverZip = Join-Path $env:TEMP "geoserver-2.28.2-bin.zip"

try {
    $geoserverUrlDirect = "https://sourceforge.net/projects/geoserver/files/GeoServer/2.28.2/geoserver-2.28.2-bin.zip/download"
    Write-Host "Downloading via curl..." -ForegroundColor Cyan
    Start-Process -FilePath "curl.exe" -ArgumentList "-L", "-s", "-S", "-o", $geoserverZip, $geoserverUrlDirect -Wait -PassThru -NoNewWindow | Out-Null
    if (-not (Test-Path $geoserverZip) -or (Get-Item $geoserverZip).Length -lt 50000000) {
        throw "Download failed or file too small (expected ~124MB)"
    }
    Write-Host "Download complete" -ForegroundColor Green

    if (Test-Path $geoserverDir) {
        Remove-Item -Recurse -Force $geoserverDir
    }
    Write-Host "Extracting..." -ForegroundColor Cyan
    $extractTemp = Join-Path $env:TEMP "geoserver-extract"
    if (Test-Path $extractTemp) { Remove-Item -Recurse -Force $extractTemp }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($geoserverZip, $extractTemp)
    if (Test-Path $geoserverDir) { Remove-Item -Recurse -Force $geoserverDir }
    $items = Get-ChildItem $extractTemp -Force
    $dirs = $items | Where-Object { $_.PSIsContainer }
    $wrapperFolder = $null
    if ($dirs.Count -eq 1 -and $dirs[0].Name -match '^geoserver-[\d\.]+$') {
        $wrapperFolder = $dirs[0]
    }
    if ($wrapperFolder) {
        Move-Item -Path $wrapperFolder.FullName -Destination $geoserverDir
    } else {
        New-Item -ItemType Directory -Path $geoserverDir -Force | Out-Null
        foreach ($item in $items) {
            Move-Item -Path $item.FullName -Destination $geoserverDir -Force
        }
    }
    Remove-Item -Recurse -Force $extractTemp -ErrorAction SilentlyContinue
    Remove-Item $geoserverZip -ErrorAction SilentlyContinue
    Write-Host "GeoServer installed: $geoserverDir" -ForegroundColor Green
} catch {
    Write-Host "GeoServer install failed: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Install complete!" -ForegroundColor Green
Write-Host "Run: npm run geoserver" -ForegroundColor Yellow
