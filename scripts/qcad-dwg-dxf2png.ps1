#Requires -Version 5.1
<#
  roadDoc/cad 내 *.dwg, *.dxf → 투명 배경 PNG (QCAD dwg2bmp).
  QCAD 베이스: 저장소 루트의 QCAD_modules (dwg2bmp.bat 또는 bin\dwg2bmp.bat)

  사용:
    npm run road-doc:png
    npm run road-doc:png -- -Force
    npm run road-doc:png -- -OutputSuffix _preview -Force
    npm run road-doc:png -- -Background black   # 투명 대신 검은 배경
#>
param(
  [switch]$Force,
  [string]$Background = "transparent",
  [string]$OutputSuffix = "",
  [int]$RasterWidth = 2480,
  [int]$RasterHeight = 3508
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot = Split-Path $PSScriptRoot -Parent
$QcadBase = Join-Path $RepoRoot "QCAD_modules"
$FileDir = Join-Path $RepoRoot "src\app\(pages)\map\_mapContents\road\roadDoc\cad"

function Resolve-Dwg2BmpBat {
  $candidates = @(
    (Join-Path $QcadBase "dwg2bmp.bat"),
    (Join-Path $QcadBase "bin\dwg2bmp.bat")
  )
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) {
      return (Resolve-Path -LiteralPath $c).Path
    }
  }
  return $null
}

if (-not (Test-Path -LiteralPath $FileDir)) {
  throw "Folder not found: $FileDir"
}

$batBmp = Resolve-Dwg2BmpBat
if (-not $batBmp) {
  throw "dwg2bmp.bat not found under QCAD_modules at: $QcadBase"
}

$QcadWorkDir = Split-Path $batBmp -Parent
Write-Host "QCAD_modules: $QcadBase"
Write-Host "dwg2bmp: $batBmp"
Write-Host "QCAD cwd: $QcadWorkDir"
Write-Host "Target dir: $FileDir"
Write-Host "Background: $Background"
if ($OutputSuffix) {
  Write-Host "OutputSuffix: $OutputSuffix"
}
Write-Host ""

$dwgs = @(Get-ChildItem -LiteralPath $FileDir -Filter "*.dwg" -File)
$dxfs = @(Get-ChildItem -LiteralPath $FileDir -Filter "*.dxf" -File)
$inputs = @($dwgs) + @($dxfs)
if ($inputs.Count -eq 0) {
  Write-Host "No .dwg or .dxf files."
  exit 0
}

$baseGroups = $inputs | Group-Object { [System.IO.Path]::GetFileNameWithoutExtension($_.Name) }
$fail = 0
$skipped = 0
$ok = 0

foreach ($g in $baseGroups) {
  foreach ($d in $g.Group) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($d.Name)
    $ext = [System.IO.Path]::GetExtension($d.Name).ToLowerInvariant()
    $disambig = ""
    if ($g.Count -gt 1) {
      if ($ext -eq ".dwg") { $disambig = "_dwg" }
      elseif ($ext -eq ".dxf") { $disambig = "_dxf" }
    }
    $outName = if ($OutputSuffix) { "$base$OutputSuffix$disambig.png" } else { "$base$disambig.png" }
    $out = Join-Path $d.DirectoryName $outName

    if ((-not $Force) -and (Test-Path -LiteralPath $out)) {
      $skipped++
      Write-Host "[SKIP] $($d.Name) -> exists: $outName  (use -Force)"
      continue
    }
    Write-Host "[RUN]  $($d.Name) -> $outName"

    Push-Location -LiteralPath $QcadWorkDir
    try {
      $bmpName = Split-Path $batBmp -Leaf
      $inner = "$bmpName -f -b $Background -color-correction -zoom-all -x $RasterWidth -y $RasterHeight -outfile=`"$out`" `"$($d.FullName)`""
      $p = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $inner) -Wait -PassThru -NoNewWindow
    }
    finally {
      Pop-Location
    }
    if ($p.ExitCode -ne 0) {
      Write-Warning "dwg2bmp failed (exit $($p.ExitCode)): $($d.Name)"
      $fail++
      continue
    }
    if (-not (Test-Path -LiteralPath $out)) {
      Write-Warning "PNG not created: $out"
      $fail++
    }
    else {
      $ok++
      Write-Host "       OK"
    }
  }
}

Write-Host ""
if ($fail -gt 0) {
  throw "Failed: $fail (skipped $skipped)"
}
Write-Host "Done. ok $ok, skipped $skipped."
