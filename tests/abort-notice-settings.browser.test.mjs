import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { sharedDist } from "./fixtures/shared-dist.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://localhost:41257";
const endpoint = "/api/system/abort-notice-settings";
const saved = (rev, repeated_abort, max_per_hour) => ({
  schema: "bach.abort-notice-settings.v1",
  configuration_version: rev.repeat(64),
  source: "user_override",
  repeated_abort,
  max_per_hour,
});

let browser, dist;
test.before(async () => {
  const { chromium } = await import("playwright-core");
  const channel = process.env.PLAYWRIGHT_CHANNEL;
  try {
    browser = await chromium.launch(channel ? { channel } : {});
  } catch (error) {
    if (channel) throw error;
    return;
  }
  dist = await sharedDist(root);
});
test.after(async () => { await browser?.close(); });

async function open(t, handle) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route(`${origin}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === endpoint) return handle(route);
    const file = join(dist, url.pathname === "/settings" ? "settings.html" : url.pathname);
    if (!existsSync(file) || !extname(file)) return route.fulfill({ status: 404, json: {} });
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
    return route.fulfill({
      contentType: types[extname(file)] || "application/octet-stream",
      body: readFileSync(file),
    });
  });
  await page.goto(`${origin}/settings?tab=worker-policy`);
  return page;
}

test("saves the switch and zero-message limit only after persisted readback", async t => {
  if (!browser) return t.skip("Playwright Chromium is unavailable");
  let state = saved("a", true, 3);
  let readbacks = 0;
  let payload;
  const page = await open(t, route => {
    if (route.request().method() === "GET") {
      readbacks += 1;
      return route.fulfill({ json: state });
    }
    payload = route.request().postDataJSON();
    state = saved("b", payload.repeated_abort, payload.max_per_hour);
    return route.fulfill({ json: { ...state, updated: true } });
  });
  const status = page.locator("#abort-notice-status");
  await status.filter({hasText: "Aktueller Stand geladen."}).waitFor();
  const checkbox = page.getByRole("checkbox", {name: "Wiederholte Abbrüche im Postfach melden"});
  assert.equal(await checkbox.isChecked(), true);
  await checkbox.uncheck();
  await page.getByRole("spinbutton", {name: "Einzelmeldungen pro Stunde"}).fill("0");
  await page.getByRole("button", {name: "Abbruchmeldungen speichern"}).click();
  await status.filter({hasText: "Gespeichert und vom Backend bestätigt."}).waitFor();
  assert.deepEqual(payload, {configuration_version: "a".repeat(64), repeated_abort: false, max_per_hour: 0});
  assert.equal(readbacks, 2);
});

test("a version conflict reloads the other change without retrying the write", async t => {
  if (!browser) return t.skip("Playwright Chromium is unavailable");
  let writes = 0;
  const page = await open(t, route => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: writes ? saved("b", true, 5) : saved("a", true, 3) });
    }
    writes += 1;
    return route.fulfill({ status: 409, json: {} });
  });
  const limit = page.getByRole("spinbutton", {name: "Einzelmeldungen pro Stunde"});
  await limit.fill("9");
  await page.getByRole("button", {name: "Abbruchmeldungen speichern"}).click();
  await page.locator("#abort-notice-status").filter({hasText: "parallel geändert"}).waitFor();
  assert.equal(await limit.inputValue(), "5");
  assert.equal(writes, 1);
});

test("an acknowledged write with different readback values remains unconfirmed", async t => {
  if (!browser) return t.skip("Playwright Chromium is unavailable");
  const state = saved("a", true, 3);
  const page = await open(t, route => route.fulfill({
    json: route.request().method() === "GET" ? state : { ...saved("b", true, 10), updated: true },
  }));
  const limit = page.getByRole("spinbutton", {name: "Einzelmeldungen pro Stunde"});
  await limit.fill("10");
  await page.getByRole("button", {name: "Abbruchmeldungen speichern"}).click();
  await page.locator("#abort-notice-status").filter({hasText: "Das Backend meldet andere Werte"}).waitFor();
  assert.equal(await limit.inputValue(), "3");
});

test("an unavailable endpoint exposes a retry and keeps editing hidden", async t => {
  if (!browser) return t.skip("Playwright Chromium is unavailable");
  let reads = 0;
  const page = await open(t, route => {
    reads += 1;
    return route.fulfill(reads === 1 ? {status: 404, json: {}} : {json: saved("b", false, 2)});
  });
  const status = page.locator("#abort-notice-status");
  await status.filter({hasText: "Einstellungen derzeit nicht verfügbar."}).waitFor();
  assert.equal(await page.locator("#abort-notice-form").isVisible(), false);
  await page.getByRole("button", {name: "Aktuellen Stand laden"}).click();
  await status.filter({hasText: "Aktueller Stand geladen."}).waitFor();
  assert.equal(await page.getByRole("spinbutton", {name: "Einzelmeldungen pro Stunde"}).inputValue(), "2");
});
