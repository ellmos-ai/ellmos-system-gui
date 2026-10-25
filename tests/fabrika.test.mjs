import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {Script} from "node:vm";

const read = path => readFileSync(new URL(`../src/pages/agenten/${path}.astro`, import.meta.url), "utf8");
const library = read("fabrika");
const source = library.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
function redirect(search) {
  let destination;
  new Script(source).runInNewContext({URL, URLSearchParams, location: {origin: "https://gui.example.test", search, replace(value) { destination = value; }}});
  return destination;
}

test("the bare library URL stays on the library", () => {
  assert.equal(redirect(""), undefined);
  assert.equal(redirect("?tab=other"), undefined);
});
test("legacy blueprint and team links keep their destination", () => {
  assert.equal(redirect("?load=entwickler"), "/agenten/blueprints?blueprint=entwickler");
  assert.equal(redirect("?blueprint=entwickler"), "/agenten/blueprints?blueprint=entwickler");
  assert.equal(redirect("?tab=teambuilding"), "/agenten/blueprints?tab=teams");
  assert.equal(redirect("?tab=teams"), "/agenten/blueprints?tab=teams");
});
test("legacy links cannot redirect to external sites", () => {
  assert.equal(redirect("?load=https://external.example"), "/agenten/blueprints?blueprint=https%3A%2F%2Fexternal.example");
});
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
