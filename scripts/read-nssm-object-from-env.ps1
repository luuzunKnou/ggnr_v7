# Read NSSM_OBJECT_NAME / NSSM_OBJECT_PASS from project.env [section].
# Usage: powershell -File read-nssm-object-from-env.ps1 -EnvFile path -Section demo
# Prints: NAME=... / PASS=... (ASCII). No other output.
param(
  [Parameter(Mandatory = $true)][string]$EnvFile,
  [Parameter(Mandatory = $true)][string]$Section
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $EnvFile)) { exit 0 }

$want = $Section.Trim().ToLowerInvariant()
$in = $false
$name = ''
$pass = ''

Get-Content -LiteralPath $EnvFile | ForEach-Object {
  $t = $_.Trim()
  if (-not $t) { return }
  if ($t.StartsWith('#')) { return }
  if ($t -match '^\[([^\]]+)\]$') {
    $in = ($Matches[1].Trim().ToLowerInvariant() -eq $want)
    return
  }
  if (-not $in) { return }
  if ($t -match '^(?i)NSSM_OBJECT_NAME\s*=\s*(.*)$') {
    $name = $Matches[1].Trim().Trim([char]34)
    return
  }
  if ($t -match '^(?i)NSSM_OBJECT_PASS\s*=\s*(.*)$') {
    $pass = $Matches[1].Trim().Trim([char]34)
    return
  }
}

if ($name) { Write-Output ("NAME=" + $name) }
if ($pass) { Write-Output ("PASS=" + $pass) }
