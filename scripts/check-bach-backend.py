#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Run the public BACH GUI and Control API with a fresh database on a CI runner."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sys
import tempfile
import threading
import time
from zipfile import ZipFile

import httpx
from playwright.sync_api import expect, sync_playwright
import uvicorn


PAGES = {
    "/": ("index.html", "dashboard", re.compile("Willkommen")),
    "/tasks": ("tasks.html", "aufgaben", "Aufgaben"),
    "/agenten/running": ("agenten/running.html", "running", "Living & Running"),
}
OPEN_TASK = "Offene Aufgabe für die BACH-Backendprüfung"
DONE_TASK = "Erledigte Aufgabe für die BACH-Backendprüfung"


def load_gui(bach, archive, scratch):
    pin = json.loads((bach / "system/gui/gui-consumer.v1.json").read_text(encoding="utf-8"))
    with archive.open("rb") as bundle:
        archive_sha = hashlib.file_digest(bundle, "sha256").hexdigest()
    assert archive_sha == pin["release_archive_sha256"], "Unexpected BACH GUI archive hash"
    with ZipFile(archive) as bundle:
        bundle.extractall(scratch / "gui")
    (manifest_path,) = (scratch / "gui").rglob("dist-manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["source_commit"] == pin["pinned_source_commit"]
    return manifest_path.parent, manifest, archive_sha


def prepare_backend(bach, dist, scratch):
    home = scratch / "home"
    home.mkdir()
    database = scratch / "bach.db"
    os.environ.update(
        HOME=str(home),
        XDG_CONFIG_HOME=str(home / ".config"),
        XDG_DATA_HOME=str(home / ".local/share"),
        XDG_STATE_HOME=str(home / ".local/state"),
        XDG_CACHE_HOME=str(home / ".cache"),
        BACH_DB=str(database),
        BACH_NO_AUTO_MIGRATE="1",
        BACH_CONTROL_HOST="127.0.0.1",
        BACH_CONTROL_PORT="0",
        BACH_CONTROL_API_TOKEN=secrets.token_urlsafe(32),
        ELLMOS_SYSTEM_GUI_DIST=str(dist),
    )
    sys.path[:0] = [str(bach), str(bach / "system")]
    from setup import BACHSetup

    setup = BACHSetup(bach_root=bach)
    setup.db_path = database
    # The committed schema is the fresh database snapshot for this API test.
    # The installer migration sequence is exercised independently.
    setup._step_s2_db_init(None)
    from gui.device_auth import create_device
    from hub.bach_paths import BACH_DB

    assert Path(BACH_DB).resolve() == database
    return create_device("BACH-CI-Device")


def wait_for_gui(server, thread, origin):
    with httpx.Client(trust_env=False, timeout=2) as client:
        deadline = time.monotonic() + 35
        while thread.is_alive() and time.monotonic() < deadline:
            if server.started:
                response = client.get(origin + "/api/gui/capabilities")
                assert response.status_code == 200, response.status_code
                assert response.json()["schema"] == "ellmos.gui.capabilities.v1"
                return
            time.sleep(0.1)
    raise RuntimeError("BACH GUI did not start")


def check_http(origin, token, manifest):
    with httpx.Client(base_url=origin, trust_env=False, timeout=15) as client:
        for path in ("/api/tasks", "/api/system/workers"):
            assert client.get(path).status_code == 401, path
        client.headers["Authorization"] = "Bearer " + token
        kit = client.get("/api/gui/kit-manifest").raise_for_status().json()
        dist = kit["installed_dist"]
        assert dist["verified"] is True, dist.get("reason_code")
        assert kit["pinned_source_commit"] == manifest["source_commit"]
        assert dist["page_count"] == kit["expected_page_count"]
        pages = {}
        for path, (file, _, _) in PAGES.items():
            response = client.get(path).raise_for_status()
            assert response.headers["content-type"].startswith("text/html"), path
            digest = hashlib.sha256(response.content).hexdigest()
            assert digest == manifest["files"][file], path
            pages[path] = digest

        task_ids = {}
        for state, title in (("pending", OPEN_TASK), ("done", DONE_TASK)):
            task = client.post("/api/tasks", json={"title": title, "status": state}).raise_for_status().json()
            assert task.get("success") is True, f"BACH did not create the {state} task"
            stored = client.get("/api/tasks", params={"status": state}).raise_for_status().json()
            assert any(row["id"] == task["id"] and row["title"] == title for row in stored["tasks"])
            task_ids[state] = task["id"]

        workers = client.get("/api/system/workers").raise_for_status().json()
        assert workers["schema"] == "bach.workers.status.v1"
        assert workers["availability"] == "available"
        assert workers["source"] == "authenticated_local_control_api"
        assert workers["count"] == len(workers["workers"])
    return {"page_count": dist["page_count"], "pages": pages, "task_ids": task_ids, "worker_count": workers["count"]}


def check_browser(origin, token, out):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={"width": 1400, "height": 950})
        context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(origin + "/") else route.abort())
        session = context.request.post(origin + "/api/devices/verify", headers={"Origin": origin}, data={"token": token})
        assert session.ok and session.json().get("valid") is True, "BACH did not establish a browser session"
        assert any(cookie["name"] == "bach_device_token" and cookie["httpOnly"] for cookie in context.cookies(origin))
        assert context.request.get(origin + "/api/tasks").ok, "Browser cookie did not authorize the tasks API"

        page = context.new_page()
        page.set_default_timeout(20000)
        expect.set_options(timeout=20000)
        errors = []
        page.on("pageerror", lambda error: errors.append(error.name))

        def record(path):
            _, name, heading = PAGES[path]
            assert page.url == origin + path
            expect(page.get_by_role("heading", level=1, name=heading)).to_be_visible()
            page.screenshot(path=out / f"{name}.png")

        assert page.goto(origin + "/", wait_until="domcontentloaded").ok
        expect(page.locator("#tasks-container").get_by_text(OPEN_TASK)).to_be_visible()
        record("/")
        page.locator('#main-content a[href="/tasks"]').click()
        tasks = page.locator("#tasks-table-container")
        expect(tasks.get_by_text(OPEN_TASK, exact=True)).to_be_visible()
        page.locator("#tasks-status-filter").select_option("done")
        expect(tasks.get_by_text(DONE_TASK, exact=True)).to_be_visible()
        expect(tasks.get_by_text(OPEN_TASK, exact=True)).to_have_count(0)
        record("/tasks")

        page.go_back(wait_until="domcontentloaded")
        with page.expect_response(lambda response: response.url == origin + "/api/system/workers") as worker_read:
            page.locator('#main-content a[href="/agenten/running"]').last.click()
        assert worker_read.value.ok, worker_read.value.status
        assert worker_read.value.json()["source"] == "authenticated_local_control_api"
        record("/agenten/running")
        assert not errors, f"Uncaught browser errors: {errors}"
        context.close()
        browser.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bach", type=Path)
    parser.add_argument("archive", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix="bach-backend-") as directory:
        scratch = Path(directory).resolve()
        bach = args.bach.resolve()
        dist, manifest, archive_sha = load_gui(bach, args.archive, scratch)
        token = prepare_backend(bach, dist, scratch)
        from gui.server import app
        from hub._services.chat.telegram_chat import start_control_api

        control = start_control_api()
        assert control is not None, "BACH Control API did not start"
        os.environ["BACH_CONTROL_PORT"] = str(control.server_port)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            origin = f"http://127.0.0.1:{listener.getsockname()[1]}"
            server = uvicorn.Server(uvicorn.Config(app, access_log=False))
            thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
            thread.start()
            try:
                wait_for_gui(server, thread, origin)
                result = check_http(origin, token, manifest)
                check_browser(origin, token, args.out)
            finally:
                server.should_exit = True
                thread.join(10)
                control.always_on_startup_stop.set()
                control.shutdown()
                control.server_close()
                assert not thread.is_alive(), "BACH GUI did not stop"
        result.update(
            bach_commit=os.environ["BACH_COMMIT"],
            gui_commit=manifest["source_commit"],
            gui_archive_sha256=archive_sha,
            anonymous_task_and_worker_reads_rejected=True,
            chromium_browser_session_verified=True,
        )
        (args.out / "result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
