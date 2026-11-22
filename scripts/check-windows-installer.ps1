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

function Wait-NativeWindow($Process) {
    if (-not $Process.WaitForInputIdle(20000) -or $Process.HasExited) {
        throw 'The updater test application did not reach its Windows message loop.'
    }
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    do {
        $Process.Refresh()
        if ($Process.HasExited) { throw 'The updater test application stopped before showing its window.' }
        if ($Process.MainWindowHandle -ne [IntPtr]::Zero) { return $Process.Id }
        Start-Sleep -Milliseconds 250
    } while ($deadline.ElapsedMilliseconds -lt 20000)
    throw 'The updater test application did not show its window.'
}

function Stop-TestApplication($Process) {
    try {
        if (-not $Process.HasExited) {
            $Process.Kill()
            if (-not $Process.WaitForExit(10000)) { throw 'The updater test application did not stop.' }
        }
    } finally {
        $Process.Dispose()
    }
}

function Wait-RestartedProcess($Executable, $RequestedAfter) {
    $name = [IO.Path]::GetFileNameWithoutExtension($Executable)
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    do {
        $instances = @(Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object {
            $_.Path -ieq $Executable -and -not $_.HasExited -and $_.StartTime -ge $RequestedAfter
        })
        if ($instances.Count -gt 1) { throw 'Multiple processes restarted from the update location.' }
        if ($instances.Count -eq 1) { return $instances[0] }
        Start-Sleep -Milliseconds 250
    } while ($deadline.ElapsedMilliseconds -lt 45000)
    throw 'The NSIS updater did not restart the installed application.'
}

function Close-TestDesktop($Process) {
    # Closing the backend returns to the connection window. Closing that window exits Tauri.
    $Process.Refresh()
    $first = $Process.MainWindowHandle
    if ($first -eq [IntPtr]::Zero -or -not $Process.CloseMainWindow()) {
        throw 'The native smoke test could not request window close.'
    }
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    do {
        if ($Process.HasExited) { break }
        $Process.Refresh()
        $active = $Process.MainWindowHandle
        if ($active -ne [IntPtr]::Zero -and $active -ne $first) {
            if (-not $Process.CloseMainWindow()) { throw 'Could not close the restored connection window.' }
            break
        }
        Start-Sleep -Milliseconds 250
    } while ($deadline.ElapsedMilliseconds -lt 10000)
    if (-not $Process.WaitForExit(10000) -or $Process.ExitCode -ne 0) {
        throw 'The native desktop did not exit cleanly after its windows were closed.'
    }
}

