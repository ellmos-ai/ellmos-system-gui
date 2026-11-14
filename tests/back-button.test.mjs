import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideBackAction } from "../src/components/back-button-logic.mjs";

test("same-origin referrer from another page resolves to back mode", () => {
  assert.deepEqual(
    decideBackAction({
      referrer: "http://localhost:4321/chat",
      href: "http://localhost:4321/talk",
      companion: false,
    }),
    { mode: "back", label: "Zurück" },
  );

  // Another same-origin page shows "Zurück"
  assert.deepEqual(
    decideBackAction({
      referrer: "http://localhost:4321/talk",
      href: "http://localhost:4321/sensation",
      companion: false,
    }),
    { mode: "back", label: "Zurück" },
  );
});

test("external referrer resolves to fallback mode", () => {
  assert.deepEqual(
    decideBackAction({
      referrer: "https://example.org/chat",
      href: "http://localhost:4321/talk",
      companion: false,
    }),
    { mode: "fallback", label: "Zur Startseite" },
  );
});

test("empty referrer resolves to fallback mode", () => {
  assert.deepEqual(
    decideBackAction({
      referrer: "",
      href: "http://localhost:4321/sensation",
      companion: false,
    }),
    { mode: "fallback", label: "Zur Startseite" },
  );
});

test("referrer equal to current URL (or only differing by hash) resolves to fallback mode", () => {
  assert.deepEqual(
    decideBackAction({
      referrer: "http://localhost:4321/talk",
      href: "http://localhost:4321/talk",
      companion: false,
    }),
    { mode: "fallback", label: "Zur Startseite" },
  );

  assert.deepEqual(
    decideBackAction({
      referrer: "http://localhost:4321/talk#section",
      href: "http://localhost:4321/talk",
      companion: false,
    }),
    { mode: "fallback", label: "Zur Startseite" },
  );
});

test("companion=1 resolves to close mode regardless of referrer", () => {
  // Via explicit companion boolean/flag
  assert.deepEqual(
    decideBackAction({
      referrer: "http://localhost:4321/chat",
      href: "http://localhost:4321/talk?companion=1",
      companion: true,
    }),
    { mode: "close", label: "Fenster schließen" },
  );

  // Via URL query parameter ?companion=1 when companion argument is omitted
  assert.deepEqual(
    decideBackAction({
      referrer: "http://localhost:4321/agenten/running",
      href: "http://localhost:4321/talk?companion=1",
    }),
    { mode: "close", label: "Fenster schließen" },
  );

  // Via string "1"
  assert.deepEqual(
    decideBackAction({
      referrer: "",
      href: "http://localhost:4321/talk",
      companion: "1",
    }),
    { mode: "close", label: "Fenster schließen" },
  );
});

test("BackButton is wired into sensation.astro and talk.astro and always offers a way out", () => {
  const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
  const component = read("../src/components/BackButton.astro");
  // Without script the server-rendered link still leads to the fallback.
  assert.match(component, /<a href=\{fallback\}/);
  assert.match(component, /window\.close\(\)/);
  assert.match(component, /location\.assign\(/);
  for (const page of ["sensation", "talk"]) {
    const source = read(`../src/pages/${page}.astro`);
    assert.match(source, /import BackButton from "\.\.\/components\/BackButton\.astro"/);
    assert.match(source, /<BackButton fallback="\/" \/>/);
  }
});
