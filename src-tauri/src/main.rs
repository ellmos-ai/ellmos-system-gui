#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{Manager, Url, WebviewUrl, WebviewWindow, WindowEvent};

const CONNECTION: &str = "connection";
const BACKEND: &str = "backend";
const MAX_METADATA_BYTES: usize = 1024 * 1024;

#[derive(Default)]
struct DesktopState {
    attaching: AtomicBool,
    connection_epoch: AtomicU64,
}

struct AttachPermit<'a>(&'a AtomicBool);

impl Drop for AttachPermit<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AttachRequest {
    url: String,
    allow_loopback_http: bool,
}

#[derive(Serialize)]
struct AttachReceipt {
    schema: &'static str,
    origin: String,
    transport: &'static str,
    contract: &'static str,
    instance_verified: bool,
    backend_started: bool,
}

fn local_document(url: &Url) -> bool {
    matches!((url.scheme(), url.host_str()),
        ("tauri", Some("localhost"))
        | ("http" | "https", Some("tauri.localhost")))
        && matches!(url.path(), "/" | "/index.html")
        && url.username().is_empty()
        && url.password().is_none()
}

fn target_url(request: &AttachRequest) -> Result<Url, String> {
    if request.url.len() > 2048 || request.url.chars().any(char::is_control) {
        return Err("Die Backendadresse ist ungültig.".into());
    }
    let url = Url::parse(request.url.trim())
        .map_err(|_| "Bitte eine vollständige Backendadresse eingeben.".to_string())?;
    if !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some()
    {
        return Err("Die Backendadresse darf keine Zugangsdaten, Suchparameter oder Fragmente enthalten.".into());
    }
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]" | "::1"));
    if url.scheme() != "https"
        && !(url.scheme() == "http" && loopback && request.allow_loopback_http)
    {
        return Err("HTTPS verwenden. HTTP ist nur für ausdrücklich bestätigte lokale Loopbackadressen möglich.".into());
    }
    if url.host_str().is_none() {
        return Err("Der Backendhost fehlt.".into());
    }
    Ok(url)
}

fn same_origin(url: &Url, origin: &str) -> bool {
    matches!(url.scheme(), "https" | "http")
        && url.username().is_empty()
        && url.password().is_none()
        && url.origin().ascii_serialization() == origin
}

async fn observe_contract(target: &Url) -> Result<&'static str, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .map_err(|_| "Die Verbindung konnte nicht vorbereitet werden.".to_string())?;
    let metadata = target.join("/api/gui/capabilities")
        .map_err(|_| "Die Backendadresse ist ungültig.".to_string())?;
    let mut response = client.get(metadata).send().await
        .map_err(|_| "Das Backend ist nicht erreichbar oder sein Zertifikat konnte nicht geprüft werden.".to_string())?;
    let status = response.status();
    if status.is_redirection() {
        let location = response.headers().get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| target.join(value).ok());
        if !location.as_ref().is_some_and(|url| same_origin(url, &target.origin().ascii_serialization())) {
            return Err("Das Backend leitet die Anmeldung an einen anderen Ursprung weiter.".into());
        }
        return Ok("authentication_required");
    }
    if matches!(status.as_u16(), 401 | 403) {
        return Ok("authentication_required");
    }
    if !status.is_success() {
        return Err("Das Backend stellt die gemeinsame GUI-Anbindung derzeit nicht bereit.".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await
        .map_err(|_| "Die Backendauskunft konnte nicht vollständig gelesen werden.".to_string())?
    {
        if body.len() + chunk.len() > MAX_METADATA_BYTES {
            return Err("Die Backendauskunft überschreitet die erlaubte Größe.".into());
        }
        body.extend_from_slice(&chunk);
    }
    let report: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| "Das Backend liefert keinen gültigen GUI-Vertrag.".to_string())?;
    if report.get("schema").and_then(|value| value.as_str()) != Some("ellmos.gui.capabilities.v1") {
        return Err("Das Backend unterstützt den gemeinsamen GUI-Vertrag nicht.".into());
    }
    Ok("schema_observed_instance_unverified")
}

