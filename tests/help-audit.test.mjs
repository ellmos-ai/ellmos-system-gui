import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const page = readFileSync(new URL("../src/pages/help.astro", import.meta.url), "utf8");
const script = page.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
const report = {
  schema: "ellmos.doc-keeper-audit-report.v1",
  parity_check: {
    schema: "ellmos.open-ocean.cli-api-parity.v1",
    drift_detected: false,
  },
  findings: [],
};

function element() {
  return {
    style: {},
    children: [],
    textContent: "",
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    set innerHTML(_value) { assert.fail("Audit data must be rendered as text"); },
  };
}

async function renderAudit(auditResponse) {
  const badge = element();
  const findings = element();
  const modules = element();
  const nodes = {
    "help-doc-audit-badge": badge,
    "help-doc-audit-findings": findings,
    "help-module-manifest-list": modules,
  };
  await runInNewContext(script, {
    document: {
      createElement: element,
      getElementById: (id) => nodes[id],
      querySelectorAll: () => [],
    },
    fetch: async (path) => {
      if (path === "/api/domains/modules") return { ok: false };
      assert.equal(path, "/api/help/doc-audit");
      return auditResponse;
    },
    URLSearchParams,
    window: { location: { search: "" } },
  });
  return { badge, findings };
}

test("reports missing or malformed audit responses as unavailable", async () => {
  assert.match(page, /role="status"[^>]*>Prüfstatus wird abgerufen/);
  for (const response of [{ ok: false }, { ok: true, json: async () => ({ findings: [] }) }]) {
    const { badge, findings } = await renderAudit(response);
    assert.equal(badge.textContent, "Prüfstatus nicht verfügbar");
    assert.equal(findings.children.length, 0);
  }
});

test("shows the limited CLI and language file check without a report date", async () => {
  const { badge } = await renderAudit({ ok: true, json: async () => report });
  assert.equal(badge.textContent, "Kurzcheck ohne datierten Bericht · Erwartete CLI-Einträge und Sprachdateien vorhanden");
});

test("dates archived findings and renders their fields even if the module service fails", async () => {
  const claim = "Literal <example> &text";
  const payload = {
    ...report,
    generated_at: "2026-11-01T12:00:00Z",
    parity_check: { ...report.parity_check, drift_detected: true },
    findings: [{
      cause: "unintended_erosion",
      doc_source: "SKILL.md",
      claim_statement: claim,
      deterministic_action: "review",
    }],
  };
  const { badge, findings } = await renderAudit({ ok: true, json: async () => payload });
  assert.match(badge.textContent, /^Bericht vom 01\.11\.2026.*Fehlende CLI-Einträge oder Sprachdateien$/);
  const [cause, , source, , actualClaim, , status] = findings.children[0].children;
  assert.equal(cause.textContent, "unintended_erosion");
  assert.equal(source.textContent, "SKILL.md");
  assert.equal(actualClaim, claim);
  assert.equal(status.textContent, "review");
});
