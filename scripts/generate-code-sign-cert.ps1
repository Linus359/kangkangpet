param(
  [string]$Publisher = "FORCOME",
  [Parameter(Mandatory = $true)]
  [string]$Password,
  [string]$OutputDir = ".\certs"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$subject = "CN=$Publisher"
$pfxPath = Join-Path $OutputDir "kangkangpet-code-signing.pfx"
$cerPath = Join-Path $OutputDir "kangkangpet-code-signing.cer"

$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $subject `
  -KeyAlgorithm RSA `
  -KeyLength 3072 `
  -HashAlgorithm SHA256 `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(5)

$securePassword = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

Write-Host "Generated code signing certificate:"
Write-Host " - PFX: $((Resolve-Path $pfxPath).Path)"
Write-Host " - CER: $((Resolve-Path $cerPath).Path)"
Write-Host "Publisher: $Publisher"
Write-Host ""
Write-Host "Note: this is a self-signed certificate for internal testing. Keep the password outside the repository. Windows will only trust it on machines where the CER is installed into Trusted Root/Trusted Publishers."




