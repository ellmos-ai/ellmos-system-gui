// One production build of the site per source state, shared by every browser test file.
// `node --test` runs the files in parallel; two astro builds at the same time in one checkout collide (shared caches),
// which made the browser tests fail at random. The first caller builds, the others wait for the finished folder.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function sourceKey(root) {
  const hash = createHash('sha1');
  const walk = dir => {
    for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else { const stat = statSync(path); hash.update(path + ':' + stat.size + ':' + Math.round(stat.mtimeMs) + '\n'); }
    }
  };
  for (const part of ['src', 'public']) if (existsSync(join(root, part))) walk(join(root, part));
  for (const file of ['astro.config.mjs', 'package.json']) hash.update(file + statSync(join(root, file)).mtimeMs);
  return hash.digest('hex').slice(0, 16);
}

const sleep = ms => new Promise(done => setTimeout(done, ms));

export async function sharedDist(root) {
  const base = join(tmpdir(), 'ellmos-gui-dist-' + sourceKey(root));
  const done = join(base, '.done');
  const lock = base + '.lock';
  for (const old of readdirSync(tmpdir())) {
    if (!old.startsWith('ellmos-gui-dist-') || join(tmpdir(), old).startsWith(base)) continue;
    try { if (Date.now() - statSync(join(tmpdir(), old)).mtimeMs > 3600e3) rmSync(join(tmpdir(), old), {recursive: true, force: true}); } catch { /* another run cleans it */ }
  }
  if (existsSync(done)) return base;
  let mine = false;
  try { mkdirSync(lock); mine = true; } catch { /* somebody else is building */ }
  if (mine) {
    try {
      rmSync(base, {recursive: true, force: true});
      execFileSync(process.execPath, [join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build', '--outDir', base], {cwd: root, stdio: 'pipe'});
      writeFileSync(done, 'ok');
    } finally { rmSync(lock, {recursive: true, force: true}); }
    return base;
  }
  for (let waited = 0; waited < 240000; waited += 500) {
    if (existsSync(done)) return base;
    if (!existsSync(lock)) return sharedDist(root); // the builder failed: take over
    await sleep(500);
  }
  throw new Error('shared dist build did not finish');
}
