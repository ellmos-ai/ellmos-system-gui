"""Check the exact Debian artifact on a disposable GitHub-hosted runner."""

import hashlib
import json
import os
import re
import signal
import subprocess
import tempfile
import time
from pathlib import Path

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


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(*args, timeout=30, check=True):
    result = subprocess.run(
        args, check=False, timeout=timeout, text=True, encoding="utf-8", capture_output=True,
    )
    if check and result.returncode:
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {result.stderr[-2048:]}")
    return result


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verified_package(directory, *, package, commit, run_id, pin=None):
    receipt = json.loads((directory / "desktop-artifact.json").read_text(encoding="utf-8"))
    require(
        receipt["schema"] == "ellmos-system-gui.desktop-artifact.v1"
        and receipt["source"] == {"repository": os.environ["GITHUB_REPOSITORY"], "commit": commit}
        and receipt["build"]["os"] == "Linux"
        and receipt["build"]["run_id"] == int(run_id),
        "Debian artifact source does not match",
    )
    relative = receipt["bundles"]["deb"]["file"]
    bundle = directory / relative
    require(
        bundle.parent == directory / "bundles" and bundle.suffix == ".deb"
        and bundle.is_file() and not bundle.is_symlink()
        and bundle.resolve().is_relative_to(directory.resolve()),
        "Invalid Debian artifact path",
    )
    file = receipt["files"][relative]
    actual = digest(bundle)
    require(actual == file["sha256"] and bundle.stat().st_size == file["bytes"], "Debian artifact changed")
    require(pin is None or pin == actual, "Legacy Debian artifact does not match the supplied SHA-256")
    require(run("dpkg-deb", "-f", str(bundle), "Package").stdout.strip() == package, "Wrong Debian package")
    version = run("dpkg-deb", "-f", str(bundle), "Version").stdout.strip()
    return bundle, version, actual, receipt["files"][APP.name]["sha256"]


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


def start_window(package, home):
    env = {
        **os.environ, "HOME": str(home), "GDK_BACKEND": "x11", "LIBGL_ALWAYS_SOFTWARE": "1",
        "WEBKIT_DISABLE_DMABUF_RENDERER": "1",
        **{f"XDG_{name}": str(home / directory) for name, directory in (
            ("DATA_HOME", "data"), ("CONFIG_HOME", "config"), ("CACHE_HOME", "cache"),
        )},
    }
    with tempfile.TemporaryFile() as output:
        process = subprocess.Popen([str(APP)], env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            deadline = time.monotonic() + 20
            while process.poll() is None and time.monotonic() < deadline:
                windows = run("xdotool", "search", "--onlyvisible", "--pid", str(process.pid), check=False)
                for window in windows.stdout.split():
                    name = run("xdotool", "getwindowname", window, check=False).stdout.strip()
                    if name == WINDOWS[package] and process.poll() is None:
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
        purge(PRODUCT)
        pin = os.environ.get("LEGACY_DEB_SHA256")
        migration = verify_legacy_migration(temp / "legacy-desktop", package, home, pin) if pin else None
    receipt = {
        "schema": "ellmos-system-gui.linux-installer-check.v1",
        "source_commit": commit, "run_id": int(run_id), "run_attempt": int(os.environ["GITHUB_RUN_ATTEMPT"]),
        "package": PRODUCT, "version": version, "deb_sha256": package[2], "installed_binary_sha256": package[3],
        "clean_install_start": window, "purged": True, "legacy_migration": migration,
    }
    (directory / "linux-installer-check.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
