import {createHash} from 'node:crypto';
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join, relative, resolve} from 'node:path';
import {requireCleanSource} from './release-source.mjs';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const receiptPath = root => join(root, 'release', '.build-source.json');

export async function prepareReleaseSource({root = defaultRoot, git} = {}) {
  const commit = requireCleanSource(root, git);
  await mkdir(join(root, 'release'), {recursive:true});
  await writeFile(receiptPath(root), JSON.stringify({schema:'ellmos-system-gui.build-source.v1', source_commit:commit}) + '\n');
  return commit;
}

export async function writeReleaseManifest({root = defaultRoot, git} = {}) {
  const sourceCommit = requireCleanSource(root, git);
  let prepared;
  try { prepared = JSON.parse(await readFile(receiptPath(root), 'utf8')); }
  catch { throw new Error('Release build has no source preparation receipt; run npm run build:release.'); }
  if (prepared.schema !== 'ellmos-system-gui.build-source.v1' || prepared.source_commit !== sourceCommit)
    throw new Error('Release source changed since build preparation; rebuild first.');
  const dist = join(root, 'dist'), manifest = {};
  async function collect(directory) {
    for (const entry of await readdir(directory, {withFileTypes:true})) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile() && entry.name !== 'dist-manifest.json')
        manifest[relative(dist,path).replaceAll('\\','/')] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
  }
  await collect(dist);
  if (requireCleanSource(root, git) !== sourceCommit) throw new Error('Release source changed while hashing the build.');
  const record = {schema:'ellmos-system-gui.dist.v1', source_commit:sourceCommit,
    files:Object.fromEntries(Object.entries(manifest).sort(([a],[b])=>a.localeCompare(b)))};
  await writeFile(join(dist,'dist-manifest.json'), JSON.stringify(record,null,2) + '\n');
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--prepare-source')) console.log('Prepared clean release source', await prepareReleaseSource());
    else if (process.argv.includes('--check-source')) console.log('Clean release source', requireCleanSource(defaultRoot));
    else console.log(Object.keys((await writeReleaseManifest()).files).length, 'files hashed');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
