import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {
  AVATAR_PRESETS, ATLAS_PRESETS, GEMINI_AVATAR_PRESETS, PORTABLE_AVATAR_PRESETS,
  setAvatarAssetCatalog, avatarVisual, createAvatar, mountAvatarPicker,
} from '../src/lib/agent-avatar.mjs';

globalThis.crypto ??= webcrypto;

const assetRoot = new URL('../src/assets/agent-avatar-thumbnails-v1/', import.meta.url);
const generated = JSON.parse(await readFile(new URL('provenance.json', assetRoot), 'utf8'));
const assetCatalog = Object.fromEntries(generated.entries.map((entry) => [entry.id, {
  kind: entry.kind,
  thumbnail: `/_astro/${entry.thumbnail}`,
  large: `/_astro/${entry.large}`,
  dataLoader: entry.data ? async () => `data:image/png;base64,${(await readFile(new URL(entry.data, assetRoot))).toString('base64')}` : null,
  sha256: entry.dataSha256,
  legacySha256: entry.legacyDataSha256,
}]));
setAvatarAssetCatalog(assetCatalog);

function fakeDocument() {
  const document = {
    createElement(tag) {
      const element = {
        tag, dataset: {}, style: {}, attributes: {}, children: [], listeners: {}, ownerDocument: document,
        setAttribute(name, value) { this.attributes[name] = value; },
        removeAttribute(name) { delete this[name]; },
        append(...items) { this.children.push(...items); },
        replaceChildren(...items) { this.children = items; },
        addEventListener(name, callback) { this.listeners[name] = callback; },
        click() { return this.listeners.click?.(); },
      };
      return element;
    },
  };
  return document;
}