function Test-SignedNsisUpdate($Installer, $InstallerHash, $PayloadHash, $Version, $RegistrationKey, $ProfileSamples) {
    if ((Test-Path -LiteralPath $RegistrationKey) -or $Version -cne '0.2.40') {
        throw 'Expected a clean registration and the 0.2.40 update candidate.'
    }
    $baselineVersion = '0.2.39'
    $fixture = Join-Path $env:RUNNER_TEMP ('ocean-signed-nsis-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $fixture | Out-Null
    $baselineConfig = Join-Path $fixture 'baseline.json'
    @{ version = $baselineVersion } | ConvertTo-Json | Set-Content -LiteralPath $baselineConfig -Encoding utf8NoBOM
    # Keep the product identity and install a versioned baseline distinct from the renamed BACH package.
    $cli = Join-Path $root '.github/desktop-toolchain/node_modules/@tauri-apps/cli/tauri.js'
    & node $cli build --ci --no-sign --bundles nsis --config $baselineConfig -- --locked | Out-Host
    if ($LASTEXITCODE) { throw "Building the NSIS baseline failed (exit $LASTEXITCODE)." }
    $bundles = Join-Path $root 'src-tauri/target/release/bundle/nsis'
    $baseline = Join-Path $bundles "OpenOcean_${baselineVersion}_x64-setup.exe"
    $baselineHash = (Get-FileHash -LiteralPath $baseline -Algorithm SHA256).Hash.ToLowerInvariant()

    $directory = Join-Path $fixture 'installed app'
    $executable = Join-Path $directory $binaryName
    $uninstaller = Join-Path $fixture 'uninstall.exe'
    Invoke-Nsis $baseline "/S /D=$directory"
    $restarted = $null
    try {
        $oldHash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
        if ((Read-Registration $RegistrationKey $directory).DisplayVersion -cne $baselineVersion -or
            $oldHash -ceq $PayloadHash) { throw 'The NSIS update baseline was not installed.' }
        $previous = Start-Process -FilePath $executable -WorkingDirectory $directory -WindowStyle Normal -PassThru
        try { $before = Wait-NativeWindow $previous }
        finally { Stop-TestApplication $previous }

        $updateRequested = Get-Date
        $opensslPath = $env:PATH
        try {
            if (-not (Get-Command openssl.exe -ErrorAction SilentlyContinue)) {
                $gitRoot = Split-Path -Parent (Split-Path -Parent (Get-Command git.exe).Source)
                $opensslBin = Join-Path $gitRoot 'usr/bin'
                if (-not (Test-Path -LiteralPath (Join-Path $opensslBin 'openssl.exe') -PathType Leaf)) {
                    throw 'OpenSSL is missing on the disposable Windows runner.'
                }
                $env:PATH = "$opensslBin;$opensslPath"
            }
            $proof = python -B (Join-Path $PSScriptRoot 'desktop_update_fixture.py') $Installer $fixture $Version
            if ($LASTEXITCODE) { throw "Native signed NSIS updater check failed (exit $LASTEXITCODE)." }
        } finally {
            $env:PATH = $opensslPath
        }
        $proof = $proof | ConvertFrom-Json -AsHashtable
        if ($proof.package_sha256 -cne $InstallerHash -or $proof.tampered_payload_rejected -ne $true -or
            $proof.incorrect_version_rejected -ne $true) { throw 'Unexpected signature check receipt.' }

        # The native updater launches NSIS asynchronously before it exits.
        $handoff = @(Get-ChildItem -LiteralPath (Join-Path $fixture 'temp') -Recurse -File -Filter '*-installer.exe')
        if ($handoff.Count -ne 1 -or
            (Get-FileHash -LiteralPath $handoff[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $InstallerHash) {
            throw 'The native updater did not hand off the signed NSIS bytes.'
        }
        $installerProcess = Get-CimInstance Win32_Process -Filter "Name='$($handoff[0].Name)'" |
            Where-Object { $_.ExecutablePath -ieq $handoff[0].FullName } | Select-Object -First 1
        if ($installerProcess) {
            $pending = Get-Process -Id $installerProcess.ProcessId -ErrorAction SilentlyContinue
            if ($pending -and -not $pending.WaitForExit(90000)) {
                $pending.Refresh()
                throw "The signed NSIS installer did not finish. Window: $($pending.MainWindowTitle)"
            }
        }
        $restarted = Wait-RestartedProcess $executable $updateRequested
        if ((Read-Registration $RegistrationKey $directory).DisplayVersion -cne $Version -or
            (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant() -cne $PayloadHash) {
            throw 'NSIS did not install the signed update at the original location.'
        }
        $after = Wait-NativeWindow $restarted
        foreach ($sample in $ProfileSamples) {
            if ((Get-FileHash -LiteralPath $sample.File -Algorithm SHA256).Hash -cne $sample.Hash) {
                throw 'A profile sample changed during the signed NSIS update.'
            }
        }
    } finally {
        try { if ($restarted) { Stop-TestApplication $restarted } }
        finally { Uninstall-Nsis $directory $RegistrationKey $uninstaller }
    }
    return [ordered]@{
        baseline_version = $baselineVersion
        baseline_installer_sha256 = $baselineHash
        baseline_binary_sha256 = $oldHash
        previous_window_visible = $true
        updated_window_visible = $true
        automatic_restart = $true
        previous_process_id = $before
        restarted_process_id = $after
        installed_binary_sha256 = $PayloadHash
        signed_installer_sha256 = $proof.package_sha256
        tampered_payload_rejected = $proof.tampered_payload_rejected
        incorrect_version_rejected = $proof.incorrect_version_rejected
        roaming_and_local_data_samples_preserved = $true
        installed_files_and_registration_removed = $true
    }
}

$root = Split-Path -Parent $PSScriptRoot
$package = Join-Path $root 'desktop-package'
$receipt = Get-Content -LiteralPath (Join-Path $package 'desktop-artifact.json') -Raw | ConvertFrom-Json -AsHashtable
$config = Get-Content -LiteralPath (Join-Path $root 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$binaryName = 'ellmos-system-gui-desktop.exe'
$installerName = $receipt.bundles.nsis.file
if ($receipt.source.repository -cne $env:GITHUB_REPOSITORY -or
    $receipt.source.commit -cne $env:DESKTOP_SOURCE_COMMIT -or $receipt.build.os -cne 'Windows' -or
    $receipt.build.run_id -ne [long]$env:GITHUB_RUN_ID -or
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
$testPolicyKey = 'SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'
$testPolicy = $null
$ownsTestPolicy = $false
try {
    $webviewProfile = Join-Path $sandbox 'webview-profile'
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { $webviewPort = $listener.LocalEndpoint.Port }
    finally { $listener.Stop() }
    # Elevated WebView2 hosts ignore debug arguments from the environment.
    $testPolicy = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey($testPolicyKey)
    if ($testPolicy.GetValueNames() -contains $binaryName) {
        throw 'The Windows runner already has a WebView2 policy for this executable.'
    }
    $testPolicy.SetValue($binaryName, "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$webviewPort")
    $ownsTestPolicy = $true
    $app = Start-Process -FilePath $installed -WorkingDirectory $installDir -WindowStyle Hidden -PassThru -Environment @{
        WEBVIEW2_USER_DATA_FOLDER = $webviewProfile
    }
    try {
        if (-not $app.WaitForInputIdle(20000) -or $app.HasExited) {
            throw 'The installed executable did not reach an idle Windows message loop.'
        }
        $runtimeDeadline = [Diagnostics.Stopwatch]::StartNew()
        do {
            if ($app.HasExited) {
                throw "The installed app exited before WebView2 started (exit $($app.ExitCode))."
            }
            $runtime = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe' AND ParentProcessId=$($app.Id)" |
                Where-Object { $_.CommandLine -and $_.CommandLine.Contains($webviewProfile, [StringComparison]::OrdinalIgnoreCase) } |
                Select-Object -First 1
            if ($runtime -and (Test-Path -LiteralPath $webviewProfile -PathType Container)) { break }
            Start-Sleep -Milliseconds 250
        } while ($runtimeDeadline.ElapsedMilliseconds -lt 20000)
        if (-not $runtime -or -not (Test-Path -LiteralPath $webviewProfile -PathType Container) -or $app.HasExited) {
            throw 'The installed app did not start WebView2 with its isolated test profile.'
        }
        if (-not $runtime.CommandLine.Contains("--remote-debugging-port=$webviewPort")) {
            throw 'WebView2 did not apply the executable-specific debug policy.'
        }
        $probe = node (Join-Path $PSScriptRoot 'check-windows-webview.mjs') $webviewPort
        if ($LASTEXITCODE -ne 0) { throw "The WebView2 connection test failed (exit $LASTEXITCODE)." }
        $connection = $probe | ConvertFrom-Json -AsHashtable
        if ($connection.schema -cne 'ellmos-system-gui.windows-webview-check.v1' -or
            $connection.loopback_opt_in_enforced -ne $true -or $connection.fixture_opened -ne $true -or
            $connection.authentication_required -ne $true) {
            throw 'The WebView2 connection test did not return its expected receipt.'
        }
        $pages = $connection.native_pages
        if ($pages.source_commit -cne $env:DESKTOP_SOURCE_COMMIT -or $pages.routes.Count -ne 3 -or
            $pages.web_build_page_count -ne $pages.page_contract_count -or $pages.uncaught_javascript_errors -ne 0) {
            throw 'The native page smoke did not return its expected receipt.'
        }
        Close-TestDesktop $app
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
    try {
        if ($ownsTestPolicy) { $testPolicy.DeleteValue($binaryName) }
    } finally {
        if ($testPolicy) { $testPolicy.Dispose() }
        Uninstall-Nsis $installDir $regPath $uninstallCopy
    }
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
    installed_webview = [ordered]@{
        runtime_child_started = $true
        isolated_profile_created = $true
        clean_window_exit = $true
        connection = $connection
    }
    installed_files_and_registration_removed = $true
}
if ($null -ne $legacy) {
    $evidence['legacy_migration'] = $legacy
    $evidence['signed_nsis_update'] = Test-SignedNsisUpdate $installer $installerHash $payloadHash `
        $config.version $regPath $profileSamples
}
$evidence | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath (Join-Path $package 'windows-installer-check.json') -Encoding utf8
Write-Output "Installed, launched and uninstalled Windows desktop version $($config.version)."
