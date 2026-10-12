import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";

const projectRequire = createRequire(new URL("../package.json", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const memorySource = await readFile(new URL("../src/pages/memory.astro", import.meta.url), "utf8");
const mermaidEntry = projectRequire.resolve("mermaid");
const mermaidRequire = createRequire(mermaidEntry);
const katexEntry = mermaidRequire.resolve("katex");
const katex = createRequire(katexEntry)("katex");
const katexPackage = JSON.parse(await readFile(resolve(dirname(katexEntry), "../package.json"), "utf8"));

test("Mermaid stays pinned and resolves the exact KaTeX override", () => {
  assert.equal(manifest.dependencies.mermaid, "11.17.2");
  assert.equal(manifest.dependencies.katex, undefined);
  assert.equal(manifest.overrides?.mermaid?.katex, "0.18.7");
  assert.equal(lock.packages["node_modules/mermaid"].version, "11.17.2");
  assert.equal(lock.packages["node_modules/mermaid"].dependencies.katex, "^0.16.47");
  assert.equal(lock.packages["node_modules/katex"].version, "0.18.7");
  assert.equal(
    lock.packages["node_modules/katex"].resolved,
    "https://registry.npmjs.org/katex/-/katex-0.18.7.tgz",
  );
  assert.match(lock.packages["node_modules/katex"].integrity, /^sha512-/);
  assert.equal(katexPackage.version, "0.18.7");
});

test("the Mermaid-resolved KaTeX still renders mathematical markup", () => {
  const html = katex.renderToString("\\frac{1}{2}", {
    throwOnError: true,
    output: "htmlAndMathml",
  });
  assert.match(html, /class="katex"/);
  assert.match(html, /class="mfrac"/);
  assert.match(html, /<math/);
});

test("KaTeX ignores inherited trust settings but keeps explicit trust behavior", () => {
  const unsafeMath = "\\href{javascript:alert(1)}{open}";
  const inheritedOptions = Object.create({ trust: true });
  const inheritedHtml = katex.renderToString(unsafeMath, inheritedOptions);
  assert.doesNotMatch(inheritedHtml, /href="javascript:/i);

  const previousTrust = Object.getOwnPropertyDescriptor(Object.prototype, "trust");
  let pollutedHtml;
  try {
    Object.defineProperty(Object.prototype, "trust", {
      configurable: true,
      enumerable: false,
      value: true,
      writable: true,
    });
    pollutedHtml = katex.renderToString(unsafeMath, {});
  } finally {
    if (previousTrust) {
      Object.defineProperty(Object.prototype, "trust", previousTrust);
    } else {
      delete Object.prototype.trust;
    }
  }
  assert.doesNotMatch(pollutedHtml, /href="javascript:/i);

  const trustedHttps = katex.renderToString(
    "\\href{https://example.com}{open}",
    { trust: true },
  );
  assert.ok(trustedHttps.includes('href="https://example.com"'));
});

test("the production Mermaid page retains strict security and theme selection", () => {
  assert.ok(memorySource.includes("securityLevel: 'strict'"));
  assert.ok(memorySource.includes("theme: themeName"));
  assert.ok(memorySource.includes("const themeName = isLight ? 'default' : 'dark'"));
  assert.ok(memorySource.includes("flowchart: { curve: 'basis', htmlLabels: false }"));
});
