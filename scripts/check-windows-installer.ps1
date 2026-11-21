# SPDX-License-Identifier: MIT
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Run this installer check on the disposable Windows CI runner.'
}

function Invoke-Nsis($Program, $Arguments) {
    $process = Start-Process -FilePath $Program -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    try {
        if (-not $process.WaitForExit(180000)) {
            $process.Kill()
            throw "Timed out running $Program"
        }
        if ($process.ExitCode -ne 0) {
            throw "$Program exited with code $($process.ExitCode)"
        }
    } finally {
        $process.Dispose()
    }
}

$root = Split-Path -Parent $PSScriptRoot
$package = Join-Path $root 'desktop-package'
$receipt = Get-Content -LiteralPath (Join-Path $package 'desktop-artifact.json') -Raw | ConvertFrom-Json -AsHashtable
$config = Get-Content -LiteralPath (Join-Path $root 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$binaryName = 'ellmos-system-gui-desktop.exe'
$installerName = $receipt.bundles.nsis.file
if ($receipt.source.commit -cne $env:DESKTOP_SOURCE_COMMIT -or $receipt.build.os -cne 'Windows' -or
    $installerName -notmatch '^bundles/[^/\\]+-setup\.exe$') {
    throw 'Unexpected Windows desktop artifact receipt.'
}

$installer = Join-Path $package $installerName
$installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
if ($installerHash -cne $receipt.files[$installerName].sha256) {
    throw 'The installer does not match the build receipt.'
}
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$($config.productName)"
if (Test-Path -LiteralPath $regPath) {
    throw 'The CI runner already has this product installed.'
}

$sandbox = Join-Path $env:RUNNER_TEMP ('openocean-installer-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $sandbox | Out-Null
$installDir = Join-Path $sandbox 'installed app'
$installed = Join-Path $installDir $binaryName
$uninstaller = Join-Path $installDir 'uninstall.exe'

# Use the executable packaged by NSIS as the reference for the installed bytes.
$payloadDir = Join-Path $sandbox 'payload'
$sevenZip = Join-Path $env:ProgramFiles '7-Zip/7z.exe'
& $sevenZip e -y "-o$payloadDir" $installer $binaryName -r
if ($LASTEXITCODE -ne 0) {
    throw "Could not extract the NSIS application payload (exit $LASTEXITCODE)."
}
$payload = Join-Path $payloadDir $binaryName
$payloadHash = (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant()

# NSIS consumes the final directory argument verbatim, including spaces.
Invoke-Nsis $installer "/S /D=$installDir"
$registration = Get-ItemProperty -LiteralPath $regPath
if ($registration.DisplayVersion -cne $config.version -or
    $registration.InstallLocation.Trim('"') -ine $installDir -or
    $registration.UninstallString.Trim('"') -ine $uninstaller) {
    throw 'The registered version, install location or uninstaller is incorrect.'
}
$installedHash = (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash.ToLowerInvariant()
if ($installedHash -cne $payloadHash) {
    throw 'The installed executable does not match the verified NSIS payload.'
}

# Run the generated uninstaller from outside the installation directory so it can remove the original.
$uninstallCopy = Join-Path $sandbox 'uninstall.exe'
Copy-Item -LiteralPath $uninstaller -Destination $uninstallCopy
try {
    $app = Start-Process -FilePath $installed -WorkingDirectory $installDir -WindowStyle Hidden -PassThru
    try {
        if (-not $app.WaitForInputIdle(20000) -or $app.HasExited) {
            throw 'The installed executable did not reach an idle Windows message loop.'
        }
    } finally {
        if (-not $app.HasExited) {
            $app.Kill()
            if (-not $app.WaitForExit(10000)) {
                throw 'The application process did not stop after termination.'
            }
        }
        $app.Dispose()
    }
} finally {
    Invoke-Nsis $uninstallCopy "/S _?=$installDir"
}
if ((Test-Path -LiteralPath $installDir) -or (Test-Path -LiteralPath $regPath)) {
    throw 'The installation directory or per-user registration remained after uninstall.'
}
Remove-Item -LiteralPath $uninstallCopy

$evidence = [ordered]@{
    schema = 'ellmos-system-gui.windows-installer-check.v1'
    environment = 'github-hosted-windows'
    source = $receipt.source
    run_id = $receipt.build.run_id
    run_attempt = $receipt.build.run_attempt
    version = $config.version
    installer_sha256 = $installerHash
    installer_payload_sha256 = $payloadHash
    installed_binary_sha256 = $installedHash
    per_user_registration_verified = $true
    windows_message_loop_idle = $true
    installed_files_and_registration_removed = $true
}
$evidence | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $package 'windows-installer-check.json') -Encoding utf8
Write-Output "Installed, launched and uninstalled Windows desktop version $($config.version)."
