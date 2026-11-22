use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_updater::{Config, Update, UpdaterExt};

use crate::{local_document, AttachPermit, CONNECTION};

const ENDPOINT: &str =
    "https://github.com/ellmos-ai/ellmos-system-gui/releases/latest/download/latest.json";
const SCHEMA: &str = "ellmos-system-gui.desktop-update.v1";

#[derive(Default)]
pub struct DesktopUpdates {
    busy: AtomicBool,
    pending: Mutex<Option<Update>>,
}

#[derive(Serialize)]
pub struct DesktopUpdateReceipt {
    schema: &'static str,
    state: &'static str,
    installed_version: String,
    offered_version: Option<String>,
}

fn authorize(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != CONNECTION || !window.url().is_ok_and(|url| local_document(&url)) {
        return Err("Desktop-Updates sind nur im lokalen Anschlussfenster verfügbar.".into());
    }
    Ok(())
}

fn approved_config(config: &Config) -> bool {
    !config.pubkey.trim().is_empty()
        && config.require_signed_version
        && !config.allow_downgrades
        && !config.dangerous_insecure_transport_protocol
        && !config.dangerous_accept_invalid_certs
        && !config.dangerous_accept_invalid_hostnames
        && config.endpoints.len() == 1
        && config.endpoints[0].as_str() == ENDPOINT
}

fn configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|value| serde_json::from_value::<Config>(value.clone()).ok())
        .is_some_and(|config| approved_config(&config))
}

impl DesktopUpdates {
    fn begin(&self) -> Result<AttachPermit<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Eine Update-Prüfung oder Installation läuft bereits.".to_string())?;
        Ok(AttachPermit(&self.busy))
    }

    fn replace(&self, next: Option<Update>) -> Result<Option<Update>, String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Der Update-Status ist nicht verfügbar.".to_string())?;
        Ok(std::mem::replace(&mut *pending, next))
    }
}

fn receipt(
    app: &AppHandle,
    state: &'static str,
    offered_version: Option<String>,
) -> DesktopUpdateReceipt {
    DesktopUpdateReceipt {
        schema: SCHEMA,
        state,
        installed_version: app.package_info().version.to_string(),
        offered_version,
    }
}

#[tauri::command]
pub async fn check_desktop_update(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, DesktopUpdates>,
) -> Result<DesktopUpdateReceipt, String> {
    authorize(&window)?;
    let _permit = state.begin()?;
    state.replace(None)?;
    if !configured(&app) {
        return Ok(receipt(&app, "unavailable", None));
    }
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(120))
        .configure_client(|client| client.https_only(true))
        .build()
        .map_err(|_| "Der Update-Kanal konnte nicht vorbereitet werden.".to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|_| "Der Update-Kanal konnte nicht geprüft werden.".to_string())?;
    if let Some(update) = update {
        if update.download_url.scheme() != "https"
            || !update.download_url.username().is_empty()
            || update.download_url.password().is_some()
        {
            return Err("Das Update hat keine sichere Download-Adresse.".into());
        }
        let version = update.version.clone();
        state.replace(Some(update))?;
        Ok(receipt(&app, "available", Some(version)))
    } else {
        Ok(receipt(&app, "current", None))
    }
}

