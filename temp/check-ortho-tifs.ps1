$ErrorActionPreference = 'Continue'
$env:PROJ_LIB = 'D:\workspace\ggnr_v7\python\env\Library\share\proj'
$env:GDAL_DATA = 'D:\workspace\ggnr_v7\python\env\Library\share\gdal'
$gdal = 'D:\workspace\ggnr_v7\python\env\Library\bin\gdalinfo.exe'
$root = 'G:\ggnr_data_dir\build_uj\tiles_tif\satellite_2025_5187'
$files = @(Get-ChildItem $root -Recurse -File | Where-Object { $_.Extension -match '^\.tif{1,2}$' } | Sort-Object FullName)
Write-Host "total=$($files.Count)"
$bad = New-Object System.Collections.Generic.List[object]
$ok = 0
$i = 0
foreach ($f in $files) {
  $i++
  if ($f.Length -lt 1MB) {
    $bad.Add([pscustomobject]@{ File = $f.Name; Reason = 'too_small'; Size = $f.Length })
    continue
  }
  & $gdal -q $f.FullName 1>$null 2>$null
  if ($LASTEXITCODE -ne 0) {
    $bad.Add([pscustomobject]@{ File = $f.Name; Reason = "gdalinfo_exit_$LASTEXITCODE"; Size = $f.Length })
  } else {
    $ok++
  }
  if ($i % 20 -eq 0) {
    Write-Host "checked $i / $($files.Count) ok=$ok bad=$($bad.Count)"
  }
}
Write-Host "DONE total=$($files.Count) ok=$ok bad=$($bad.Count)"
if ($bad.Count -gt 0) {
  $bad | Format-Table -AutoSize | Out-String | Write-Host
}
