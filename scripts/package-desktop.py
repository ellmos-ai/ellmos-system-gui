"""Collect native CI bundles and their source receipt without starting the app."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tarfile


ROOT = Path(__file__).resolve().parents[1]
CLI_ROOT = ROOT / '.github/desktop-toolchain'
RELEASE = ROOT / 'src-tauri/target/release'
PACKAGE = ROOT / 'desktop-package'


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def command(*argv):
    return subprocess.run(
        argv, cwd=ROOT, check=True, capture_output=True, text=True, encoding='utf-8',
        timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    ).stdout.strip()


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def single(pattern):
    matches = list((RELEASE / 'bundle').glob(pattern))
    require(len(matches) == 1, f'Expected one native bundle for {pattern}')
    return matches[0]


def main():
    commit = os.environ['DESKTOP_SOURCE_COMMIT']
    require(re.fullmatch(r'[0-9a-f]{40}', commit), 'Expected an exact source commit')
    require(command('git', 'rev-parse', 'HEAD') == commit, 'Checkout does not match source receipt')
    command('git', 'diff', '--exit-code', '--', 'src-tauri/Cargo.lock', '.github/desktop-toolchain/package-lock.json')
    expected_cli = json.loads((CLI_ROOT / 'package.json').read_text(encoding='utf-8'))['dependencies']['@tauri-apps/cli']
    installed_cli = json.loads((CLI_ROOT / 'node_modules/@tauri-apps/cli/package.json').read_text(encoding='utf-8'))['version']
    cli_version = command('node', str(CLI_ROOT / 'node_modules/@tauri-apps/cli/tauri.js'), '--version')
    require(installed_cli == expected_cli and cli_version.split()[-1] == expected_cli, 'Tauri CLI version mismatch')
    platform = os.environ['RUNNER_OS']
    formats = {
        'Windows': {'nsis'},
        'macOS': {'app', 'dmg'},
        'Linux': {'deb', 'appimage'},
    }[platform]
    require(set(os.environ['DESKTOP_BUNDLES'].split(',')) == formats, 'Unexpected requested bundle formats')
    require(not PACKAGE.exists(), 'Artifact directory must be fresh')
    PACKAGE.mkdir()
    (PACKAGE / 'bundles').mkdir()
    binary_name = 'ellmos-system-gui-desktop' + ('.exe' if platform == 'Windows' else '')
    binary = RELEASE / binary_name
    require(binary.is_file() and binary.stat().st_size > 0, 'Compiled desktop binary is missing')
    shutil.copy2(binary, PACKAGE / binary_name)
    shutil.copy2(ROOT / 'LICENSE', PACKAGE / 'LICENSE')
    bundles = {}
    patterns = {
        'nsis': 'nsis/*-setup.exe',
        'dmg': 'dmg/*.dmg',
        'deb': 'deb/*.deb',
        'appimage': 'appimage/*.AppImage',
    }
    for kind in sorted(formats - {'app'}):
        source = single(patterns[kind])
        require(source.is_file() and not source.is_symlink() and source.stat().st_size > 0, 'Invalid native bundle')
        destination = PACKAGE / 'bundles' / source.name
        shutil.copy2(source, destination)
        require(digest(source) == digest(destination), 'Native bundle copy changed')
        bundles[kind] = {'file': destination.relative_to(PACKAGE).as_posix()}
    config = json.loads((ROOT / 'src-tauri/tauri.conf.json').read_text(encoding='utf-8'))
    if 'app' in formats:
        app = single('macos/*.app')
        require(app.is_dir() and not app.is_symlink(), 'Missing macOS application bundle')
        for item in app.rglob('*'):
            if item.is_symlink():
                require(item.resolve().is_relative_to(app.resolve()), 'App contains an external symlink')
        with (app / 'Contents/Info.plist').open('rb') as stream:
            info = plistlib.load(stream)
        require(info['CFBundleIdentifier'] == config['identifier'], 'App identifier mismatch')
        require(info['CFBundleShortVersionString'] == config['version'], 'App version mismatch')
        app_binary = app / 'Contents/MacOS' / binary_name
        require(app_binary.is_file() and app_binary.stat().st_mode & 0o111, 'App entry point is not executable')
        archive = PACKAGE / 'bundles' / (app.name + '.tar.gz')
        with tarfile.open(archive, 'w:gz', dereference=False) as stream:
            stream.add(app, arcname=app.name)
        bundles['app'] = {
            'file': archive.relative_to(PACKAGE).as_posix(),
            'identifier': info['CFBundleIdentifier'], 'version': info['CFBundleShortVersionString'],
            'entry_point': str(app_binary.relative_to(app).as_posix()),
            'entry_point_sha256': digest(app_binary), 'executable_mode_preserved': True,
        }
    receipt = {
        'schema': 'ellmos-system-gui.desktop-artifact.v1',
        'source': {'repository': os.environ['GITHUB_REPOSITORY'], 'commit': commit},
        'build': {
            'run_id': int(os.environ['GITHUB_RUN_ID']), 'run_attempt': int(os.environ['GITHUB_RUN_ATTEMPT']),
            'os': platform, 'arch': os.environ['RUNNER_ARCH'], 'profile': 'release',
            'rustc_version': command('rustc', '--version'), 'tauri_cli_version': cli_version,
            'cargo_lock_sha256': digest(ROOT / 'src-tauri/Cargo.lock'),
            'desktop_toolchain_lock_sha256': digest(CLI_ROOT / 'package-lock.json'),
            'tauri_config_sha256': digest(ROOT / 'src-tauri/tauri.conf.json'),
        },
        'bundles': bundles,
        'files': {
            p.relative_to(PACKAGE).as_posix(): {'sha256': digest(p), 'bytes': p.stat().st_size}
            for p in sorted(PACKAGE.rglob('*')) if p.is_file()
        },
        'acceptance': {
            'binary_started': False, 'device_verified': False, 'installer': False,
            'installer_started': False, 'installed': False, 'publisher_signed': False,
            'notarized': False, 'store_submitted': False,
        },
    }
    (PACKAGE / 'desktop-artifact.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'source_commit': commit, 'platform': platform, 'bundles': bundles, 'files': receipt['files']}))


if __name__ == '__main__':
    main()
