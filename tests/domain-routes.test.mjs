import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {domainWorkbenchRoute,DOMAIN_WORKBENCH_ROUTES} from '../src/lib/domain-routes.mjs';
test('only implemented exact workbench routes can be active links',()=>{
  for(const route of DOMAIN_WORKBENCH_ROUTES)assert.equal(domainWorkbenchRoute(route),route);
  for(const route of ['/domains/law-checker','/domains/report-forge','/foerderplaner','/unknown',
    'javascript:alert(1)','https://foreign.example/financial','//foreign.example/financial',
    '/financial?redirect=https://foreign.example','/financial#stub','/financial/',' /financial',null,{}])
    assert.equal(domainWorkbenchRoute(route),null);
});
test('domain placeholders and unfinished menu pin action stay disabled without a write request',()=>{
  const source=readFileSync(new URL('../src/pages/domains.astro',import.meta.url),'utf8');
  assert.match(source,/domainWorkbenchRoute\(declaredWorkbench\)/);
  assert.match(source,/pinBtn\.disabled = true/);
  assert.match(source,/Aufgabe #1932/);
  assert.match(source,/Fachseite noch nicht angebunden/);
  assert.doesNotMatch(source,/method:\s*['"]POST|togglePin/);
});
