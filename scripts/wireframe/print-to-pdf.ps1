# Prints an assembled wireframe HTML doc to PDF via headless Chrome, so
# pagination reflects the full document instead of whatever a browser's
# print dialog happens to have scrolled/rendered.
#
# Usage:
#   powershell -NoProfile -File print-to-pdf.ps1 -HtmlPath <html> -PdfPath <pdf> -ProfileDir <dir>

param(
  [Parameter(Mandatory = $true)] [string]$HtmlPath,
  [Parameter(Mandatory = $true)] [string]$PdfPath,
  [Parameter(Mandatory = $true)] [string]$ProfileDir
)

$ErrorActionPreference = 'Stop'
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"

# headless Chrome caches file:// content by URL inside a persisted
# --user-data-dir. Deleting a reused profile dir up front is not reliable
# (a prior Chrome process can still hold a lock on cache files for a moment
# after exit, so the delete silently only partially succeeds). Use a
# never-before-seen profile dir instead so there is nothing to go stale.
$UniqueProfileDir = Join-Path $ProfileDir ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $UniqueProfileDir -Force | Out-Null

# The completion check below is "does $PdfPath exist yet". If a stale PDF
# from a previous run is already sitting at that path, Test-Path is true
# before Chrome has written anything, so the loop exits immediately and the
# stale file is mistaken for fresh output. Delete it first so existence is a
# real signal.
if (Test-Path $PdfPath) { Remove-Item -LiteralPath $PdfPath -Force }

$uri = "file:///$($HtmlPath -replace '\\','/')"

$args = @(
  "--headless=new", "--disable-gpu", "--print-to-pdf=$PdfPath", "--no-pdf-header-footer",
  "--window-position=-32000,-32000",
  "--no-first-run", "--disable-sync", "--disable-background-networking", "--disable-extensions",
  "--disable-application-cache", "--media-cache-size=0", "--disk-cache-size=0",
  "--user-data-dir=$UniqueProfileDir",
  $uri
)
$proc = Start-Process -FilePath $chrome -ArgumentList $args -PassThru -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds(40)
while ((Get-Date) -lt $deadline) {
  if (Test-Path $PdfPath) { Start-Sleep -Seconds 1; break }
  Start-Sleep -Milliseconds 400
}
if (-not $proc.HasExited) { try { $proc.Kill() } catch {} }
try { Remove-Item -LiteralPath $UniqueProfileDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
if (Test-Path $PdfPath) { (Get-Item $PdfPath).Length } else { "NO OUTPUT" }
