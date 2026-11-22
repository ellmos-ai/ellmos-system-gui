"""Check the exact Debian artifact on a disposable GitHub-hosted runner."""

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from contextlib import suppress
from pathlib import Path

from desktop_update_fixture import (
    digest,
    receipt_bundle,
    require,
    run,
    run_signed_update,
)

APP = Path("/usr/bin/ellmos-system-gui-desktop")
PRODUCT = "open-ocean"
LEGACY = "bach-ocean"
WINDOWS = {PRODUCT: "Ocean (BACH) verbinden", LEGACY: "BACH · Ocean verbinden"}
LAUNCHERS = {
    PRODUCT: Path("/usr/share/applications/OpenOcean.desktop"),
    LEGACY: Path("/usr/share/applications/BACH Ocean.desktop"),
}
APP_ID = "ai.ellmos.system-gui.desktop"
RELATION = "bach-ocean (<< 0.2.40)"


def read_artifacts(directory, commit, run_id):
    receipt = json.loads((directory / "desktop-artifact.json").read_text(encoding="utf-8"))
    require(
        receipt["schema"] == "ellmos-system-gui.desktop-artifact.v1"
        and receipt["source"] == {"repository": os.environ["GITHUB_REPOSITORY"], "commit": commit}
        and receipt["build"]["os"] == "Linux"
        and receipt["build"]["run_id"] == int(run_id),
        "Debian artifact source does not match",
    )
    return receipt


def verified_package(directory, *, package, commit, run_id, pin=None):
    receipt = read_artifacts(directory, commit, run_id)
    bundle, actual = receipt_bundle(directory, receipt, "deb", ".deb", pin)
    require(run("dpkg-deb", "-f", str(bundle), "Package").stdout.strip() == package, "Wrong Debian package")
    version = run("dpkg-deb", "-f", str(bundle), "Version").stdout.strip()
    with tempfile.TemporaryDirectory(prefix="ocean-deb-payload-") as temp:
        root = Path(temp).resolve()
        run("dpkg-deb", "-x", str(bundle), str(root))
        binary = root / APP.relative_to("/")
        require(binary.is_file() and not binary.is_symlink() and binary.resolve().is_relative_to(root),
                "Debian package has no regular app binary")
        binary_sha = digest(binary)
    return bundle, version, actual, binary_sha


def installed(package):
    state = run("dpkg-query", "-W", "-f=${db:Status-Status}", package, check=False)
    return state.returncode == 0 and state.stdout == "installed"


def install(bundle, package, version, binary_sha):
    run("sudo", "-n", "apt-get", "-y", "--no-install-recommends", "install", str(bundle), timeout=120)
    require(installed(package), f"{package} is not registered")
    require(run("dpkg-query", "-W", "-f=${Version}", package).stdout == version, "Installed version mismatch")
    require(run("dpkg-query", "-S", str(APP)).stdout.strip() == f"{package}: {APP}", "Wrong binary owner")
    require(APP.is_file() and os.access(APP, os.X_OK) and digest(APP) == binary_sha, "Installed binary mismatch")
    require(LAUNCHERS[package].is_file(), "Desktop launcher missing")


def purge(package):
    run("sudo", "-n", "dpkg", "--purge", package, timeout=60)
    require(not installed(package) and not APP.exists() and not LAUNCHERS[package].exists(), "Package residue")


