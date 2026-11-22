"""Check the exact DMG artifact in a disposable macOS runner session."""

import hashlib
import json
import os
import plistlib
import re
import shutil
import ssl
import subprocess
import tempfile
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

WINDOW_PROBE = r"""
import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let pid = Int32(CommandLine.arguments[1]),
      let application = NSRunningApplication(processIdentifier: pid),
      let bundle = application.bundleURL,
      bundle.resolvingSymlinksInPath().path == CommandLine.arguments[2],
      let windows = CGWindowListCopyWindowInfo(
          [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
      ) as? [[String: Any]]
else { exit(1) }

for window in windows {
    guard (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
          (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
          let bounds = window[kCGWindowBounds as String] as? [String: Any],
          let width = (bounds["Width"] as? NSNumber)?.intValue,
          let height = (bounds["Height"] as? NSNumber)?.intValue,
          width >= 500, height >= 450
    else { continue }
    print("\(width) \(height)")
    exit(0)
}
exit(1)
"""


@dataclass(frozen=True)
class DiskImage:
    path: Path
    sha256: str
    app_name: str
    identifier: str
    version: str
    entry_point: Path
    entry_sha256: str


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(*args, timeout=30, check=True, env=None):
    result = subprocess.run(args, check=False, timeout=timeout, capture_output=True, text=True, encoding="utf-8", env=env)
    if check and result.returncode:
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {result.stderr[-2048:]}")
    return result


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def image_from_receipt(directory, *, repository, commit, run_id, pin=None):
    receipt = json.loads((directory / "desktop-artifact.json").read_text(encoding="utf-8"))
    require(
        receipt["schema"] == "ellmos-system-gui.desktop-artifact.v1"
        and receipt["source"] == {"repository": repository, "commit": commit}
        and receipt["build"]["os"] == "macOS"
        and receipt["build"]["run_id"] == int(run_id),
        "DMG artifact source does not match",
    )
    relative = receipt["bundles"]["dmg"]["file"]
    bundle = directory / relative
    require(bundle.parent == directory / "bundles" and bundle.suffix == ".dmg"
            and bundle.is_file() and not bundle.is_symlink()
            and bundle.resolve().is_relative_to(directory.resolve()), "Invalid DMG path")
    sha256 = digest(bundle)
    metadata = receipt["files"][relative]
    require(sha256 == metadata["sha256"] and bundle.stat().st_size == metadata["bytes"], "DMG changed")
    require(pin is None or sha256 == pin, "Legacy DMG does not match the supplied hash")
    app = receipt["bundles"]["app"]
    app_name = Path(app["file"]).name.removesuffix(".tar.gz")
    require(app_name.endswith(".app") and app_name != ".app", "Invalid application bundle name")
    entry = Path(app["entry_point"])
    require(entry.parts == ("Contents", "MacOS", "ellmos-system-gui-desktop"), "Unexpected bundle entry point")
    return DiskImage(bundle, sha256, app_name, app["identifier"], app["version"], entry, app["entry_point_sha256"])


def verify_bundle(path, disk):
    require(path.is_dir() and not path.is_symlink(), "Application bundle missing")
    with (path / "Contents/Info.plist").open("rb") as stream:
        plist = plistlib.load(stream)
    require(plist["CFBundleIdentifier"] == disk.identifier and plist["CFBundleShortVersionString"] == disk.version,
            "Application identity does not match the build receipt")
    require(plist["CFBundleExecutable"] == disk.entry_point.name, "Unexpected bundle executable")
    binary = path / disk.entry_point
    require(binary.is_file() and not binary.is_symlink() and binary.resolve().is_relative_to(path)
            and os.access(binary, os.X_OK) and digest(binary) == disk.entry_sha256, "App executable differs from the build")


def install(disk, applications, scratch):
    target = applications / disk.app_name
    require(not target.exists() and not target.is_symlink(), "App target is occupied")
    with tempfile.TemporaryDirectory(prefix="mount-", dir=scratch) as mount:
        run("hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", mount, str(disk.path), timeout=60)
        try:
            source = Path(mount).resolve() / disk.app_name
            verify_bundle(source, disk)
            run("ditto", str(source), str(target))
        finally:
            run("hdiutil", "detach", mount)
    verify_bundle(target, disk)
    return target


def remove(app, applications):
    require(app.parent == applications and app.suffix == ".app" and not app.is_symlink(), "Invalid app removal target")
    shutil.rmtree(app)
    require(not app.exists() and not app.is_symlink(), "App removal left its installation path")


