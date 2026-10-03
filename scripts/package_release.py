"""Verify the static build and make a deterministic versioned ZIP artifact."""
from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
import subprocess
import zipfile

root = Path(__file__).resolve().parent.parent
dist = root / 'dist'
manifest = json.loads((dist / 'dist-manifest.json').read_text(encoding='utf-8'))
if manifest.get('schema') != 'ellmos-system-gui.dist.v1':
    raise SystemExit('Unexpected manifest schema')
files = manifest.get('files')
if not isinstance(files, dict) or not files:
    raise SystemExit('Empty artifact manifest')
actual = {path.relative_to(dist).as_posix() for path in dist.rglob('*') if path.is_file()}
expected = set(files) | {'dist-manifest.json'}
if actual != expected:
    raise SystemExit('Build file set differs from manifest')
for name, digest in files.items():
    path = (dist / name).resolve()
    if not path.is_relative_to(dist.resolve()) or sha256(path.read_bytes()).hexdigest() != digest:
        raise SystemExit('Build hash mismatch')

package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
release = root / 'release'
release.mkdir(exist_ok=True)
revision = manifest['source_commit']
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
if revision != head:
    raise SystemExit('Build source commit does not match repository HEAD; rebuild first')
archive = release / f"{package['name']}-{package['version']}-{revision[:12]}.zip"
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
    for name in sorted(expected):
        info = zipfile.ZipInfo('dist/' + name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        output.writestr(info, (dist / name).read_bytes(), compress_type=zipfile.ZIP_DEFLATED,
                        compresslevel=9)
    license_text = (root / 'LICENSE').read_bytes()
    info = zipfile.ZipInfo('LICENSE', date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    output.writestr(info, license_text, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
print('archive', archive)
print('sha256', sha256(archive.read_bytes()).hexdigest())
print('files', len(expected))
