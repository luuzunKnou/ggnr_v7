# Wireframe doc -> PDF/HTML pipeline. Runs entirely standalone (no Claude Code
# needed) - just Node.js and Chrome must be installed.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File run.ps1 -MdPath "docs\plan\20260706_0755_레이어관리.md"
#
# Optional:
#   -OutDir <dir>   Where to copy the final .pdf/.html (defaults to the same
#                    folder as the source .md, with the same base filename)

param(
  [Parameter(Mandatory = $true)] [string]$MdPath,
  [string]$OutDir
)

$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  $OutputEncoding = [Text.Encoding]::UTF8
} catch {}
$sw = [Diagnostics.Stopwatch]::StartNew()

$ScriptDir = $PSScriptRoot
$MdPath = (Resolve-Path $MdPath).Path
$BaseName = [IO.Path]::GetFileNameWithoutExtension($MdPath)
$DocTitle = $BaseName -replace '^\d{8}_\d{4}_', ''

if (-not $OutDir) { $OutDir = Split-Path $MdPath -Parent }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$BuildDir = Join-Path $ScriptDir ".build\$BaseName"
if (-not (Test-Path $BuildDir)) { New-Item -ItemType Directory -Path $BuildDir -Force | Out-Null }

$FontFace = Join-Path $ScriptDir "fontface.css"
$OutHtml = Join-Path $BuildDir "$BaseName.html"
$OutPdf = Join-Path $BuildDir "$BaseName.pdf"
$ProfileDir = Join-Path $BuildDir "chrome-profile-print"

# repo-relative path for the "원본 문서" byline, best-effort. Walk up from
# this script's own folder looking for the repo root (marked by .git) so the
# path still resolves correctly no matter how deep this script lives.
function Find-RepoRoot([string]$startDir) {
  $dir = Get-Item $startDir
  while ($dir) {
    if (Test-Path (Join-Path $dir.FullName ".git")) { return $dir.FullName }
    $dir = $dir.Parent
  }
  return $null
}
$RepoRoot = Find-RepoRoot $ScriptDir
$SourceRel = $MdPath
if ($RepoRoot -and $MdPath.StartsWith($RepoRoot)) {
  $SourceRel = $MdPath.Substring($RepoRoot.Length).TrimStart('\', '/') -replace '\\', '/'
}

Write-Host "[1/4] 와이어프레임·설명·확인사항 추출 중..."
node "$ScriptDir\extract.js" "$MdPath" "$BuildDir" "$FontFace"
if ($LASTEXITCODE -ne 0) { throw "extract.js failed" }

Write-Host "[2/4] 화면 캡처(headless Chrome) 중..."
& "$ScriptDir\capture-and-crop.ps1" -ScratchDir "$BuildDir" -MetaPath "$BuildDir\screens-meta.json"

Write-Host "[3/4] 문서 조립 중..."
node "$ScriptDir\assemble.js" "$BuildDir" "$OutHtml" "$DocTitle" "$SourceRel"
if ($LASTEXITCODE -ne 0) { throw "assemble.js failed" }

Write-Host "[4/4] PDF 변환 중..."
& "$ScriptDir\print-to-pdf.ps1" -HtmlPath "$OutHtml" -PdfPath "$OutPdf" -ProfileDir "$ProfileDir"

$FinalHtml = Join-Path $OutDir "$BaseName.html"
$FinalPdf = Join-Path $OutDir "$BaseName.pdf"
Copy-Item -Path $OutHtml -Destination $FinalHtml -Force
Copy-Item -Path $OutPdf -Destination $FinalPdf -Force

$sw.Stop()
Write-Host ""
Write-Host "완료 ($([math]::Round($sw.Elapsed.TotalSeconds, 1))초)"
Write-Host "  HTML: $FinalHtml"
Write-Host "  PDF : $FinalPdf"