test('the catalog keeps all seventy stable IDs and six Atlas defaults', () => {
  assert.equal(ATLAS_PRESETS.length, 6);
  assert.equal(GEMINI_AVATAR_PRESETS.length, 19);
  assert.equal(PORTABLE_AVATAR_PRESETS.length, 45);
  assert.equal(AVATAR_PRESETS.length, 70);
  assert.equal(new Set(AVATAR_PRESETS.map((preset) => preset.id)).size, 70);
  assert.equal(generated.entries.length, 64);
  assert.equal(new Set(generated.entries.map((entry) => entry.id)).size, 64);
  assert.deepEqual(generated.entries.map((entry) => entry.id).sort(),
    AVATAR_PRESETS.filter((preset) => !ATLAS_PRESETS.some((atlas) => atlas.id === preset.id)).map((preset) => preset.id).sort());
  assert.equal(avatarVisual('', {id: 'buddha_always_on'}).id, 'preset:guardian');
  assert.equal(avatarVisual('', {role_id: 'boss_routing'}).id, 'preset:coordinator');
  assert.equal(avatarVisual('preset:researcher', {}).position, '100% 100%');
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

function dataUrlForPreset(preset) {
  const entry = generated.entries.find((item) => item.id === preset.id);
  return readFile(new URL(entry.data, assetRoot)).then((bytes) =>
    `data:image/png;base64,${bytes.toString('base64')}`);
}

test('a newer portable selection wins when asset loads resolve out of order', async () => {
  const [olderPreset, newerPreset] = PORTABLE_AVATAR_PRESETS;
  const olderValue = await dataUrlForPreset(olderPreset);
  const newerValue = await dataUrlForPreset(newerPreset);
  const olderLoad = deferred();
  const newerLoad = deferred();
  const originalOlderLoader = assetCatalog[olderPreset.id].dataLoader;
  const originalNewerLoader = assetCatalog[newerPreset.id].dataLoader;
  assetCatalog[olderPreset.id].dataLoader = () => olderLoad.promise;
  assetCatalog[newerPreset.id].dataLoader = () => newerLoad.promise;

  try {
    const document = fakeDocument();
    const container = document.createElement('div');
    const persisted = [];
    mountAvatarPicker(container, 'preset:companion', {}, '/_astro/portraits.abc.png', (value) => {
      persisted.push(value);
    });
    container.children[1].children[2].click();
    const buttonFor = (id) => container.children[0].children.find((button) => button.dataset.preset === id);

    const olderClick = buttonFor(olderPreset.id).click();
    const newerClick = buttonFor(newerPreset.id).click();
    newerLoad.resolve(newerValue);
    await newerClick;
    olderLoad.resolve(olderValue);
    await olderClick;

    assert.deepEqual(persisted.map((value) => avatarVisual(value).id), [newerPreset.id]);
    assert.deepEqual(container.children[0].children
      .filter((button) => button.attributes['aria-pressed'] === 'true')
      .map((button) => button.dataset.preset), [newerPreset.id]);
    assert.equal(container.children[2].textContent, '');
  } finally {
    assetCatalog[olderPreset.id].dataLoader = originalOlderLoader;
    assetCatalog[newerPreset.id].dataLoader = originalNewerLoader;
  }
});

test('a stale portable asset failure cannot roll back a newer selection', async () => {
  const [failedPreset, currentPreset] = PORTABLE_AVATAR_PRESETS.slice(2, 4);
  const currentValue = await dataUrlForPreset(currentPreset);
  const failedLoad = deferred();
  const currentLoad = deferred();
  const originalFailedLoader = assetCatalog[failedPreset.id].dataLoader;
  const originalCurrentLoader = assetCatalog[currentPreset.id].dataLoader;
  assetCatalog[failedPreset.id].dataLoader = () => failedLoad.promise;
  assetCatalog[currentPreset.id].dataLoader = () => currentLoad.promise;

  try {
    const document = fakeDocument();
    const container = document.createElement('div');
    const persisted = [];
    mountAvatarPicker(container, 'preset:companion', {}, '/_astro/portraits.abc.png', (value) => {
      persisted.push(value);
    });
    container.children[1].children[2].click();
    const buttonFor = (id) => container.children[0].children.find((button) => button.dataset.preset === id);

    const failedClick = buttonFor(failedPreset.id).click();
    const currentClick = buttonFor(currentPreset.id).click();
    currentLoad.resolve(currentValue);
    await currentClick;
    failedLoad.reject(new Error('stale asset load failed'));
    await failedClick;

    assert.deepEqual(persisted.map((value) => avatarVisual(value).id), [currentPreset.id]);
    assert.deepEqual(container.children[0].children
      .filter((button) => button.attributes['aria-pressed'] === 'true')
      .map((button) => button.dataset.preset), [currentPreset.id]);
    assert.equal(container.children[2].textContent, '');
  } finally {
    assetCatalog[failedPreset.id].dataLoader = originalFailedLoader;
    assetCatalog[currentPreset.id].dataLoader = originalCurrentLoader;
  }
});

test('a failed newer selection rolls back to the last confirmed choice while an older load resolves later', async () => {
  const confirmedPreset = PORTABLE_AVATAR_PRESETS[2];
  const [pendingPreset, failedPreset] = PORTABLE_AVATAR_PRESETS;
  const pendingLoad = deferred();
  const failedLoad = deferred();
  const originalPendingLoader = assetCatalog[pendingPreset.id].dataLoader;
  const originalFailedLoader = assetCatalog[failedPreset.id].dataLoader;
  assetCatalog[pendingPreset.id].dataLoader = () => pendingLoad.promise;
  assetCatalog[failedPreset.id].dataLoader = () => failedLoad.promise;

  try {
    const document = fakeDocument();
    const container = document.createElement('div');
    const persisted = [];
    mountAvatarPicker(container, confirmedPreset.id, {}, '/_astro/portraits.abc.png', (value) => {
      persisted.push(value);
    });
    const buttonFor = (id) => container.children[0].children.find((button) => button.dataset.preset === id);

    const pendingClick = buttonFor(pendingPreset.id).click();
    const failedClick = buttonFor(failedPreset.id).click();
    failedLoad.reject(new Error('newer image load failed'));
    await failedClick;
    pendingLoad.resolve(await dataUrlForPreset(pendingPreset));
    await pendingClick;

    assert.deepEqual(persisted, []);
    assert.deepEqual(container.children[0].children
      .filter((button) => button.attributes['aria-pressed'] === 'true')
      .map((button) => button.dataset.preset), [confirmedPreset.id]);
    assert.equal(container.children[2].textContent,
      'Dieses Bild ist gerade nicht verfügbar. Die bisherige Auswahl bleibt erhalten.');
  } finally {
    assetCatalog[pendingPreset.id].dataLoader = originalPendingLoader;
    assetCatalog[failedPreset.id].dataLoader = originalFailedLoader;
  }
});

test('pagination and callback remount cleanup release only picker-owned observer targets', async () => {
  const originalIntersectionObserver = globalThis.IntersectionObserver;
  const instances = [];
  class FakeIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.targets = new Set();
      this.unobserved = [];
      instances.push(this);
    }
    observe(target) { this.targets.add(target); }
    unobserve(target) {
      this.unobserved.push(target);
      this.targets.delete(target);
    }
  }
  globalThis.IntersectionObserver = FakeIntersectionObserver;

  try {
    const document = fakeDocument();
    const container = document.createElement('div');
    const disposeMainPicker = mountAvatarPicker(container, 'preset:companion', {}, '/_astro/portraits.abc.png', () => {});
    assert.equal(instances.length, 1);
    const observer = instances[0];
    const pageTargets = () => container.children[0].children
      .flatMap((button) => button.children.filter((child) => child.dataset.avatarVariant));
    let maximumObserved = observer.targets.size;

    for (let page = 0; page < 4; page += 1) {
      const currentTargets = pageTargets();
      assert.deepEqual(observer.targets, new Set(currentTargets));
      assert.ok(observer.targets.size <= 18);
      maximumObserved = Math.max(maximumObserved, observer.targets.size);
      if (page === 3) break;

      container.children[1].children[2].click();
      for (const target of currentTargets) assert.ok(observer.unobserved.includes(target));
      assert.deepEqual(observer.targets, new Set(pageTargets()));
      assert.ok(observer.targets.size <= 18);
    }

    assert.equal(maximumObserved, 18);
    assert.equal(observer.unobserved.length, 48);
    assert.equal(observer.targets.size, 16);

    const unrelatedTargets = new Set(observer.targets);
    const remountContainer = document.createElement('div');
    const preset = PORTABLE_AVATAR_PRESETS[0];
    const remountLoad = deferred();
    const originalLoader = assetCatalog[preset.id].dataLoader;
    assetCatalog[preset.id].dataLoader = () => remountLoad.promise;
    let disposeRemountedPicker;
    try {
      const disposeInitialPicker = mountAvatarPicker(remountContainer, preset.id, {}, '/_astro/portraits.abc.png', (value) => {
        disposeRemountedPicker = mountAvatarPicker(remountContainer, value, {}, '/_astro/portraits.abc.png', () => {});
      });
      const buttonFor = () => remountContainer.children[0].children
        .find((button) => button.dataset.preset === preset.id);
      const pendingClick = buttonFor().click();
      const ownedTargetsDuringLoad = new Set(remountContainer.children[0].children
        .flatMap((button) => button.children.filter((child) => child.dataset.avatarVariant)));
      assert.equal(ownedTargetsDuringLoad.size, 18);
      remountLoad.resolve(await dataUrlForPreset(preset));
      await pendingClick;

      const remountedTargets = new Set(remountContainer.children[0].children
        .flatMap((button) => button.children.filter((child) => child.dataset.avatarVariant)));
      assert.equal(remountedTargets.size, 18);
      assert.deepEqual(observer.targets, new Set([...unrelatedTargets, ...remountedTargets]));
      for (const target of ownedTargetsDuringLoad) assert.ok(observer.unobserved.includes(target));
      for (const target of unrelatedTargets) assert.ok(observer.targets.has(target));
      disposeRemountedPicker();
      disposeInitialPicker();
      assert.deepEqual(observer.targets, unrelatedTargets);
    } finally {
      assetCatalog[preset.id].dataLoader = originalLoader;
    }
    disposeMainPicker();
    assert.equal(observer.targets.size, 0);
  } finally {
    if (originalIntersectionObserver === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = originalIntersectionObserver;
  }
});

test('uploads stay inert, Atlas fallback stays local, and preset assets load as thumbnails', async () => {
  const document = fakeDocument();
  const upload = 'data:image/png;base64,aGVsbG8=';
  assert.equal(avatarVisual(upload).url, upload);
  for (const unsafe of ['https://example.org/remote.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,AAAA', 'preset:unknown']) {
    assert.equal(avatarVisual(unsafe, {id: 'buddha_chat'}).id, 'preset:companion');
  }
  const atlas = createAvatar(document, 'preset:engineer', {}, '/_astro/portraits.abc.png');
  assert.equal(atlas.tag, 'span');
  assert.equal(atlas.dataset.avatarPreset, 'preset:engineer');
  assert.equal(atlas.style.backgroundSize, '300% 200%');
  assert.throws(() => createAvatar(document, 'preset:engineer', {}, 'https://foreign.example/portraits.png'), /Porträtquelle/);

  const preview = createAvatar(document, GEMINI_AVATAR_PRESETS[0].id, {}, '/_astro/portraits.abc.png', 'agent-avatar-preview');
  assert.equal(preview.tag, 'img');
  assert.equal(preview.loading, 'lazy');
  assert.equal(preview.decoding, 'async');
  assert.equal(preview.dataset.avatarVariant, 'large');
  assert.equal(preview.style.backgroundImage, 'none');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(preview.src, assetCatalog[GEMINI_AVATAR_PRESETS[0].id].large);
  preview.listeners.error();
  assert.equal(preview.src, undefined);
  assert.equal(preview.dataset.avatarLoadError, 'true');
  assert.equal(preview.style.backgroundImage, 'url("/_astro/portraits.abc.png")');

  const uploaded = createAvatar(document, upload, {}, null);
  assert.equal(uploaded.tag, 'img');
  assert.equal(uploaded.src, upload);
});

test('picker exposes bounded pages while preserving every preset and the selected ID', () => {
  const document = fakeDocument();
  const container = document.createElement('div');
  mountAvatarPicker(container, 'preset:coordinator', {}, '/_astro/portraits.abc.png', () => {});

  const seen = [];
  let maximumVisible = 0;
  let page = 0;
  while (true) {
    const [grid, controls] = container.children;
    assert.ok(grid.children.length <= 18);
    maximumVisible = Math.max(maximumVisible, grid.children.length);
    seen.push(...grid.children.map((button) => button.dataset.preset));
    if (page === 0) assert.equal(grid.children.find((button) => button.dataset.preset === 'preset:coordinator').attributes['aria-pressed'], 'true');
    if (controls.children[2].disabled) break;
    controls.children[2].click();
    page += 1;
  }

  assert.equal(page, 3);
  assert.equal(maximumVisible, 18);
  assert.deepEqual(seen, AVATAR_PRESETS.map((preset) => preset.id));
  assert.equal(container.children[1].children[1].textContent, '55–70 von 70');
});

test('existing portable data URIs resolve to their stable preset ID after reload', async () => {
  const preset = PORTABLE_AVATAR_PRESETS[31];
  const record = generated.entries.find((entry) => entry.id === preset.id);
  const oldBytes = await readFile(new URL(`../src/assets/${record.source}`, import.meta.url));
  assert.equal(createHash('sha256').update(oldBytes).digest('hex'), record.legacyDataSha256);
  const existingValue = `data:image/png;base64,${oldBytes.toString('base64')}`;
  assert.equal(avatarVisual(existingValue).kind, 'upload');

  const document = fakeDocument();
  const container = document.createElement('div');
  mountAvatarPicker(container, existingValue, {}, '/_astro/portraits.abc.png', () => {});
  for (let attempt = 0; attempt < 20 && container.children[1].children[1].textContent === '1–18 von 70'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const expectedIndex = AVATAR_PRESETS.findIndex((item) => item.id === preset.id);
  assert.equal(container.children[1].children[1].textContent,
    `${Math.floor(expectedIndex / 18) * 18 + 1}–${Math.min(Math.floor(expectedIndex / 18) * 18 + 18, 70)} von 70`);
  const selected = container.children[0].children.filter((button) => button.attributes['aria-pressed'] === 'true');
  assert.deepEqual(selected.map((button) => button.dataset.preset), [preset.id]);
});

test('portable preset selection lazily imports one verified image and keeps the existing data-URI contract', async () => {
  const preset = PORTABLE_AVATAR_PRESETS[0];
  const record = generated.entries.find((entry) => entry.id === preset.id);
  const bytes = await readFile(new URL(`${record.data}`, assetRoot));
  let loadCount = 0;
  const originalLoader = assetCatalog[preset.id].dataLoader;
  assetCatalog[preset.id].dataLoader = async () => {
    loadCount += 1;
    return `data:image/png;base64,${bytes.toString('base64')}`;
  };
  const document = fakeDocument();
  const container = document.createElement('div');
  let selectedValue;
  mountAvatarPicker(container, 'preset:companion', {}, '/_astro/portraits.abc.png', (value) => { selectedValue = value; });
  assert.equal(loadCount, 0);
  let button;
  while (!(button = container.children[0].children.find((item) => item.dataset.preset === preset.id))) {
    const next = container.children[1].children[2];
    assert.equal(next.disabled, false);
    next.click();
  }
  await button.click();
  assert.equal(loadCount, 1);
  assert.match(selectedValue, /^data:image\/png;base64,/);
  const encoded = selectedValue.slice('data:image/png;base64,'.length);
  assert.deepEqual(Buffer.from(encoded, 'base64'), bytes);
  assert.equal(avatarVisual(selectedValue).id, preset.id);
  assetCatalog[preset.id].dataLoader = originalLoader;
});

test('versioned thumbnails and larger variants are bounded, hash-bound, and metadata-free', async () => {
  assert.equal(generated.schema, 'ellmos.agent-avatar-thumbnails.v1');
  assert.equal(generated.catalogVersion, 'v1');
  assert.equal(generated.generatedWith, 'sharp 0.35.5');
  let thumbnailTotal = 0;
  for (const entry of generated.entries) {
    const thumbnail = await readFile(new URL(entry.thumbnail, assetRoot));
    const large = await readFile(new URL(entry.large, assetRoot));
    thumbnailTotal += thumbnail.length;
    assert.equal(createHash('sha256').update(thumbnail).digest('hex'), entry.thumbnailSha256);
    assert.equal(createHash('sha256').update(large).digest('hex'), entry.largeSha256);
    const thumbMetadata = await sharp(thumbnail).metadata();
    const largeMetadata = await sharp(large).metadata();
    assert.deepEqual([thumbMetadata.width, thumbMetadata.height], [96, 96]);
    assert.ok(largeMetadata.width <= 512 && largeMetadata.height <= 512);
    for (const metadata of [thumbMetadata, largeMetadata]) {
      assert.equal(metadata.exif, undefined);
      assert.equal(metadata.iptc, undefined);
      assert.equal(metadata.xmp, undefined);
      assert.equal(metadata.icc, undefined);
    }
    if (entry.kind === 'portable') {
      const data = await readFile(new URL(entry.data, assetRoot));
      const dataMetadata = await sharp(data).metadata();
      assert.equal(createHash('sha256').update(data).digest('hex'), entry.dataSha256);
      assert.ok(data.length <= 180000);
      assert.equal(dataMetadata.format, 'png');
      assert.equal(dataMetadata.exif, undefined);
      assert.equal(dataMetadata.iptc, undefined);
      assert.equal(dataMetadata.xmp, undefined);
      assert.equal(dataMetadata.icc, undefined);
      assert.match(entry.legacyDataSha256, /^[0-9a-f]{64}$/);
    }
  }
  assert.ok(thumbnailTotal < 200000);

  const browserEntry = await readFile(new URL('../src/lib/agent-avatar-browser.mjs', import.meta.url), 'utf8');
  const catalogSource = await readFile(new URL('../src/lib/agent-avatar-catalog.mjs', import.meta.url), 'utf8');
  assert.ok(!browserEntry.includes('new-agent-avatar-assets'));
  assert.ok(!browserEntry.includes('gemini-avatar-assets'));
  assert.ok(catalogSource.includes("export const AVATAR_CATALOG_VERSION = 'v1'"));
  assert.ok(catalogSource.includes('?url&no-inline'));
  assert.ok(catalogSource.includes('?inline'));
  assert.ok(!catalogSource.includes('-data.png?url'));
  assert.ok(!catalogSource.includes('data:image/'));
});