def start_window(package, home, app=APP):
    env = {
        **os.environ, "HOME": str(home), "GDK_BACKEND": "x11", "LIBGL_ALWAYS_SOFTWARE": "1",
        "WEBKIT_DISABLE_DMABUF_RENDERER": "1",
        **{f"XDG_{name}": str(home / directory) for name, directory in (
            ("DATA_HOME", "data"), ("CONFIG_HOME", "config"), ("CACHE_HOME", "cache"),
        )},
    }
    appimage = app.suffix == ".AppImage"
    if appimage:
        env["APPIMAGE_EXTRACT_AND_RUN"] = "1"
    with tempfile.TemporaryFile() as output:
        process = subprocess.Popen([str(app)], env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            deadline = time.monotonic() + 20
            while process.poll() is None and time.monotonic() < deadline:
                # The AppImage runtime can put the window in a child process.
                search = ("--name", ".*") if appimage else ("--pid", str(process.pid))
                windows = run("xdotool", "search", "--onlyvisible", *search, check=False)
                for window in windows.stdout.split():
                    name = run("xdotool", "getwindowname", window, check=False).stdout.strip()
                    if name != WINDOWS[package] or process.poll() is not None:
                        continue
                    if not appimage:
                        return {"window_title": name, "visible_on_virtual_display": True}
                    owner = run("xdotool", "getwindowpid", window, check=False).stdout.strip()
                    with suppress(ProcessLookupError):
                        if owner.isdecimal() and os.getpgid(int(owner)) == process.pid:
                            return {"window_title": name, "visible_on_virtual_display": True}
                time.sleep(.25)
            output.seek(0)
            raise RuntimeError(f"Expected native connection window. Output: {output.read(2048)!r}")
        finally:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(5)
            except ProcessLookupError:
                pass
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(5)


def verify_native_pages(home, commit):
    home.mkdir()
    result = subprocess.run(
        ["node", "scripts/check-linux-webview.mjs"], check=True, stdout=subprocess.PIPE,
        encoding="utf-8", timeout=180,
        env={
            **os.environ, "HOME": str(home), "GDK_BACKEND": "x11", "LIBGL_ALWAYS_SOFTWARE": "1",
            "WEBKIT_DISABLE_DMABUF_RENDERER": "1",
            **{f"XDG_{name}": str(home / directory) for name, directory in (
                ("DATA_HOME", "data"), ("CONFIG_HOME", "config"), ("CACHE_HOME", "cache"),
            )},
        },
    )
    proof = json.loads(result.stdout)
    require(proof["source_commit"] == commit and proof["renderer"] == "WebKitGTK"
            and proof["native_windows_observed"] and proof["exited_after_window_close"]
            and proof["web_build_page_count"] == proof["page_contract_count"]
            and [page["route"] for page in proof["routes"]] == ["/", "/tasks", "/agenten/running"],
            "Linux native GUI smoke returned unexpected evidence")
    return proof


def verify_legacy_migration(directory, current, home, pin):
    commit = os.environ["LEGACY_COMMIT"]
    run_id = os.environ["LEGACY_RUN"]
    require(re.fullmatch(r"[a-f0-9]{64}", pin) and re.fullmatch(r"[a-f0-9]{40}", commit), "Invalid legacy pin")
    legacy = verified_package(directory, package=LEGACY, commit=commit, run_id=run_id, pin=pin)
    require(run("dpkg", "--compare-versions", legacy[1], "lt", "0.2.40", check=False).returncode == 0,
            "Legacy version is outside the declared replacement range")
    sentinels = {}
    for area in ("config", "data"):
        sentinel = home / area / APP_ID / "ci-preserve.txt"
        sentinel.parent.mkdir(parents=True, exist_ok=True)
        sentinel.write_text(f"CI sample {area}\n", encoding="utf-8")
        sentinels[sentinel] = digest(sentinel)
    install(legacy[0], LEGACY, legacy[1], legacy[3])
    legacy_window = start_window(LEGACY, home)
    install(current[0], PRODUCT, current[1], current[3])
    require(not installed(LEGACY) and not LAUNCHERS[LEGACY].exists(), "Legacy package still installed")
    migrated_window = start_window(PRODUCT, home)
    purge(PRODUCT)
    install(legacy[0], LEGACY, legacy[1], legacy[3])
    rollback_window = start_window(LEGACY, home)
    purge(LEGACY)
    require(all(digest(path) == sha for path, sha in sentinels.items()), "User data changed during migration or rollback")
    return {
        "legacy_commit": commit, "legacy_run_id": int(run_id), "legacy_deb_sha256": legacy[2],
        "legacy_version": legacy[1], "legacy_start": legacy_window,
        "migration_start": migrated_window, "rollback_start": rollback_window,
        "synthetic_user_files_preserved": True,
    }


def verify_signed_appimage(directory, legacy_directory, temp, commit, run_id, version, pin):
    legacy_commit = os.environ["LEGACY_COMMIT"]
    legacy_run = os.environ["LEGACY_RUN"]
    require(re.fullmatch(r"[a-f0-9]{64}", pin) and re.fullmatch(r"[a-f0-9]{40}", legacy_commit),
            "Invalid legacy AppImage pin")
    legacy_artifacts = read_artifacts(legacy_directory, legacy_commit, legacy_run)
    previous, previous_sha = receipt_bundle(legacy_directory, legacy_artifacts, "appimage", ".AppImage", pin)
    require(previous.name == "BACH Ocean_0.2.38_amd64.AppImage", "Unexpected legacy AppImage")
    artifacts = read_artifacts(directory, commit, run_id)
    source, current_sha = receipt_bundle(directory, artifacts, "appimage", ".AppImage")
    require(source.name.endswith(f"_{version}_amd64.AppImage"), "Unexpected update AppImage")

    with tempfile.TemporaryDirectory(prefix="ocean-signed-appimage-", dir=temp) as work:
        scratch = Path(work).resolve()
        home = scratch / "home"
        marker = home / "data" / APP_ID / "signed-update-ci.txt"
        marker.parent.mkdir(parents=True)
        marker.write_text("CI update sample\n", encoding="utf-8")
        marker_sha = digest(marker)

        app = scratch / "Ocean.AppImage"
        shutil.copyfile(previous, app)
        permissions = 0o755
        app.chmod(permissions)
        before = start_window(LEGACY, home, app)
        proof = run_signed_update(source, scratch, version)
        require(digest(app) == current_sha and proof["package_sha256"] == current_sha
                and (app.stat().st_mode & 0o777) == permissions, "Updated AppImage does not match the package")
        after = start_window(PRODUCT, home, app)
        require(digest(marker) == marker_sha, "User file changed during signed AppImage update")
        app.unlink()
    return {
        "legacy_commit": legacy_commit, "legacy_run_id": int(legacy_run),
        "legacy_appimage_sha256": previous_sha, "legacy_version": "0.2.38",
        "previous_start": before, "updated_start": after,
        **proof, "synthetic_user_file_preserved": True,
    }


def main():
    require(
        os.environ.get("GITHUB_ACTIONS") == "true"
        and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
        and os.environ.get("RUNNER_OS") == "Linux",
        "Native lifecycle checks require a disposable hosted Linux runner",
    )
    directory = Path("desktop-package").resolve()
    temp = Path(os.environ["RUNNER_TEMP"])
    commit = os.environ["DESKTOP_SOURCE_COMMIT"]
    run_id = os.environ["GITHUB_RUN_ID"]
    package = verified_package(directory, package=PRODUCT, commit=commit, run_id=run_id)
    version = json.loads(Path("src-tauri/tauri.conf.json").read_text(encoding="utf-8"))["version"]
    require(package[1] == version, "Debian version does not match the source")
    for field in ("Conflicts", "Replaces"):
        require(run("dpkg-deb", "-f", str(package[0]), field).stdout.strip() == RELATION,
                f"Wrong {field} in the emitted Debian package")
    require(not any(installed(p) for p in (LEGACY, PRODUCT)) and not APP.exists(), "Runner already has Ocean")
    with tempfile.TemporaryDirectory(prefix="ocean-deb-", dir=temp) as home:
        home = Path(home)
        install(package[0], PRODUCT, version, package[3])
        window = start_window(PRODUCT, home)
        try:
            native_pages = verify_native_pages(home / "webview", commit)
            bach_pages = None
            if archive := os.environ.get("BACH_SMOKE_ARCHIVE"):
                output = directory / "bach-native-smoke"
                run(
                    sys.executable, "scripts/check-bach-backend.py", ".ci-bach", archive,
                    str(output), "--native", timeout=240,
                )
                bach_pages = json.loads((output / "result.json").read_text(encoding="utf-8"))
        finally:
            purge(PRODUCT)
        pin = os.environ.get("LEGACY_DEB_SHA256")
        migration = verify_legacy_migration(temp / "legacy-desktop", package, home, pin) if pin else None
    appimage_pin = os.environ.get("LEGACY_APPIMAGE_SHA256")
    signed = verify_signed_appimage(
        directory, temp / "legacy-desktop", temp, commit, run_id, version, appimage_pin,
    ) if appimage_pin else None
    receipt = {
        "schema": "ellmos-system-gui.linux-installer-check.v1",
        "source_commit": commit, "run_id": int(run_id), "run_attempt": int(os.environ["GITHUB_RUN_ATTEMPT"]),
        "package": PRODUCT, "version": version, "deb_sha256": package[2], "installed_binary_sha256": package[3],
        "clean_install_start": window, "purged": True, "legacy_migration": migration,
        "signed_appimage_update": signed, "native_pages": native_pages, "bach_native_pages": bach_pages,
    }
    (directory / "linux-installer-check.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
