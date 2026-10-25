import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {domainWorkbenchRoute,domainAnonymizationRoute,DOMAIN_WORKBENCH_ROUTES} from '../src/lib/domain-routes.mjs';
test('only implemented exact workbench routes can be active links',()=>{
  for(const route of DOMAIN_WORKBENCH_ROUTES)assert.equal(domainWorkbenchRoute(route),route);
  for(const route of ['/domains/law-checker','/domains/report-forge','/foerderplaner','/unknown',
    'javascript:alert(1)','https://foreign.example/financial','//foreign.example/financial',
    '/financial?redirect=https://foreign.example','/financial#stub','/financial/',' /financial',null,{}])
    assert.equal(domainWorkbenchRoute(route),null);
});
test('unimplemented workbench links remain disabled when pinning is available',()=>{
  const source=readFileSync(new URL('../src/scripts/domain-studio.mjs',import.meta.url),'utf8');
  assert.match(source,/domainWorkbenchRoute\(declared\)/);
  assert.match(source,/Fachseite noch nicht angebunden/);
  assert.match(source,/aria-disabled/);
  assert.match(source,/makePinButton\(domain.id\)/);
});
test('Förderplaner links to the existing quarantine tab without a second mask',()=>{
  assert.equal(domainAnonymizationRoute('foerderplaner'),'/inbox');
  assert.equal(domainWorkbenchRoute('/inbox'),null);
  for(const id of ['Foerderplaner','anonymizer','other','../foerderplaner',null,{}])
    assert.equal(domainAnonymizationRoute(id),null);
  const source=readFileSync(new URL('../src/scripts/domain-studio.mjs',import.meta.url),'utf8');
  assert.match(source,/domainAnonymizationRoute\(domain.id\)/);
  assert.match(source,/a.href=anonymizationRoute/);
  assert.match(source,/Quarantäne \/ Anonymisierung/);
  assert.doesNotMatch(source,/profile-form|anon-terms|redaction_terms/);
});