def start(app, disk, home, probe):
    env = {**os.environ, "HOME": str(home), "CFFIXED_USER_HOME": str(home)}
    with tempfile.TemporaryFile() as output:
        process = subprocess.Popen([str(app / disk.entry_point)], env=env, stdout=output, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 20
            while process.poll() is None and time.monotonic() < deadline:
                result = run(str(probe), str(process.pid), str(app.resolve()), check=False, timeout=5)
                if result.returncode == 0 and process.poll() is None:
                    width, height = map(int, result.stdout.split())
                    return {"native_window_on_screen": True, "width": width, "height": height}
                time.sleep(.25)
            output.seek(0)
            raise RuntimeError(f"No on-screen window for the installed app. Output: {output.read(2048)!r}")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(5)


def migrate(current, previous, applications, scratch, home, probe):
    preserved = {}
    for directory in ("Application Support", "Preferences"):
        marker = home / "Library" / directory / current.identifier / "ci-preserve.txt"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(f"CI sample {directory}\n", encoding="utf-8")
        preserved[marker] = digest(marker)
    old_app = install(previous, applications, scratch)
    before = start(old_app, previous, home, probe)
    new_app = install(current, applications, scratch)
    after = start(new_app, current, home, probe)
    remove(old_app, applications)
    remove(new_app, applications)
    restored = install(previous, applications, scratch)
    rollback = start(restored, previous, home, probe)
    remove(restored, applications)
    require(all(digest(marker) == sha for marker, sha in preserved.items()), "User files changed")
    return {"legacy_start": before, "migration_start": after, "rollback_start": rollback,
            "synthetic_user_files_preserved": True}


def signed_update_archive(directory, scratch, version):
    receipt = json.loads((directory / "desktop-artifact.json").read_text(encoding="utf-8"))
    relative = receipt["bundles"]["app"]["file"]
    archive = directory / relative
    require(archive.parent == directory / "bundles" and archive.name.endswith(".app.tar.gz")
            and archive.is_file() and not archive.is_symlink()
            and archive.resolve().is_relative_to(directory.resolve())
            and digest(archive) == receipt["files"][relative]["sha256"], "Unverified macOS update archive")
    fixture = scratch / "update.app.tar.gz"
    shutil.copyfile(archive, fixture)
    cli = Path(".github/desktop-toolchain/node_modules/@tauri-apps/cli/tauri.js").resolve()
    key = scratch / "update-key"
    run("node", str(cli), "signer", "generate", "--ci", "--password=", "--write-keys", str(key))
    try:
        run("node", str(cli), "signer", "sign", "--password=", "--private-key-path", str(key),
            "--app-version", version, str(fixture))
    finally:
        key.unlink()
    return fixture.read_bytes(), Path(str(fixture) + ".sig").read_text(encoding="utf-8").strip()


def fixture_tls(scratch):
    ca, ca_key = scratch / "update-ca.pem", scratch / "update-ca.key"
    cert, cert_key = scratch / "update-server.pem", scratch / "update-server.key"
    csr = scratch / "update-server.csr"
    ca_config = scratch / "update-ca.cnf"
    ca_config.write_text(
        "[req]\ndistinguished_name=dn\nx509_extensions=ca\n"
        "[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n",
        encoding="ascii",
    )
    extensions = scratch / "update-server.cnf"
    extensions.write_text(
        "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n",
        encoding="ascii",
    )
    run("openssl", "req", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", "1",
        "-config", str(ca_config), "-subj", "/CN=Ocean CI Update CA", "-keyout", str(ca_key), "-out", str(ca))
    run("openssl", "req", "-new", "-nodes", "-newkey", "rsa:2048",
        "-subj", "/CN=Ocean CI Update", "-keyout", str(cert_key), "-out", str(csr))
    run("openssl", "x509", "-req", "-days", "1", "-in", str(csr), "-CA", str(ca),
        "-CAkey", str(ca_key), "-set_serial", "1", "-extfile", str(extensions), "-out", str(cert))
    ca_key.unlink()
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, cert_key)
    return tls


