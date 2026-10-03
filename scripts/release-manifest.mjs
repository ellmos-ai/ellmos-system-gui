import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = {};

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(path);
    } else if (entry.isFile() && entry.name !== 'dist-manifest.json') {
      const bytes = await readFile(path);
      manifest[relative(dist, path).replaceAll('\\', '/')] = createHash('sha256').update(bytes).digest('hex');
    }
  }
}

await collect(dist);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const record = {
  schema: 'ellmos-system-gui.dist.v1',
  source_commit: sourceCommit,
  files: Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))),
};
await writeFile(new URL('../dist/dist-manifest.json', import.meta.url), JSON.stringify(record, null, 2) + '\n');
console.log(`${Object.keys(record.files).length} files hashed`);
