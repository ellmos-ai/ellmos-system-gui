import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

test('release archive bytes are independent of host ZIP creator defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gui-archive-platform-'));
  const env = {...process.env, GIT_CONFIG_GLOBAL: join(root, 'isolated.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1'};
  const run = (program, args) => execFileSync(program, args, {cwd: root, env, windowsHide: true});
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  try {
    await writeFile(join(root, 'isolated.gitconfig'), '');
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'dist'));
    await copyFile(fileURLToPath(new URL('../scripts/package_release.py', import.meta.url)),
      join(root, 'scripts', 'package_release.py'));
    await writeFile(join(root, 'package.json'), JSON.stringify({name: 'fixture', version: '0.0.0'}));
    await writeFile(join(root, 'LICENSE'), 'Synthetic packaging fixture\n');
    await writeFile(join(root, '.gitignore'), 'dist/\nrelease/\nisolated.gitconfig\n');
    run('git', ['init', '-b', 'main', '--template=']);
    run('git', ['config', 'user.name', 'Packaging Fixture']);
    run('git', ['config', 'user.email', 'fixture@example.invalid']);
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'fixture']);
    const head = run('git', ['rev-parse', 'HEAD']).toString().trim();
    const page = Buffer.from('<h1>Übersicht</h1>\n');
    await writeFile(join(root, 'dist', 'index.html'), page);
    await writeFile(join(root, 'dist', 'dist-manifest.json'), JSON.stringify({
      schema: 'ellmos-system-gui.dist.v1', source_commit: head,
      files: {'index.html': hash(page)},
    }));
    await mkdir(join(root, 'release'));
    await writeFile(join(root, 'release', '.build-source.json'), JSON.stringify({
      schema: 'ellmos-system-gui.build-source.v1', source_commit: head,
    }));
    const bootstrap = `import zipfile,sys,runpy
original=zipfile.ZipInfo
class HostZipInfo(original):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.create_system=int(sys.argv[2])
zipfile.ZipInfo=HostZipInfo
runpy.run_path(sys.argv[1],run_name='__main__')`;
    const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const script = join(root, 'scripts', 'package_release.py');
    const archive = join(root, 'release', `fixture-0.0.0-${head.slice(0, 12)}.zip`);
    run(python, ['-I', '-S', '-B', '-c', bootstrap, script, '0']);
    const windowsDefault = await readFile(archive);
    run(python, ['-I', '-S', '-B', '-c', bootstrap, script, '3']);
    assert.equal(hash(windowsDefault), hash(await readFile(archive)),
      'identical source and assets must not yield different archives because of host ZIP metadata');
  } finally {
    assert.equal(dirname(await realpath(root)), await realpath(tmpdir()));
    await rm(root, {recursive: true, force: true});
  }
});
