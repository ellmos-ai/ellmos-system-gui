import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {requireCleanSource} from '../scripts/release-source.mjs';
import {prepareReleaseSource,writeReleaseManifest} from '../scripts/release-manifest.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)), head='a'.repeat(40);
const git=(status='',commit=head)=>(_command,args)=>args[0]==='status'?status:commit+'\n';
const base=join(root,'release');
function fixture(t) {
  mkdirSync(base,{recursive:true});
  const path=mkdtempSync(join(base,'.fixture-'));
  t.after(()=>{
    assert.equal(dirname(resolve(path)),resolve(base));
    assert.match(basename(path),/^\.fixture-/);
    rmSync(path,{recursive:true,force:true});
  });
  mkdirSync(join(path,'dist'));writeFileSync(join(path,'dist','index.html'),'<p>Synthetic fixture</p>\n');
  mkdirSync(join(path,'dist','assets'));writeFileSync(join(path,'dist','assets','mock.js'),'/* synthetic asset */\n');
  return path;
}

test('release source rejects tracked, staged and untracked changes',()=>{
  for(const status of [' M src/example.astro','M  src/example.astro','?? extra.txt'])
    assert.throws(()=>requireCleanSource(root,git(status)),/clean source/);
  assert.equal(requireCleanSource(root,git()),head);
  assert.throws(()=>requireCleanSource(root,git('','invalid')),/commit is invalid/);
});

test('a clean prepared build retains the existing dist manifest contract',async t=>{
  const path=fixture(t);
  await prepareReleaseSource({root:path,git:git()});
  const record=await writeReleaseManifest({root:path,git:git()});
  assert.equal(record.schema,'ellmos-system-gui.dist.v1');assert.equal(record.source_commit,head);
  assert.ok(record.files['assets/mock.js']);assert.ok(Object.keys(record.files).every(name=>!name.includes('\\')));
  assert.equal(record.files['index.html'],createHash('sha256').update(readFileSync(join(path,'dist','index.html'))).digest('hex'));
  assert.deepEqual(JSON.parse(readFileSync(join(path,'dist','dist-manifest.json'),'utf8')),record);
});

test('missing preparation and changed source commits cannot make release receipts',async t=>{
  const path=fixture(t);
  await assert.rejects(writeReleaseManifest({root:path,git:git()}),/no source preparation/);
  await prepareReleaseSource({root:path,git:git()});
  await assert.rejects(writeReleaseManifest({root:path,git:git('','b'.repeat(40))}),/changed since build preparation/);
  assert.equal(existsSync(join(path,'dist','dist-manifest.json')),false);
});

test('dirty source is rejected before release metadata is written',async t=>{
  const path=fixture(t);
  await assert.rejects(prepareReleaseSource({root:path,git:git('?? synthetic.txt')}),/clean source/);
  await assert.rejects(writeReleaseManifest({root:path,git:git(' M source')}),/clean source/);
  assert.equal(existsSync(join(path,'release','.build-source.json')),false);
  assert.equal(existsSync(join(path,'dist','dist-manifest.json')),false);
});

test('the Python packager rejects dirty/untracked source and preserves deterministic ZIP semantics',async t=>{
  const path=fixture(t);await prepareReleaseSource({root:path,git:git()});await writeReleaseManifest({root:path,git:git()});
  writeFileSync(join(path,'package.json'),JSON.stringify({name:'synthetic-gui',version:'0.0.0'}));
  writeFileSync(join(path,'LICENSE'),'Synthetic license fixture\n');
  const source=`import runpy,sys,json,hashlib,zipfile
from pathlib import Path
from types import SimpleNamespace
n=runpy.run_path(sys.argv[1]);root=Path(sys.argv[2]);head='a'*40
for status in [' M tracked','?? untracked']:
 try:n['require_clean_source'](root,runner=lambda *a,**k:SimpleNamespace(stdout=status))
 except SystemExit as error:assert 'clean source' in str(error)
 else:raise AssertionError('dirty source accepted')
assert n['require_clean_source'](root,runner=lambda args,**k:SimpleNamespace(stdout='' if args[1]=='status' else head))==head
pack=n['package_release'];pack.__globals__['require_clean_source']=lambda root:head
archive=pack(root);first=hashlib.sha256(archive.read_bytes()).hexdigest();archive=pack(root)
assert hashlib.sha256(archive.read_bytes()).hexdigest()==first
with zipfile.ZipFile(archive) as z:
 assert z.read('LICENSE')==b'Synthetic license fixture\\n'
 assert set(z.namelist())=={'LICENSE','dist/index.html','dist/assets/mock.js','dist/dist-manifest.json'}
 assert all(i.date_time==(1980,1,1,0,0,0) for i in z.infolist())
print('verified')`;
  const result=spawnSync('python',['-c',source,join(root,'scripts','package_release.py'),path],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.error?.message);assert.match(result.stdout,/verified/);
});

test('build:release checks and pins source before invoking Astro',()=>{
  const packageJson=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  assert.match(packageJson.scripts['build:release'],/^node scripts\/release-manifest\.mjs --prepare-source && astro build &&/);
  assert.equal(packageJson.scripts.build,'astro build');
});