#[tauri::command]
async fn attach(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, DesktopState>,
    request: AttachRequest,
) -> Result<AttachReceipt, String> {
    // The ACL is also checked by Tauri. Keep the caller boundary explicit here.
    if window.label() != CONNECTION || !local_document(&window.url().map_err(|_| "Lokale Anschlussseite nicht verfügbar.")?) {
        return Err("Nur die lokale Anschlussseite darf eine Verbindung öffnen.".into());
    }
    if state.attaching.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed).is_err() {
        return Err("Eine Verbindung wird bereits vorbereitet.".into());
    }
    let _permit = AttachPermit(&state.attaching);
    let epoch = state.connection_epoch.load(Ordering::Acquire);
    if app.get_webview_window(BACKEND).is_some() {
        return Err("Bitte die bestehende Verbindung zuerst über das Menü wechseln.".into());
    }
    let target = target_url(&request)?;
    let contract = observe_contract(&target).await?;
    if state.connection_epoch.load(Ordering::Acquire) != epoch {
        return Err("Der Verbindungsaufbau wurde abgebrochen.".into());
    }
    let origin = target.origin().ascii_serialization();
    let allowed_origin = origin.clone();
    let title = if contract == "authentication_required" {
        "BACH · Ocean – Anmeldung erforderlich"
    } else {
        "BACH · Ocean"
    };
    let backend = WebviewWindowBuilder::new(&app, BACKEND, WebviewUrl::External(target.clone()))
        .title(title)
        .visible(false)
        .inner_size(1280.0, 840.0)
        .min_inner_size(640.0, 480.0)
        .on_navigation(move |url| same_origin(url, &allowed_origin))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()
        .map_err(|_| "Das App-Fenster konnte nicht geöffnet werden.".to_string())?;
    if state.connection_epoch.load(Ordering::Acquire) != epoch {
        let _ = backend.close();
        return Err("Der Verbindungsaufbau wurde abgebrochen.".into());
    }
    // Hide before showing the backend: a subsequent close must reveal this
    // connection screen without a late hide racing its Destroyed handler.
    if window.hide().is_err() || backend.show().is_err() {
        let _ = backend.close();
        show_connection(&app);
        return Err("Das App-Fenster konnte nicht angezeigt werden.".into());
    }
    if state.connection_epoch.load(Ordering::Acquire) != epoch {
        let _ = backend.close();
        show_connection(&app);
        return Err("Der Verbindungsaufbau wurde abgebrochen.".into());
    }
    let _ = backend.set_focus();
    Ok(AttachReceipt {
        schema: "ellmos-system-gui.desktop-attach.v1",
        origin,
        transport: if target.scheme() == "https" { "https_certificate_checked" } else { "explicit_loopback_http" },
        contract,
        instance_verified: false,
        backend_started: false,
    })
}

fn show_connection(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(CONNECTION) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if app.state::<DesktopState>().attaching.load(Ordering::Acquire) {
                show_connection(app);
                return;
            }
            if let Some(window) = app.get_webview_window(BACKEND) {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            } else {
                show_connection(app);
            }
        }))
        .manage(DesktopState::default())
        .invoke_handler(tauri::generate_handler![attach])
        .setup(|app| {
            let connection = SubmenuBuilder::new(app, "Verbindung")
                .text("connection", "Verbindung wechseln …")
                .text("reload", "Ansicht neu laden")
                .separator()
                .text("quit", "App schließen")
                .build()?;
            let edit = SubmenuBuilder::new(app, "Bearbeiten")
                .item(&PredefinedMenuItem::undo(app, Some("Rückgängig"))?)
                .item(&PredefinedMenuItem::redo(app, Some("Wiederholen"))?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, Some("Ausschneiden"))?)
                .item(&PredefinedMenuItem::copy(app, Some("Kopieren"))?)
                .item(&PredefinedMenuItem::paste(app, Some("Einfügen"))?)
                .item(&PredefinedMenuItem::select_all(app, Some("Alles auswählen"))?)
                .build()?;
            let menu = MenuBuilder::new(app).item(&connection).item(&edit).build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| match event.id().as_ref() {
                "connection" => {
                    app.state::<DesktopState>().connection_epoch.fetch_add(1, Ordering::AcqRel);
                    if let Some(window) = app.get_webview_window(BACKEND) {
                        let _ = window.close();
                    }
                    show_connection(app);
                }
                "reload" => {
                    if let Some(window) = app.get_webview_window(BACKEND) {
                        let _ = window.eval("window.location.reload()");
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            });
            WebviewWindowBuilder::new(app, CONNECTION, WebviewUrl::App("index.html".into()))
                .title("BACH · Ocean verbinden")
                .inner_size(760.0, 620.0)
                .min_inner_size(560.0, 520.0)
                .on_navigation(local_document)
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Destroyed if window.label() == BACKEND => show_connection(window.app_handle()),
            WindowEvent::CloseRequested { .. } if window.label() == CONNECTION => window.app_handle().exit(0),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("desktop runtime failed");
}
