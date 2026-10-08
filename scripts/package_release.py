"""Verify a clean, pinned static build and make a deterministic ZIP artifact."""
from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
import subprocess
import zipfile


def require_clean_source(root: Path, runner=subprocess.run) -> str:
    options = dict(cwd=root, text=True, check=True, stdin=subprocess.DEVNULL,
                   capture_output=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    status = runner(['git', 'status', '--porcelain=v1', '--untracked-files=all'], **options).stdout
    if status.strip():
        raise SystemExit('Release requires a clean source checkout, including untracked files; review and commit first')
    head = runner(['git', 'rev-parse', '--verify', 'HEAD'], **options).stdout.strip()
    if len(head) != 40 or any(char not in '0123456789abcdef' for char in head):
        raise SystemExit('Invalid release source commit')
    return head


def package_release(root: Path) -> Path:
    head = require_clean_source(root)
    dist = root / 'dist'
    manifest = json.loads((dist / 'dist-manifest.json').read_text(encoding='utf-8'))
    if manifest.get('schema') != 'ellmos-system-gui.dist.v1':
        raise SystemExit('Unexpected manifest schema')
    files = manifest.get('files')
    if not isinstance(files, dict) or not files:
        raise SystemExit('Empty artifact manifest')
    revision = manifest.get('source_commit')
    if revision != head:
        raise SystemExit('Build source commit does not match repository HEAD; rebuild first')
    prepared = json.loads((root / 'release' / '.build-source.json').read_text(encoding='utf-8'))
    if prepared.get('schema') != 'ellmos-system-gui.build-source.v1' or prepared.get('source_commit') != revision:
        raise SystemExit('Build source preparation receipt differs; rebuild first')
    actual = {path.relative_to(dist).as_posix() for path in dist.rglob('*') if path.is_file()}
    expected = set(files) | {'dist-manifest.json'}
    if actual != expected:
        raise SystemExit('Build file set differs from manifest')
    entries = {}
    for name in sorted(expected):
        path = (dist / name).resolve()
        if not path.is_relative_to(dist.resolve()):
            raise SystemExit('Build path escapes dist')
        content = path.read_bytes()
        if name in files and sha256(content).hexdigest() != files[name]:
            raise SystemExit('Build hash mismatch')
        entries['dist/' + name] = content
    entries['LICENSE'] = (root / 'LICENSE').read_bytes()
    package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    if require_clean_source(root) != head:
        raise SystemExit('Source changed while reading release inputs')
    release = root / 'release'
    release.mkdir(exist_ok=True)
    archive = release / f"{package['name']}-{package['version']}-{revision[:12]}.zip"
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for name, content in sorted(entries.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            output.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return archive


if __name__ == '__main__':
    artifact = package_release(Path(__file__).resolve().parent.parent)
    print('archive', artifact)
    print('sha256', sha256(artifact.read_bytes()).hexdigest())
    with zipfile.ZipFile(artifact) as archive:
        print('files', len(archive.namelist()))
