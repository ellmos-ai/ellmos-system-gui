import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../src/pages/agenten/${path}.astro`, import.meta.url), "utf8");
const library = read("fabrika");
const promptAgents = read("subscription-agents");
const running = read("running");

test("the Agenten-Bibliothek exposes the three library areas", () => {
  for (const label of ["Vorlagen", "Prompt-Agenten", "Ketten"])
    assert.match(library, new RegExp(label));
  assert.match(library, /Living &amp; Running/);
  for (const href of ["/agenten/blueprints", "/agenten/subscription-agents", "/agenten/marblerun"])
    assert.match(library, new RegExp(href.replaceAll("/", "\\/")));
  assert.match(library, /Nur dort werden bestätigte Living- oder Running-Zustände/);
});

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
