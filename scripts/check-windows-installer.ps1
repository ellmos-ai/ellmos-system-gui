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

function Read-Registration($Key, $InstallDir) {
    $registration = Get-ItemProperty -LiteralPath $Key
    if ($registration.InstallLocation.Trim('"') -ine $InstallDir -or
        $registration.UninstallString.Trim('"') -ine (Join-Path $InstallDir 'uninstall.exe')) {
        throw 'The registered install location or uninstaller is incorrect.'
    }
    return $registration
}

function Uninstall-Nsis($InstallDir, $RegistrationKey, $UninstallCopy) {
    # Run from outside the install directory so NSIS can remove the original.
    Copy-Item -LiteralPath (Join-Path $InstallDir 'uninstall.exe') -Destination $UninstallCopy
    Invoke-Nsis $UninstallCopy "/S _?=$InstallDir"
    if ((Test-Path -LiteralPath $InstallDir) -or (Test-Path -LiteralPath $RegistrationKey)) {
        throw 'The installation directory or per-user registration remained after uninstall.'
    }
    Remove-Item -LiteralPath $UninstallCopy
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

# Use the executable packaged by NSIS as the reference for the installed bytes.
$payloadDir = Join-Path $sandbox 'payload'
$sevenZip = Join-Path $env:ProgramFiles '7-Zip/7z.exe'
& $sevenZip e -y "-o$payloadDir" $installer $binaryName -r
if ($LASTEXITCODE -ne 0) {
    throw "Could not extract the NSIS application payload (exit $LASTEXITCODE)."
}
$payload = Join-Path $payloadDir $binaryName
$payloadHash = (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant()

$legacy = $null
if ($env:LEGACY_RUN) {
    $legacyPackage = Join-Path $env:RUNNER_TEMP 'legacy-desktop'
    $legacyReceipt = Get-Content -LiteralPath (Join-Path $legacyPackage 'desktop-artifact.json') -Raw | ConvertFrom-Json -AsHashtable
    $legacyInstaller = $legacyReceipt.bundles.nsis.file
    if ($legacyReceipt.source.repository -cne $env:GITHUB_REPOSITORY -or
        $legacyReceipt.source.commit -cne $env:LEGACY_COMMIT -or
        $legacyReceipt.build.run_id -ne [long]$env:LEGACY_RUN -or $legacyReceipt.build.os -cne 'Windows' -or
        $legacyInstaller -cnotmatch '^bundles/BACH Ocean_(\d+\.\d+\.\d+)_x64-setup\.exe$') {
        throw 'Unexpected legacy desktop build receipt.'
    }
    $legacyVersion = $Matches[1]
    $legacySetup = Join-Path $legacyPackage $legacyInstaller
    $legacyHash = (Get-FileHash -LiteralPath $legacySetup -Algorithm SHA256).Hash.ToLowerInvariant()
    if ([version]$legacyVersion -ge [version]$config.version -or
        $legacyHash -cne $env:LEGACY_INSTALLER_SHA256 -or $legacyHash -cne $legacyReceipt.files[$legacyInstaller].sha256) {
        throw 'The legacy installer version or checksum does not match the requested baseline.'
    }
    $legacyKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BACH Ocean'
    $legacyDir = Join-Path $sandbox 'legacy app'
    if (Test-Path -LiteralPath $legacyKey) {
        throw 'The Windows runner already has the legacy product installed.'
    }
    Invoke-Nsis $legacySetup "/S /D=$legacyDir"
    if ((Read-Registration $legacyKey $legacyDir).DisplayVersion -cne $legacyVersion) {
        throw 'The legacy installer registered the wrong version.'
    }
    $legacyBinary = Join-Path $legacyDir $binaryName
    $legacyBinaryHash = (Get-FileHash -LiteralPath $legacyBinary -Algorithm SHA256).Hash.ToLowerInvariant()
    # Cover both data directories addressed by the legacy uninstaller.
    $profileSamples = foreach ($parent in @($env:APPDATA, $env:LOCALAPPDATA)) {
        $profileDir = Join-Path $parent $config.identifier
        New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
        $sample = Join-Path $profileDir ("preservation-" + [Guid]::NewGuid().ToString('N') + '.txt')
        Set-Content -LiteralPath $sample -Value ([Guid]::NewGuid().ToString('N')) -Encoding utf8
        [pscustomobject]@{ File = $sample; Hash = (Get-FileHash -LiteralPath $sample -Algorithm SHA256).Hash }
    }
    $legacy = [ordered]@{
        source = $legacyReceipt.source
        run_id = $legacyReceipt.build.run_id
        version = $legacyVersion
        installer_sha256 = $legacyHash
    }
}

# NSIS consumes the final directory argument verbatim, including spaces.
Invoke-Nsis $installer "/S /D=$installDir"
if ((Read-Registration $regPath $installDir).DisplayVersion -cne $config.version) {
    throw 'The installed version is incorrect.'
}
$installedHash = (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash.ToLowerInvariant()
if ($installedHash -cne $payloadHash) {
    throw 'The installed executable does not match the verified NSIS payload.'
}

$uninstallCopy = Join-Path $sandbox 'uninstall.exe'
try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { $webviewPort = $listener.LocalEndpoint.Port }
    finally { $listener.Stop() }
    $webviewEnv = @{
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$webviewPort"
        WEBVIEW2_USER_DATA_FOLDER = Join-Path $sandbox 'webview-profile'
    }
    $webviewOutput = Join-Path $sandbox 'installed-launch.stderr.log'
    $app = Start-Process -FilePath $installed -WorkingDirectory $installDir -WindowStyle Hidden -PassThru -Environment $webviewEnv -RedirectStandardError $webviewOutput
    try {
        if (-not $app.WaitForInputIdle(20000) -or $app.HasExited) {
            throw 'The installed executable did not reach an idle Windows message loop.'
        }
        $probe = node (Join-Path $PSScriptRoot 'check-windows-webview.mjs') $webviewPort
        if ($LASTEXITCODE -ne 0) {
            $probeExit = $LASTEXITCODE
            $app.Refresh()
            $webviewProcesses = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
                Where-Object {
                    $_.CommandLine -and ($_.ParentProcessId -eq $app.Id -or
                        $_.CommandLine.Contains($webviewEnv.WEBVIEW2_USER_DATA_FOLDER))
                })
            $matchingDebugPort = @($webviewProcesses | Where-Object {
                $_.CommandLine.Contains("--remote-debugging-port=$webviewPort")
            }).Count
            Write-Host "WebView diagnostic: app_exited=$($app.HasExited), profile_present=$(Test-Path -LiteralPath $webviewEnv.WEBVIEW2_USER_DATA_FOLDER), profile_processes=$($webviewProcesses.Count), debug_port_processes=$matchingDebugPort"
            if ($app.HasExited) { Write-Host "Installed app exit code: $($app.ExitCode)" }
            if (Test-Path -LiteralPath $webviewOutput) { Get-Content -LiteralPath $webviewOutput -Tail 12 }
            throw "The installed WebView2 connection test failed (exit $probeExit)."
        }
        $webview = $probe | ConvertFrom-Json
        if ($webview.schema -cne 'ellmos-system-gui.windows-webview-check.v1' -or
            $webview.loopback_opt_in_enforced -ne $true -or $webview.fixture_opened -ne $true -or
            $webview.authentication_required -ne $true) {
            throw 'The installed WebView2 connection test did not return its expected receipt.'
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
    if ($null -ne $legacy) {
        if ((Get-FileHash -LiteralPath $legacyBinary -Algorithm SHA256).Hash.ToLowerInvariant() -cne $legacyBinaryHash -or
            (Read-Registration $legacyKey $legacyDir).DisplayVersion -cne $legacyVersion) {
            throw 'The old product was changed before the replacement was started.'
        }
        Uninstall-Nsis $legacyDir $legacyKey $uninstallCopy
        if ((Read-Registration $regPath $installDir).DisplayVersion -cne $config.version -or
            (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash.ToLowerInvariant() -cne $installedHash) {
            throw 'Removing the legacy product changed the replacement installation.'
        }
    }
} finally {
    Uninstall-Nsis $installDir $regPath $uninstallCopy
}
if ($null -ne $legacy) {
    Invoke-Nsis $legacySetup "/S /D=$legacyDir"
    if ((Read-Registration $legacyKey $legacyDir).DisplayVersion -cne $legacyVersion -or
        (Get-FileHash -LiteralPath $legacyBinary -Algorithm SHA256).Hash.ToLowerInvariant() -cne $legacyBinaryHash) {
        throw 'The previous installer did not restore the verified legacy installation.'
    }
    Uninstall-Nsis $legacyDir $legacyKey $uninstallCopy
    foreach ($sample in $profileSamples) {
        if ((Get-FileHash -LiteralPath $sample.File -Algorithm SHA256).Hash -cne $sample.Hash) {
            throw 'A profile sample changed during the migration or rollback.'
        }
    }
    $legacy['coexistence_until_replacement_started'] = $true
    $legacy['old_installation_removed'] = $true
    $legacy['rollback_installer_restored_previous_version'] = $true
    $legacy['roaming_and_local_data_samples_preserved'] = $true
}

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
    installed_webview = $webview
    installed_files_and_registration_removed = $true
}
if ($null -ne $legacy) {
    $evidence['legacy_migration'] = $legacy
}
$evidence | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $package 'windows-installer-check.json') -Encoding utf8
Write-Output "Installed, launched and uninstalled Windows desktop version $($config.version)."