def verify_signed_update(directory, current, previous, applications, scratch, home, probe):
    old_app = install(previous, applications, scratch)
    old_window = start(old_app, previous, home, probe)
    marker = home / "Library/Application Support" / current.identifier / "signed-update-ci.txt"
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("CI update sample\n", encoding="utf-8")
    marker_sha = digest(marker)
    package, signature = signed_update_archive(directory, scratch, current.version)
    routes = {
        "/valid/app.tar.gz": ("application/octet-stream", package),
        "/tampered/app.tar.gz": ("application/octet-stream", bytes([package[0] ^ 1]) + package[1:]),
    }

    class UpdateHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            payload = routes.get(self.path)
            if payload is None:
                self.send_error(404)
                return
            content_type, body = payload
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *_args):
            pass

    tls = fixture_tls(scratch)
    with ThreadingHTTPServer(("127.0.0.1", 0), UpdateHandler) as server:
        origin = f"https://127.0.0.1:{server.server_port}"
        for variant, version, artifact in (
            ("valid", current.version, "valid"),
            ("tampered", current.version, "tampered"),
            ("wrong-version", "2.0.0", "valid"),
        ):
            manifest = {"version": version, "url": f"{origin}/{artifact}/app.tar.gz", "signature": signature}
            routes[f"/{variant}/latest.json"] = ("application/json", json.dumps(manifest).encode())
        (scratch / "update-origin").write_text(origin, encoding="ascii")
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            tests = run(
                "cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--release", "--locked",
                "desktop_updates::tests::signed_macos_update_installs_verified_bundle",
                "--", "--ignored", "--exact", timeout=900, check=False,
                env={**os.environ, "OCEAN_SIGNED_UPDATE_FIXTURE": str(scratch)},
            )
            require(tests.returncode == 0, tests.stdout[-3000:] + tests.stderr[-3000:])
            print(tests.stdout, flush=True)
        finally:
            server.shutdown()
            thread.join()
    verify_bundle(old_app, current)
    updated_window = start(old_app, current, home, probe)
    remove(old_app, applications)
    require(digest(marker) == marker_sha, "User file changed during signed update")
    return {"previous_start": old_window, "updated_start": updated_window,
            "archive_sha256": hashlib.sha256(package).hexdigest(), "tampered_payload_rejected": True,
            "incorrect_version_rejected": True, "synthetic_user_file_preserved": True}


def main():
    require(os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and os.environ.get("RUNNER_OS") == "macOS", "Use a disposable hosted macOS runner")
    directory = Path("desktop-package").resolve()
    temp = Path(os.environ["RUNNER_TEMP"])
    repository = os.environ["GITHUB_REPOSITORY"]
    commit = os.environ["DESKTOP_SOURCE_COMMIT"]
    run_id = os.environ["GITHUB_RUN_ID"]
    current = image_from_receipt(directory, repository=repository, commit=commit, run_id=run_id)
    config = json.loads(Path("src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    require(current.version == config["version"] and current.identifier == config["identifier"], "DMG source mismatch")
    migration = signed_update = None
    with tempfile.TemporaryDirectory(prefix="ocean-dmg-", dir=temp) as work:
        scratch = Path(work).resolve()
        applications, home = scratch / "Applications", scratch / "home"
        applications.mkdir()
        home.mkdir()
        swift_source = scratch / "window.swift"
        swift_source.write_text(WINDOW_PROBE, encoding="utf-8")
        probe = scratch / "window-probe"
        run("xcrun", "swiftc", str(swift_source), "-o", str(probe), timeout=90)
        app = install(current, applications, scratch)
        window = start(app, current, home, probe)
        remove(app, applications)
        pin = os.environ.get("LEGACY_DMG_SHA256")
        if pin:
            previous_commit = os.environ["LEGACY_COMMIT"]
            previous_run = os.environ["LEGACY_RUN"]
            require(re.fullmatch(r"[a-f0-9]{64}", pin) and re.fullmatch(r"[a-f0-9]{40}", previous_commit),
                    "Invalid legacy DMG pin")
            previous = image_from_receipt(temp / "legacy-desktop", repository=repository,
                                          commit=previous_commit, run_id=previous_run, pin=pin)
            require(previous.identifier == current.identifier and previous.app_name != current.app_name
                    and previous.version == "0.2.38", "Unexpected BACH Ocean migration source")
            migration = {"legacy_run_id": int(previous_run), "legacy_commit": previous_commit,
                         "legacy_dmg_sha256": previous.sha256, "legacy_version": previous.version,
                         **migrate(current, previous, applications, scratch, home, probe)}
            signed_update = verify_signed_update(directory, current, previous, applications, scratch, home, probe)
        require(not any(applications.iterdir()), "Test Applications directory is not empty")
    receipt = {
        "schema": "ellmos-system-gui.macos-installer-check.v1",
        "source_commit": commit, "run_id": int(run_id), "run_attempt": int(os.environ["GITHUB_RUN_ATTEMPT"]),
        "app_identifier": current.identifier, "version": current.version, "dmg_sha256": current.sha256,
        "installed_binary_sha256": current.entry_sha256, "clean_install_start": window,
        "removed": True, "legacy_migration": migration, "signed_update": signed_update,
    }
    (directory / "macos-installer-check.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
