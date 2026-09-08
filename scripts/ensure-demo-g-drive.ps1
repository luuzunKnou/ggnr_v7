#Requires -Version 5.1
<#
.SYNOPSIS
  demo: prompt for G: share credentials, connect if missing.
  UNC root is read from src/config/projects/common.runtime.env (GGNR_DATA_UNC_ROOT).
  Writes credentials to -OutFile for the starter bat / nssm ObjectName.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [Parameter(Mandatory = $true)]
  [string]$OutFile,
  [string]$DriveLetter = 'G',
  [string]$User = '',
  [string]$Password = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Info([string]$msg) {
  Write-Host "[demo-gdrive] $msg"
}

function Read-UncRootFromCommon([string]$root) {
  $envFile = Join-Path $root 'src\config\projects\common.runtime.env'
  if (-not (Test-Path -LiteralPath $envFile)) {
    throw "common.runtime.env not found: $envFile"
  }
  foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    if ($t -match '^\s*GGNR_DATA_UNC_ROOT\s*=\s*(.+)\s*$') {
      $v = $Matches[1].Trim().Trim('"').Trim("'")
      if ($v) { return $v }
    }
  }
  throw "GGNR_DATA_UNC_ROOT missing in common.runtime.env"
}

function Normalize-Unc([string]$unc) {
  $u = $unc.Trim().TrimEnd('\')
  if ($u -notmatch '^\\\\[^\\]+\\') {
    throw "GGNR_DATA_UNC_ROOT must be UNC (\\\\server\\share): $unc"
  }
  return $u
}

function Get-DriveRemotePath([string]$letter) {
  $letter = $letter.TrimEnd(':')
  try {
    $map = Get-PSDrive -Name $letter -PSProvider FileSystem -ErrorAction SilentlyContinue
    if ($map -and $map.DisplayRoot) { return [string]$map.DisplayRoot }
  } catch {}
  $line = (cmd /c "net use ${letter}:" 2>$null | Out-String)
  if ($line -match '\\\\[^\s]+') {
    return $Matches[0].TrimEnd('\')
  }
  return $null
}

function Test-UncReachable([string]$unc) {
  try {
    return [bool](Test-Path -LiteralPath $unc)
  } catch {
    return $false
  }
}

$uncRoot = Normalize-Unc (Read-UncRootFromCommon $Root)
$drive = $DriveLetter.TrimEnd(':').ToUpperInvariant()
$drivePath = "${drive}:"

Write-Host ''
Write-Host 'demo의 G 드라이브 첨부파일 연결을 위해 정보 입력이 필요합니다.'
Write-Info "UNC (common.runtime.env) = $uncRoot"
Write-Host ''

if (-not $User) {
  $User = Read-Host '계정'
}
if (-not $Password) {
  $sec = Read-Host '비밀번호' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    $Password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null
  }
}

$User = ([string]$User).Trim()
if (-not $User) { throw '계정이 비어 있습니다.' }
if ([string]::IsNullOrEmpty($Password)) { throw '비밀번호가 비어 있습니다.' }

$currentRemote = Get-DriveRemotePath $drive
$needConnect = $true
if ($currentRemote) {
  $curNorm = $currentRemote.TrimEnd('\').ToLowerInvariant()
  $uncNorm = $uncRoot.TrimEnd('\').ToLowerInvariant()
  if ($curNorm -eq $uncNorm) {
    Write-Info "${drivePath} already mapped to $currentRemote - skip net use"
    $needConnect = $false
  } else {
    Write-Info "${drivePath} mapped to $currentRemote (expected $uncRoot) - reconnect"
    cmd /c "net use ${drivePath} /delete /y" | Out-Null
  }
}

if ($needConnect) {
  if (-not (Test-UncReachable $uncRoot)) {
    Write-Info "UNC not reachable yet (will try net use): $uncRoot"
  }
  Write-Info "Connecting ${drivePath} -> $uncRoot ..."
  $args = @('use', $drivePath, $uncRoot, "/user:$User", $Password, '/persistent:yes')
  $p = Start-Process -FilePath 'net.exe' -ArgumentList $args -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) {
    throw "net use failed (exit=$($p.ExitCode)). Check account/password/share access."
  }
  $after = Get-DriveRemotePath $drive
  if (-not $after) {
    throw "${drivePath} connect reported OK but drive not visible."
  }
  Write-Info "Connected: ${drivePath} -> $after"
}

# ObjectName for nssm: allow DOMAIN\user or .\user or user
$objectName = $User
if ($objectName -notmatch '\\' -and $objectName -notmatch '@') {
  $objectName = ".\$objectName"
}

$outDir = Split-Path -Parent $OutFile
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

@(
  "GGNR_DEMO_GDRIVE_USER=$User"
  "GGNR_DEMO_GDRIVE_PASS=$Password"
  "GGNR_DEMO_GDRIVE_OBJECT=$objectName"
  "GGNR_DATA_UNC_ROOT=$uncRoot"
) | Set-Content -LiteralPath $OutFile -Encoding ASCII

Write-Info "credentials saved for nssm ObjectName (temp file)"
Write-Host ''
exit 0
