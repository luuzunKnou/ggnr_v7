$ErrorActionPreference = "Stop"
$downloads = Join-Path $env:USERPROFILE "Downloads"
$src = Get-ChildItem -LiteralPath $downloads -Filter "*.zip" | Where-Object { $_.Name -match "AI" -and $_.Name -match "참고자료" } | Select-Object -First 1
if (!$src) { Write-Error "Zip not found in Downloads (pattern *AI*참고*.zip)"; exit 1 }
$src = $src.FullName
$dest = "d:\ggnr_v7\ref_gnr_ai"
if (!(Test-Path $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }
Expand-Archive -LiteralPath $src -DestinationPath $dest -Force
Write-Host "Done. Listing:"
Get-ChildItem $dest -Recurse | Select-Object FullName
