use serde::Deserialize;
use std::{
    env, io,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, Url, WebviewWindow};

#[derive(Deserialize)]
struct Inputs {
    origin: String,
    open_task: String,
    done_task: String,
    worker: String,
}

fn evaluation(window: &WebviewWindow, script: &str) -> Result<Option<String>, String> {
    let (sender, receiver) = mpsc::channel();
    window
        .eval_with_callback(script, move |value| {
            let _ = sender.send(value);
        })
        .map_err(|error| error.to_string())?;
    // Wry can defer script evaluation while a document is still loading.
    Ok(receiver
        .recv_timeout(Duration::from_secs(3))
        .ok()
        .filter(|value| !value.is_empty() && value != "null"))
}

fn evaluate(window: &WebviewWindow, script: &str) -> Result<bool, String> {
    let Some(value) = evaluation(window, script)? else {
        return Ok(false);
    };
    serde_json::from_str(&value)
        .map_err(|error| format!("Unexpected WKWebView response {value}: {error}"))
}

fn wait_for(label: &str, mut check: impl FnMut() -> Result<bool, String>) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if check()? {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!("WKWebView smoke did not reach {label}"));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn native_visible(window: &WebviewWindow) -> Result<bool, String> {
    window.is_visible().map_err(|error| error.to_string())
}

fn wait_dom(window: &WebviewWindow, label: &str, script: &str) -> Result<(), String> {
    wait_for(label, || evaluate(window, script))
}

fn action(window: &WebviewWindow, script: &str) -> Result<(), String> {
    if evaluate(window, script)? {
        Ok(())
    } else {
        Err("WKWebView did not acknowledge the fixture action".into())
    }
}

fn contains_text(selector: &str, text: &str) -> String {
    format!(
        "(() => {{ const node = document.querySelector({}); \
         return Boolean(node?.getClientRects().length && node.innerText.includes({})); }})()",
        serde_json::json!(selector),
        serde_json::json!(text)
    )
}

fn record_page(
    window: &WebviewWindow,
    origin: &str,
    path: &str,
    heading: &str,
) -> Result<(), String> {
    let url = window.url().map_err(|error| error.to_string())?;
    if url.origin().ascii_serialization() != origin
        || url.path() != path
        || !native_visible(window)?
    {
        return Err(format!(
            "Unexpected native window URL or visibility at {path}: {url}"
        ));
    }
    wait_dom(window, path, &contains_text("#main-content h1", heading))
}

