import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {libraryRedirectTarget} from "../src/lib/library-redirect.mjs";

const read = path => readFileSync(new URL(`../src/pages/agenten/${path}.astro`, import.meta.url), "utf8");

test("the bare old library URLs land on the template page (B-08)", () => {
  assert.equal(libraryRedirectTarget(""), "/agenten/blueprints");
  assert.equal(libraryRedirectTarget("?tab=other"), "/agenten/blueprints");
});
test("legacy blueprint and team links keep their destination", () => {
  assert.equal(libraryRedirectTarget("?load=entwickler"), "/agenten/blueprints?blueprint=entwickler");
  assert.equal(libraryRedirectTarget("?blueprint=entwickler"), "/agenten/blueprints?blueprint=entwickler");
  assert.equal(libraryRedirectTarget("?tab=teambuilding"), "/agenten/blueprints?tab=teams");
  assert.equal(libraryRedirectTarget("?tab=teams"), "/agenten/blueprints?tab=teams");
});
test("legacy links cannot redirect to external sites", () => {
  assert.equal(libraryRedirectTarget("?load=https://external.example"), "/agenten/blueprints?blueprint=https%3A%2F%2Fexternal.example");
  assert.equal(libraryRedirectTarget("?load=//external.example"), "/agenten/blueprints?blueprint=%2F%2Fexternal.example");
});
test("both redirect pages use the shared target function and a no-script fallback", () => {
  for (const name of ["fabrika", "bibliothek"]) {
    const page = read(name);
    assert.match(page, /import \{ libraryRedirectTarget \} from "\.\.\/\.\.\/lib\/library-redirect\.mjs"/);
    assert.match(page, /location\.replace\(libraryRedirectTarget\(location\.search\)\)/);
    assert.match(page, /http-equiv="refresh" content="0;url=\/agenten\/blueprints"/);
  }
});
const promptAgents = read("subscription-agents");
const running = read("running");

test("Prompt-Agenten are explicitly external and not controlled by this GUI", () => {
  assert.match(promptAgents, /Prompt-Agenten/);
  assert.match(promptAgents, /extern zugeschaltet und von dieser GUI nicht gesteuert/);
  assert.match(promptAgents, /weder einen Client-Start noch einen laufenden Agenten/);
});

test("Living & Running does not ship a fixed model catalog", () => {
  assert.doesNotMatch(running, /AVAILABLE_MODELS/);
  assert.doesNotMatch(running, /qwen3\.8:27b-mlx/);
  assert.doesNotMatch(running, /openrouter\/free/);
  assert.match(running, /Modell-ID aus Adapter/);
  assert.match(running, /Aktueller Modellkatalog/);
});
