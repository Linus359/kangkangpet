param(
  [switch]$SkipInstall,
  [switch]$NoSign,
  [string]$CertificateFile = $env:KANGKANGPET_CERTIFICATE_FILE,
  [string]$CertificatePassword = $env:KANGKANGPET_CERTIFICATE_PASSWORD
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:ELECTRON_MIRROR) {
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
}

if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
}

$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

function Ensure-WinCodeSignCache {
  $cacheRoot = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\winCodeSign"
  $target = Join-Path $cacheRoot "winCodeSign-2.6.0"
  $signtool = Join-Path $target "windows-10\x64\signtool.exe"
  $rcedit = Join-Path $target "rcedit-x64.exe"

  if ((Test-Path $signtool) -and (Test-Path $rcedit)) {
    return
  }

  New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null

  $source = Get-ChildItem -Path $cacheRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object {
      (Test-Path (Join-Path $_.FullName "rcedit-x64.exe")) -and
      (Test-Path (Join-Path $_.FullName "windows-10\x64\signtool.exe"))
    } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($source) {
    if (Test-Path $target) {
      Remove-Item -Path $target -Recurse -Force
    }
    Copy-Item -Path $source.FullName -Destination $target -Recurse -Force
    return
  }

  Write-Host "winCodeSign cache is not prepared yet. electron-builder will download it; if Windows blocks symlink extraction, rerun this script after the first failed attempt."
}

Ensure-WinCodeSignCache

if (-not $NoSign -and $CertificateFile -and $CertificatePassword -and (Test-Path $CertificateFile)) {
  $env:CSC_LINK = (Resolve-Path $CertificateFile).Path
  $env:CSC_KEY_PASSWORD = $CertificatePassword
  Write-Host "Using certificate supplied through parameters or KANGKANGPET_CERTIFICATE_* environment variables."
} else {
  Write-Host "Building without code signing. Pass -CertificateFile/-CertificatePassword or KANGKANGPET_CERTIFICATE_* to sign a release."
}

if (-not (Test-Path ".\build\face.ico")) {
  throw "Missing build\face.ico. Please generate or provide an application icon first."
}

$assetFiles = @()
if (Test-Path ".\assets\cat") {
  $assetFiles = Get-ChildItem ".\assets\cat" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension.ToLowerInvariant() -in @('.png', '.jpg', '.jpeg', '.webp', '.gif', '.webm', '.mp4', '.mov') }
}

if (-not $assetFiles -or $assetFiles.Count -eq 0) {
  throw "Missing bundled KangKangPet assets in assets\cat."
}

if (-not $SkipInstall) {
  npm install
}

npx electron-builder --win nsis --publish never
if ($LASTEXITCODE -ne 0) {
  throw "electron-builder failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Build complete. Installer output:"
Get-ChildItem ".\dist" -File -Filter "*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 5 | ForEach-Object {
  Write-Host " - $($_.FullName)"
}

$asarPath = Join-Path $root "dist\win-unpacked\resources\app.asar"
if (-not (Test-Path $asarPath)) {
  throw "Build finished but app.asar was not found: $asarPath"
}

