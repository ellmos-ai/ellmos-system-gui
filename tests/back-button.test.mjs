import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideBackAction } from "../src/components/back-button-logic.mjs";

test("same-origin referrer from another page resolves to back mode", () => {
  assert.deepEqual(
    decideBackAction({
      referrer: "http://localhost:4321/chat",
      href: "http://localhost:4321/talk",
      historyLength: 2,
      companion: false,
    }),
    { mode: "back", label: "Zurück" },
  );

  // Even when historyLength is 1, a same-origin referrer to a different page shows "Zurück"
  assert.deepEqual(
    decideBackAction({
      referrer: "http://localhost:4321/talk",
      href: "http://localhost:4321/sensation",
      historyLength: 1,
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
      historyLength: 3,
      companion: false,
    }),
    { mode: "fallback", label: "Zur Startseite" },
  );
});

test("empty referrer resolves to fallback mode even with historyLength > 1", () => {
  assert.deepEqual(
    decideBackAction({
      referrer: "",
      href: "http://localhost:4321/sensation",
      historyLength: 4,
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
      historyLength: 2,
      companion: false,
    }),
    { mode: "fallback", label: "Zur Startseite" },
  );

  assert.deepEqual(
    decideBackAction({
      referrer: "http://localhost:4321/talk#section",
      href: "http://localhost:4321/talk",
      historyLength: 2,
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
      historyLength: 2,
      companion: true,
    }),
    { mode: "close", label: "Fenster schließen" },
  );

  // Via URL query parameter ?companion=1 when companion argument is omitted
  assert.deepEqual(
    decideBackAction({
      referrer: "http://localhost:4321/agenten/running",
      href: "http://localhost:4321/talk?companion=1",
      historyLength: 1,
    }),
    { mode: "close", label: "Fenster schließen" },
  );

  // Via string "1"
  assert.deepEqual(
    decideBackAction({
      referrer: "",
      href: "http://localhost:4321/talk",
      historyLength: 1,
      companion: "1",
    }),
    { mode: "close", label: "Fenster schließen" },
  );
});

test("BackButton component is wired into sensation.astro and talk.astro with required accessibility attributes", () => {
  const backButtonAstro = readFileSync(new URL("../src/components/BackButton.astro", import.meta.url), "utf8");
  const sensationAstro = readFileSync(new URL("../src/pages/sensation.astro", import.meta.url), "utf8");
  const talkAstro = readFileSync(new URL("../src/pages/talk.astro", import.meta.url), "utf8");

  assert.match(backButtonAstro, /aria-label="Zurück zur vorherigen Seite"/);
  assert.match(backButtonAstro, /:focus-visible/);
  assert.match(backButtonAstro, /window\.close\(\)/);
  assert.match(backButtonAstro, /300/);
  assert.match(sensationAstro, /import BackButton from "\.\.\/components\/BackButton\.astro"/);
  assert.match(sensationAstro, /<BackButton\b/);
  assert.match(talkAstro, /import BackButton from "\.\.\/components\/BackButton\.astro"/);
  assert.match(talkAstro, /<BackButton\b/);
});
