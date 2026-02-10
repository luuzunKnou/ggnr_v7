# GeoServer CSS Plugin Install
# Run: npm run install-geoserver-css
# Stop GeoServer before installing.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$moduleRoot = Split-Path -Parent $scriptDir
$geoserverDir = Join-Path $moduleRoot "geoserver"
$webappLib = Join-Path $geoserverDir "webapps\geoserver\WEB-INF\lib"

if (-not (Test-Path $geoserverDir)) {
    Write-Host "GeoServer not installed. Run install-geoserver.ps1 first." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $webappLib)) {
    Write-Host "WEB-INF/lib not found: $webappLib" -ForegroundColor Red
    exit 1
}

Write-Host "Installing GeoServer CSS plugin..." -ForegroundColor Green

$pluginZip = Join-Path $env:TEMP "geoserver-2.28.2-css-plugin.zip"
$pluginUrl = "https://sourceforge.net/projects/geoserver/files/GeoServer/2.28.2/extensions/geoserver-2.28.2-css-plugin.zip/download"

try {
    Write-Host "Downloading..." -ForegroundColor Cyan
    $wc = New-Object System.Net.WebClient
    $wc.DownloadFile($pluginUrl, $pluginZip)
    $wc.Dispose()

    if (-not (Test-Path $pluginZip) -or (Get-Item $pluginZip).Length -lt 100000) {
        throw "Download failed"
    }
    Write-Host "Download complete" -ForegroundColor Green

    Write-Host "Extracting..." -ForegroundColor Cyan
    $extractTemp = Join-Path $env:TEMP "geoserver-css-extract"
    if (Test-Path $extractTemp) { Remove-Item -Recurse -Force $extractTemp }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($pluginZip, $extractTemp)

    $jarFiles = Get-ChildItem -Path $extractTemp -Filter "*.jar" -Recurse | Where-Object { $_.PSIsContainer -eq $false }
    foreach ($jar in $jarFiles) {
        Copy-Item $jar.FullName -Destination $webappLib -Force
        Write-Host "  Copied: $($jar.Name)" -ForegroundColor Gray
    }

    Remove-Item -Recurse -Force $extractTemp -ErrorAction SilentlyContinue
    Remove-Item $pluginZip -ErrorAction SilentlyContinue

    Write-Host ""
    Write-Host "CSS plugin installed! Restart GeoServer: npm run geoserver" -ForegroundColor Green
}
catch {
    Write-Host "Install failed: $_" -ForegroundColor Red
    exit 1
}