#[tauri::command]
pub async fn install_desktop_update(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, DesktopUpdates>,
    expected_version: String,
) -> Result<DesktopUpdateReceipt, String> {
    authorize(&window)?;
    let _permit = state.begin()?;
    if !configured(&app) {
        return Err("Für diesen Build ist kein signierter Update-Kanal eingerichtet.".into());
    }
    let update = state
        .replace(None)?
        .filter(|update| update.version == expected_version)
        .ok_or_else(|| "Bitte prüfe das Update erneut.".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|_| "Das Update konnte nicht verifiziert oder installiert werden.".to_string())?;
    Ok(receipt(&app, "installed", Some(update.version)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Public half of a disposable key and the versioned signature of PAYLOAD.
    // The private key is discarded and never appears in the checkout.
    const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEMzN0RERUIzMUFEM0M1MzUKUldRMXhkTWFzOTU5d3crcVdESCtsMjR5cE5PbUhyekFFRTQwTVJ5N2VjdEJsNEc1SFVCcFpEVUUK";
    const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRMXhkTWFzOTU5dzRHQTdoVjcxM0NrREJUUTVnemVkaUE0NnQvQU1KU3Q2bnN2WktsYVJmUzJCbVZsUUNVeGZGaUNKcEJEeDFkMVkwVXN4UFFHLzFtemY0bUFKdHdHS2c0PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk1MzEwNTE4CWZpbGU6cGF5bG9hZAl2ZXJzaW9uOjIuMC4wCm40QTgvTnlicFNKSXFETlNKczZHQXdrUVMxVTQ0ejBvS3RFWWhpYjVvRnkwYnN4dThVdGhqNktQTm9IODhlTHlyZGFhOFZ0Q2gyM3JDQmxOS3hXRkRBPT0K";
    const PAYLOAD: &[u8] = b"Ocean desktop updater test";

    fn fixture_config() -> Config {
        Config {
            pubkey: PUBLIC_KEY.to_owned(),
            endpoints: vec![ENDPOINT.parse().unwrap()],
            require_signed_version: true,
            ..Config::default()
        }
    }

    #[test]
    fn no_update_channel_without_pinned_key_and_strict_verification() {
        let valid = fixture_config();
        assert!(approved_config(&valid));
        assert!(!approved_config(&Config {
            pubkey: String::new(),
            ..fixture_config()
        }));
        assert!(!approved_config(&Config {
            require_signed_version: false,
            ..fixture_config()
        }));
        assert!(!approved_config(&Config {
            dangerous_accept_invalid_certs: true,
            ..fixture_config()
        }));
        assert!(!approved_config(&Config {
            endpoints: vec!["https://example.invalid/latest.json".parse().unwrap()],
            ..fixture_config()
        }));
    }

    #[test]
    fn verifies_bytes_and_signing_version_without_installing() {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".into(),
            json!({"pubkey": PUBLIC_KEY, "requireSignedVersion": true, "endpoints": [ENDPOINT]}),
        );
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let updater = app
            .updater_builder()
            .target("desktop-test")
            .executable_path(std::env::current_exe().unwrap())
            .configure_client(|_| panic!("offline test must not make a request"))
            .build()
            .unwrap();
        let manifest = |version| {
            json!({
                "version": version,
                "url": "https://example.invalid/update",
                "signature": SIGNATURE
            })
        };
        let update = updater.restore_update(manifest("2.0.0")).unwrap().unwrap();
        assert!(update.verify(PAYLOAD).is_ok());
        assert!(update.verify(b"modified package").is_err());
        let replay = updater.restore_update(manifest("3.0.0")).unwrap().unwrap();
        assert!(replay.verify(PAYLOAD).is_err());
    }

    #[cfg(any(target_os = "linux", target_os = "macos", windows))]
    #[test]
    #[ignore = "requires the CI-generated HTTPS fixture and temporary installed app"]
    fn signed_update_installs_verified_package() {
        use std::{fs, path::PathBuf};
        use tauri_plugin_updater::Error;

        assert_eq!(std::env::var("GITHUB_ACTIONS").as_deref(), Ok("true"));
        assert_eq!(
            std::env::var("RUNNER_ENVIRONMENT").as_deref(),
            Ok("github-hosted")
        );
        let root = PathBuf::from(std::env::var_os("OCEAN_SIGNED_UPDATE_FIXTURE").unwrap())
            .canonicalize()
            .unwrap();
        let runner_temp = PathBuf::from(std::env::var_os("RUNNER_TEMP").unwrap())
            .canonicalize()
            .unwrap();
        assert_eq!(root.parent(), Some(runner_temp.as_path()));
        #[cfg(target_os = "macos")]
        let (prefix, relative_path) = (
            "ocean-dmg-",
            "Applications/BACH Ocean.app/Contents/MacOS/ellmos-system-gui-desktop",
        );
        #[cfg(target_os = "linux")]
        let (prefix, relative_path) = ("ocean-signed-appimage-", "Ocean.AppImage");
        #[cfg(windows)]
        let (prefix, relative_path) = (
            "ocean-signed-nsis-",
            "installed app/ellmos-system-gui-desktop.exe",
        );
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(prefix));
        let executable = root.join(relative_path);
        assert_eq!(executable.canonicalize().unwrap(), executable);
        let old_bytes = fs::read(&executable).unwrap();

        let origin =
            tauri::Url::parse(&fs::read_to_string(root.join("update-origin")).unwrap()).unwrap();
        assert_eq!(
            (origin.scheme(), origin.host_str()),
            ("https", Some("127.0.0.1"))
        );
        assert!(origin.port().is_some());
        let certificate =
            reqwest_updater::Certificate::from_pem(&fs::read(root.join("update-ca.pem")).unwrap())
                .unwrap();
        let manifest = |kind| origin.join(kind).unwrap();
        let previous_version = if cfg!(windows) { "0.2.39" } else { "0.2.38" };
        let app_config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.package_info_mut().version = previous_version.parse().unwrap();
        context.config_mut().plugins.0.insert(
            "updater".into(),
            json!({
                "pubkey": fs::read_to_string(root.join("update-key.pub")).unwrap().trim(),
                "requireSignedVersion": true,
                "windows": app_config["plugins"]["updater"]["windows"],
                "endpoints": [manifest("/valid/latest.json")]
            }),
        );
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();

        tauri::async_runtime::block_on(async {
            let checked_update = |endpoint| {
                let certificate = certificate.clone();
                app.updater_builder()
                    .executable_path(&executable)
                    .timeout(Duration::from_secs(30))
                    .no_proxy()
                    .configure_client(move |client| {
                        client
                            .https_only(true)
                            .tls_certs_only([certificate.clone()])
                    })
                    .endpoints(vec![manifest(endpoint)])
                    .unwrap()
                    .build()
                    .unwrap()
            };
            for endpoint in ["/tampered/latest.json", "/wrong-version/latest.json"] {
                let update = checked_update(endpoint).check().await.unwrap().unwrap();
                let error = update
                    .download_and_install(|_, _| {}, || {})
                    .await
                    .unwrap_err();
                if endpoint.starts_with("/tampered") {
                    assert!(matches!(error, Error::Minisign(_)), "{error:?}");
                } else {
                    assert!(
                        matches!(error, Error::SignedVersionMismatch { .. }),
                        "{error:?}"
                    );
                }
                assert_eq!(fs::read(&executable).unwrap(), old_bytes);
            }
            let update = checked_update("/valid/latest.json")
                .check()
                .await
                .unwrap()
                .unwrap();
            assert_eq!(update.current_version, previous_version);
            assert_eq!(update.version, "0.2.40");
            #[cfg(windows)]
            {
                // NSIS runs as a separate process and the updater exits this test process
                // on a successful handoff. The fixture driver verifies the installed files.
                let bytes = update.download(|_, _| {}, || {}).await.unwrap();
                fs::write(root.join("update-checks-complete"), b"verified").unwrap();
                update.install(bytes).unwrap();
                panic!("Windows updater returned without exiting after installer handoff");
            }
            #[cfg(not(windows))]
            {
                update.download_and_install(|_, _| {}, || {}).await.unwrap();
                assert_ne!(fs::read(&executable).unwrap(), old_bytes);
            }
        });
    }
}