fn walk(app: &AppHandle, connection: &WebviewWindow, inputs: Inputs) -> Result<(), String> {
    let url = connection.url().ok();
    eprintln!(
        "WKWebView smoke: connection window visible={}, url={url:?}",
        native_visible(connection)?
    );
    wait_for("the visible bundled connection form", || {
        Ok(native_visible(connection)?
            && evaluate(connection, "Boolean(document.querySelector('#backend-url'))")?)
    })
    .map_err(|error| {
        let state = evaluation(
            connection,
            "({url:location.href,ready:document.readyState, title:document.title, form:!!document.querySelector('#backend-url')})",
        );
        format!("{error}. WKWebView state: {state:?}; URL: {:?}", connection.url())
    })?;
    eprintln!("WKWebView smoke: bundled connection form ready");
    action(connection, &format!(
        "(() => {{ document.querySelector('#backend-url').value = {}; document.querySelector('#connect').click(); return true; }})()",
        serde_json::json!(inputs.origin)
    ))?;
    wait_dom(
        connection,
        "HTTP consent enforcement",
        "document.querySelector('#connection-status')?.dataset.state === 'error'",
    )?;
    action(connection,
        "(() => { document.querySelector('#allow-loopback-http').click(); document.querySelector('#connect').click(); return true; })()")?;
    wait_for("the native backend window", || {
        match app.get_webview_window(super::BACKEND) {
            Some(window) => native_visible(&window),
            None => Ok(false),
        }
    })?;
    eprintln!("WKWebView smoke: native backend window visible");
    let backend = app
        .get_webview_window(super::BACKEND)
        .ok_or("Backend window disappeared")?;
    let open_dashboard = contains_text("#tasks-container", &inputs.open_task);
    wait_dom(&backend, "the dashboard test task", &open_dashboard)?;
    record_page(&backend, &inputs.origin, "/", "Willkommen")?;
    action(
        &backend,
        r#"(() => {document.querySelector('#main-content a[href="/tasks"]').click(); return true;})()"#,
    )?;
    let open_task = contains_text("#tasks-table-container", &inputs.open_task);
    wait_dom(&backend, "the open task", &open_task)?;
    action(&backend,
        "(() => {const filter = document.querySelector('#tasks-status-filter'); filter.value = 'done'; filter.dispatchEvent(new Event('change', {bubbles:true})); return true;})()")?;
    wait_dom(
        &backend,
        "the completed task",
        &contains_text("#tasks-table-container", &inputs.done_task),
    )?;
    if evaluate(&backend, &open_task)? {
        return Err("The completed-task filter left the open task visible".into());
    }
    record_page(&backend, &inputs.origin, "/tasks", "Aufgaben")?;

    action(&backend, "(() => {history.back(); return true;})()")?;
    wait_dom(&backend, "the dashboard after going back", &open_dashboard)?;
    action(
        &backend,
        r#"(() => {document.querySelector('#main-content a[href="/agenten/running"]').click(); return true;})()"#,
    )?;
    wait_dom(
        &backend,
        "the ready worker count",
        &contains_text("#worker-status-summary", "1 Worker registriert"),
    )?;
    let worker = contains_text("#ready-agents-grid", &inputs.worker);
    wait_dom(&backend, "the ready worker", &worker)?;
    let search =
        "const input = document.querySelector('#agent-overview-query'); input.dispatchEvent(new Event('input', {bubbles:true})); return true;";
    action(&backend, &format!(
        "(() => {{document.querySelector('#agent-overview-query').value = 'anderer Name'; {search}}})()"
    ))?;
    wait_dom(
        &backend,
        "the filtered worker list",
        &format!("!({worker})"),
    )?;
    action(
        &backend,
        &format!(
            "(() => {{document.querySelector('#agent-overview-query').value = ''; {search}}})()"
        ),
    )?;
    wait_dom(&backend, "the restored worker", &worker)?;
    record_page(
        &backend,
        &inputs.origin,
        "/agenten/running",
        "Living & Running",
    )?;

    backend.close().map_err(|error| error.to_string())?;
    wait_for("the restored connection window", || {
        Ok(app.get_webview_window(super::BACKEND).is_none() && native_visible(connection)?)
    })?;
    println!(
        "{}",
        serde_json::json!({
            "schema":"ellmos-system-gui.macos-wkwebview-smoke.v1",
            "renderer":"WKWebView",
            "native_windows_observed":true,
            "connection_restored_after_backend_close":true,
            "http_consent_enforced":true,
            "tasks_filter_verified":true,
            "running_search_verified":true,
            "routes":["/","/tasks","/agenten/running"]
        })
    );
    connection.close().map_err(|error| error.to_string())
}

pub(super) fn start(app: AppHandle, connection: WebviewWindow) -> io::Result<()> {
    if env::var("GITHUB_ACTIONS").as_deref() != Ok("true")
        || env::var("RUNNER_ENVIRONMENT").as_deref() != Ok("github-hosted")
        || env::var("RUNNER_OS").as_deref() != Ok("macOS")
    {
        return Err(io::Error::other("Use the disposable hosted macOS runner"));
    }
    let inputs: Inputs =
        serde_json::from_str(&env::var("OCEAN_MAC_SMOKE_INPUTS").map_err(io::Error::other)?)
            .map_err(io::Error::other)?;
    let url = Url::parse(&inputs.origin).map_err(io::Error::other)?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.origin().ascii_serialization() != inputs.origin
    {
        return Err(io::Error::other(
            "Expected an isolated loopback HTTP fixture",
        ));
    }

    thread::spawn(move || {
        if let Err(error) = walk(&app, &connection, inputs) {
            eprintln!("WKWebView smoke: {error}");
            app.exit(1);
        }
    });
    Ok(())
}
