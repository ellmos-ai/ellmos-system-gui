import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsRoot = path.join(projectRoot, 'src', 'assets');
const outputRoot = path.join(assetsRoot, 'agent-avatar-thumbnails-v1');
const catalogPath = path.join(projectRoot, 'src', 'lib', 'agent-avatar-catalog.mjs');
const { AVATAR_PRESETS, ATLAS_PRESETS } = await import('../src/lib/agent-avatar.mjs');

const sources = [
  {
    directory: 'agent-portraits-20261010',
    kind: 'portable',
    manifestPath: path.join(assetsRoot, 'agent-portraits-20261010', 'provenance.json'),
  },
  {
    directory: 'gemini-agent-portraits',
    kind: 'preset-id',
    manifestPath: path.join(assetsRoot, 'gemini-agent-portraits', 'provenance.json'),
  },
];

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const entries = [];

for (const source of sources) {
  const manifest = JSON.parse(await readFile(source.manifestPath, 'utf8'));
  for (const item of manifest.files) {
    if (!/^preset:[a-z0-9-]+$/.test(item.id) || !/^[a-z0-9-]+\.(png|jpg|jpeg)$/.test(item.file)) {
      throw new Error(`Unsafe avatar catalog entry: ${item.id}`);
    }
    const inputRelative = path.posix.join(source.directory, item.file);
    const inputPath = path.join(assetsRoot, source.directory, item.file);
    const input = await readFile(inputPath);
    const legacySha256 = source.kind === 'portable' ? item.sha256 : null;
    if (legacySha256 && digest(input) !== legacySha256) {
      throw new Error(`Source hash mismatch for ${item.id}`);
    }

    const slug = item.id.slice('preset:'.length);
    const thumbnailName = `${slug}.webp`;
    const largeName = `${slug}-large.webp`;
    const dataName = `${slug}-data.png`;
    const thumbnailPath = path.join(outputRoot, thumbnailName);
    const largePath = path.join(outputRoot, largeName);
    const dataPath = source.kind === 'portable' ? path.join(outputRoot, dataName) : null;

    const metadata = await sharp(input).metadata();
    const thumbnail = await sharp(input).rotate().resize(96, 96, { fit: 'cover' }).webp({ quality: 78, effort: 4 }).toBuffer();
    const large = await sharp(input).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 84, effort: 4 }).toBuffer();
    const data = source.kind === 'portable'
      ? await sharp(input).rotate().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
      : null;

    for (const [label, bytes] of [['thumbnail', thumbnail], ['large', large], ...(data ? [['portableData', data]] : [])]) {
      const info = await sharp(bytes).metadata();
      if (info.exif || info.iptc || info.xmp || info.icc) throw new Error(`Metadata retained in ${label} for ${item.id}`);
      if (label === 'thumbnail' && (info.width !== 96 || info.height !== 96)) throw new Error(`Unexpected thumbnail dimensions for ${item.id}`);
    }

    await mkdir(outputRoot, { recursive: true });
    await writeFile(thumbnailPath, thumbnail);
    await writeFile(largePath, large);
    if (data && dataPath) {
      if (data.length > 180000) throw new Error(`Portable image exceeds stored data-URI bound for ${item.id}`);
      await writeFile(dataPath, data);
    }

    entries.push({
      id: item.id,
      name: item.name,
      kind: source.kind,
      source: inputRelative,
      sourceSha256: digest(input),
      legacyDataSha256: legacySha256,
      thumbnail: thumbnailName,
      thumbnailSha256: digest(thumbnail),
      thumbnailBytes: thumbnail.length,
      thumbnailDimensions: [96, 96],
      large: largeName,
      largeSha256: digest(large),
      largeBytes: large.length,
      largeDimensions: [Math.min(512, metadata.width), Math.min(512, metadata.height)],
      data: dataName,
      dataSha256: data ? digest(data) : null,
      dataBytes: data?.length ?? null,
    });
  }
}

const expectedIds = new Set(AVATAR_PRESETS.filter((preset) => !ATLAS_PRESETS.some((atlas) => atlas.id === preset.id)).map((preset) => preset.id));
if (entries.length !== 64 || new Set(entries.map((entry) => entry.id)).size !== 64 ||
    entries.some((entry) => !expectedIds.has(entry.id)) || expectedIds.size !== 64) {
  throw new Error(`Expected exactly the 64 non-atlas presets, got ${entries.length}`);
}

const imports = [];
const records = [];
entries.sort((a, b) => a.id.localeCompare(b.id));
entries.forEach((entry, index) => {
  const sourceRoot = entry.kind === 'portable' ? 'agent-portraits-20261010' : 'gemini-agent-portraits';
  const originalName = entry.source.slice(sourceRoot.length + 1);
  imports.push(`import thumbnail${index} from '../assets/agent-avatar-thumbnails-v1/${entry.thumbnail}?url&no-inline';`);
  imports.push(`import large${index} from '../assets/agent-avatar-thumbnails-v1/${entry.large}?url&no-inline';`);
  const dataLoader = entry.kind === 'portable'
    ? `() => import('../assets/agent-avatar-thumbnails-v1/${entry.data}?inline').then(({default: data}) => data)`
    : 'null';
  records.push(`  ${JSON.stringify(entry.id)}: Object.freeze({ kind: ${JSON.stringify(entry.kind)}, thumbnail: thumbnail${index}, large: large${index}, dataLoader: ${dataLoader}, sha256: ${JSON.stringify(entry.dataSha256)}, legacySha256: ${JSON.stringify(entry.legacyDataSha256)} }),`);
});

const catalogSource = [
  '// Generated by scripts/generate-agent-avatar-thumbnails.mjs; do not edit by hand.',
  "export const AVATAR_CATALOG_VERSION = 'v1';",
  ...imports,
  'export const AVATAR_ASSET_CATALOG = Object.freeze({',
  ...records,
  '});',
  '',
].join('\n');

const provenance = {
  schema: 'ellmos.agent-avatar-thumbnails.v1',
  catalogVersion: 'v1',
  generatedWith: `sharp ${sharp.versions.sharp}`,
  sourceManifests: sources.map((source) => path.posix.join(source.directory, 'provenance.json')),
  thumbnail: { format: 'webp', width: 96, height: 96, quality: 78 },
  large: { format: 'webp', maxWidth: 512, maxHeight: 512, quality: 84 },
  portableData: { format: 'png', maxBytes: 180000, metadata: 'stripped' },
  entries,
};

await writeFile(path.join(outputRoot, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
await writeFile(catalogPath, catalogSource);
console.log(JSON.stringify({
  count: entries.length,
  thumbnailBytes: entries.reduce((total, entry) => total + entry.thumbnailBytes, 0),
  largeBytes: entries.reduce((total, entry) => total + entry.largeBytes, 0),
  portableDataBytes: entries.reduce((total, entry) => total + (entry.dataBytes ?? 0), 0),
  outputRoot,
  catalogPath,
  sharp: sharp.versions.sharp,
}, null, 2));
