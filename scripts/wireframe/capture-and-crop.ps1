# Screenshots every capture-<slug>.html produced by extract.js with headless
# Chrome, then autocrops each PNG to its content bounding box.
#
# Usage:
#   powershell -NoProfile -File capture-and-crop.ps1 -ScratchDir <dir> -MetaPath <screens-meta.json>

param(
  [Parameter(Mandatory = $true)] [string]$ScratchDir,
  [Parameter(Mandatory = $true)] [string]$MetaPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"

# headless Chrome caches file:// content by URL inside a persisted
# --user-data-dir. Deleting a reused profile dir up front is not reliable (a
# prior Chrome process can still hold a lock on cache files for a moment
# after exit, so the delete silently only partially succeeds). Use a
# never-before-seen profile dir for this run instead so there is nothing to
# go stale even if the same capture-<slug>.html changed since the last run.
$profileDir = Join-Path $ScratchDir "chrome-profile-wireframe-$([guid]::NewGuid().ToString('N'))"

$json = [IO.File]::ReadAllText($MetaPath, [Text.Encoding]::UTF8)
$meta = ($json | ConvertFrom-Json).screens

function Capture-One($capturePath, $rawPath) {
  # The completion check below is "does $rawPath exist yet". If a stale
  # screenshot from a previous run is already sitting at that path,
  # Test-Path is true before Chrome has written anything, so the loop
  # exits immediately and the stale file is mistaken for fresh output.
  # Delete it first so existence is a real signal.
  if (Test-Path $rawPath) { Remove-Item -LiteralPath $rawPath -Force }

  $uri = "file:///$($capturePath -replace '\\','/')"
  $args = @(
    "--headless=new", "--disable-gpu", "--force-device-scale-factor=4", "--hide-scrollbars",
    "--window-size=3600,1400", "--window-position=-32000,-32000", "--default-background-color=00000000",
    "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-background-networking",
    "--disable-extensions", "--disable-component-update", "--disable-features=OptimizationHints,ModelExecution,Translate",
    "--disable-application-cache", "--media-cache-size=0", "--disk-cache-size=0",
    "--user-data-dir=$profileDir",
    "--screenshot=$rawPath", $uri
  )
  $proc = Start-Process -FilePath $chrome -ArgumentList $args -PassThru -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(25)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $rawPath) { Start-Sleep -Milliseconds 400; break }
    Start-Sleep -Milliseconds 300
  }
  if (-not $proc.HasExited) { try { $proc.Kill() } catch {} }
  Start-Sleep -Milliseconds 200
}

foreach ($s in $meta) {
  $slug = [string]$s.slug
  $capturePath = Join-Path $ScratchDir "capture-$slug.html"
  $rawPath = Join-Path $ScratchDir "raw-$slug.png"
  $pngPath = Join-Path $ScratchDir "wf-$slug.png"

  Capture-One $capturePath $rawPath
  if (-not (Test-Path $rawPath)) { Write-Output "$slug -> FAILED (no screenshot)"; continue }

  $bmp = [System.Drawing.Bitmap]::FromFile($rawPath)
  $w = $bmp.Width; $h = $bmp.Height
  $minX = $w; $minY = $h; $maxX = 0; $maxY = 0
  $data = $bmp.LockBits((New-Object System.Drawing.Rectangle(0, 0, $w, $h)), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $bytes = New-Object byte[] ($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)
  for ($y = 0; $y -lt $h; $y++) {
    $rowOff = $y * $stride
    for ($x = 0; $x -lt $w; $x++) {
      $a = $bytes[$rowOff + $x * 4 + 3]
      if ($a -gt 10) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  $cropW = $maxX - $minX + 1
  $cropH = $maxY - $minY + 1
  $rect = New-Object System.Drawing.Rectangle ($minX, $minY, $cropW, $cropH)
  $cropped = $bmp.Clone($rect, $bmp.PixelFormat)
  $cropped.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose(); $cropped.Dispose()
  Write-Output "$slug -> $cropW x $cropH"
}

try { Remove-Item -LiteralPath $profileDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
