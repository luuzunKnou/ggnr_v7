param(
  [Parameter(Mandatory = $true)]
  [string]$Root
)

$ErrorActionPreference = 'Stop'
$envExe = Join-Path $Root 'python\env\python.exe'
$partsDir = Join-Path $Root 'python\env_parts'
$first = Join-Path $partsDir 'env.zip'

if (Test-Path -LiteralPath $envExe) {
  Write-Host '[python-env] python\env\python.exe 있음 — 복원 생략'
  exit 0
}

if (-not (Test-Path -LiteralPath $first)) {
  Write-Host '[python-env] python\env_parts\env.zip 없음 — 복원 생략'
  exit 0
}

$partFiles = @(Get-ChildItem -LiteralPath $partsDir -File | Where-Object {
    $_.Name -eq 'env.zip' -or $_.Name -match '^env\.z\d+$'
  })
if ($partFiles.Count -eq 0) {
  Write-Host '[오류] python\env_parts 에 분할 파일이 없습니다.'
  exit 1
}

$ordered = $partFiles | Sort-Object {
  if ($_.Name -eq 'env.zip') { 0 }
  elseif ($_.Name -match '^env\.z(\d+)$') { [int]$Matches[1] }
  else { 999999 }
}

Write-Host ("[python-env] 분할 {0}개 합치는 중..." -f $ordered.Count)
$tmpZip = Join-Path $env:TEMP ("ggnr_env_merged_{0}.zip" -f [guid]::NewGuid().ToString('N'))
$out = [System.IO.File]::Create($tmpZip)
try {
  foreach ($f in $ordered) {
    $in = [System.IO.File]::OpenRead($f.FullName)
    try {
      $in.CopyTo($out)
    } finally {
      $in.Dispose()
    }
  }
} finally {
  $out.Dispose()
}

$dest = Join-Path $Root 'python\env'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Host '[python-env] 압축 해제 중...'
& tar -xf $tmpZip -C $dest
$tarEc = $LASTEXITCODE
Remove-Item -LiteralPath $tmpZip -Force -ErrorAction SilentlyContinue
if ($tarEc -ne 0) {
  Write-Host "[오류] 압축 해제 실패 (exit=$tarEc)"
  exit $tarEc
}

if (-not (Test-Path -LiteralPath $envExe)) {
  Write-Host '[오류] 해제 후 python\env\python.exe 가 없습니다.'
  exit 1
}

Write-Host '[python-env] python\env 복원 완료'
if (Test-Path -LiteralPath $partsDir) {
  Remove-Item -LiteralPath $partsDir -Recurse -Force
  Write-Host '[python-env] python\env_parts 삭제 완료'
}
exit 0
