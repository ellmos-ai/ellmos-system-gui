import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readTab, registryQuery, effectiveQuery, describeFailure, ageLabel, viewState, writerNotice, nextTabIndex,
  parseLocks, parseStatus, parseDecisions, parsePolicies, parseRegistry, parseEffective} from '../src/lib/governance-readers.mjs';

// Synthetic fixtures. Field names are copied from the BACH handlers at c71e4605 (system/ prefix omitted):
// gui/api/unified_api.py:1044-1128, gui/api/governance_registry.py:18-28,
// hub/_services/policy_registry_adapter.py:54-108 (pointer() and observe()).
const entry = (over = {}) => ({id: 'synthetic.policy.one', kind: 'policy', title: 'Synthetic policy', scope: 'global',
  version: '1', privacy: 'public', status: 'active', adoption: 'adopted', priority: 5, precedence: 1,
  source: {type: 'local-pointer', label: 'synthetic.policy.one'}, source_sha256: 'a'.repeat(64),
  source_state: 'ok', source_verified: true, enforcement_verified: false, ...over});
// adapter observe() result shape: policy_registry_adapter.py:84-97
const registry = (entries = [entry()], extra = {}) => ({schema: 'bach.policy-registry.v1', availability: 'available',
  observed_at: '2026-10-10T12:00:00+00:00', source: 'policy-registry',
  provider: {id: 'policy-registry', version: '0.2.4', source_commit: 'c'.repeat(40), repository: 'https://example.invalid/r', verified: true},
  registry_version: 'b'.repeat(64), read_only: true, enforcement_verified: false, entries, count: entries.length,
  source_verification_complete: entries.length > 0, // adapter line 92: bool(entries) and all(...)
  decision_writer: {id: 'decision-clicker', available: false, reason: 'separate_explicit_adoption_required'}, ...extra});

test('tab is read from the query and defaults to status', () => {
  assert.equal(readTab('?tab=locks'), 'locks');
  assert.equal(readTab('?tab=effective&scope=x'), 'effective');
  assert.equal(readTab('?tab=evil'), 'status');
  assert.equal(readTab(''), 'status');
});

test('registry and effective queries mirror the handler parameters and limits (governance_registry.py:18-28)', () => {
  assert.equal(registryQuery({scope: ' a ', consumer: '', query: 'q', kind: 'rule'}).toString(), 'scope=a&query=q&kind=rule');
  assert.throws(() => registryQuery({kind: 'bogus'}), /kind/);
  assert.throws(() => registryQuery({scope: 'x'.repeat(257)}), /scope/);
  assert.throws(() => registryQuery({query: 'x'.repeat(513)}), /query/);
  assert.throws(() => effectiveQuery({scope: ' '}), /scope/);
  assert.equal(effectiveQuery({scope: 'g', consumer: 'c', kind: 'rule'}).toString(), 'scope=g&consumer=c');
});

test('locks: /api/governance/locks fields (unified_api.py:1103-1110, rows from :106-150)', () => {
  const model = parseLocks({locks: [{name: 'LOCK.txt', scope: 'all', type: 'lock', status: 'active'}], count: 1,
    availability: 'available', source: 'lock_scan_cache', checked_at: '2026-10-10T12:00:00+00:00',
    scanned_at: '2026-10-10T11:55:00+00:00', error: null});
  assert.equal(model.count, 1);
  assert.equal(model.rows[0].name, 'LOCK.txt');
  assert.equal(model.scannedAt, '2026-10-10T11:55:00+00:00');
  assert.equal(model.schema, null);
  assert.equal(viewState(model), 'ok');
});

test('locks: missing, stale and empty scans stay distinguishable', () => {
  const base = {locks: [], availability: 'unavailable', source: 'lock_scan_cache', checked_at: '2026-10-10T12:00:00+00:00',
    scanned_at: null, count: null, error: 'lock_cache_missing'};
  assert.equal(viewState(parseLocks(base)), 'unavailable');
  assert.equal(viewState(parseLocks({...base, availability: 'stale', error: 'lock_cache_stale'})), 'stale');
  assert.equal(viewState(parseLocks({...base, availability: 'available', count: 0, error: null})), 'empty');
  assert.equal(parseLocks(base).count, null);
});

test('status: fields of /api/governance/status (unified_api.py:1044-1063)', () => {
  const model = parseStatus({status: 'observed', timestamp: '2026-10-10T12:00:00+00:00', source: 'lock_scan_cache',
    availability: 'available', scanned_at: '2026-10-10T11:59:00+00:00', error: null,
    recent_decisions: [entry({id: 'd1', kind: 'decision'})], active_locks: [{name: 'LOCK.txt', scope: 'all', type: 'lock', status: 'active'}],
    lock_count: 1, policies: [entry()], policies_availability: 'available', policies_reason: null,
    policy_source: 'policy-registry', enforcement_verified: false});
  assert.equal(model.lockCount, 1);
  assert.equal(model.decisions[0].id, 'd1');
  assert.equal(model.enforcementVerified, false);
});

test('status: a missing list is unknown (null), an empty list is a real answer (unified_api.py:1054-1063)', () => {
  const base = {status: 'observed', timestamp: '2026-10-10T12:00:00+00:00', source: 'lock_scan_cache', availability: 'available',
    scanned_at: null, error: null, active_locks: [], lock_count: 0, policy_source: 'policy-registry', enforcement_verified: false};
  const missing = parseStatus(base);
  assert.equal(missing.decisions, null);
  assert.equal(missing.policies, null);
  const empty = parseStatus({...base, recent_decisions: [], policies: []});
  assert.deepEqual(empty.decisions, []);
  assert.deepEqual(empty.policies, []);
  assert.throws(() => parseStatus({...base, active_locks: undefined}), /status/);
});

test('arrow-key tab movement wraps and ignores other keys', () => {
  assert.equal(nextTabIndex('ArrowRight', 5, 6), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 6), 5);
  assert.equal(nextTabIndex('Home', 3, 6), 0);
  assert.equal(nextTabIndex('End', 3, 6), 5);
  assert.equal(nextTabIndex('a', 3, 6), null);
  assert.equal(nextTabIndex('ArrowRight', -1, 6), null);
});

test('registry: pointer fields incl. missing ones become null, never invented (policy_registry_adapter.py:54-67)', () => {
  const model = parseRegistry(registry([entry({valid_from: undefined, supersedes: undefined})]));
  const row = model.rows[0];
  assert.equal(row.validFrom, null);
  assert.equal(row.supersedes, null);
  assert.equal(row.sourceVerified, true);
  assert.equal(row.enforcementVerified, false);
  assert.equal(model.version, '0.2.4');
  assert.equal(model.schema, 'bach.policy-registry.v1');
  assert.equal(model.readOnly, true);
  assert.equal(model.enforcementVerified, false);
});

test('consumers are never in the handler projection, so the gap is reported (#2026; adapter pointer() allowlist :54-55)', () => {
  assert.equal(parseRegistry(registry()).consumersProjected, false);
  assert.equal(parseRegistry(registry([])).consumersProjected, false);
});

test('writer notice reflects decision_writer.available=false and its reason (policy_registry_adapter.py:95-96)', () => {
  const text = writerNotice(parseRegistry(registry()));
  assert.match(text, /Writer nicht angebunden/);
  assert.match(text, /separate_explicit_adoption_required/);
  assert.match(writerNotice(parseRegistry(registry([entry()], {decision_writer: undefined}))), /unbekannt/);
});

test('decisions and policies use the handler selection lists (unified_api.py:1113-1128)', () => {
  const all = [entry({id: 'p', kind: 'policy'}), entry({id: 'd', kind: 'decision'})];
  // /decisions calls read_registry(kind="decision"): entries is already filtered (unified_api.py:1117).
  const decisions = parseDecisions({...registry([all[1]]), decisions: [all[1]]});
  assert.deepEqual(decisions.rows.map(r => r.id), ['d']);
  assert.deepEqual(decisions.rows.map(r => r.kind), ['decision']);
  // /policies rewrites "count" to the filtered length and adds name/desc/enforcement.
  const policies = parsePolicies({...registry(all), policies: [{...all[0], name: 'Synthetic policy', desc: 'x', enforcement: 'unverified'}], count: 1});
  assert.deepEqual(policies.rows.map(r => r.id), ['p']);
  assert.equal(policies.count, 1);
  assert.throws(() => parsePolicies(registry(all)), /policies/);
});

test('effective: selected is a single resolution and is kept apart from entries (adapter :98-108)', () => {
  const body = registry([entry({id: 'a'}), entry({id: 'b'})], {effective: {status: 'resolved', reason: 'highest_precedence',
    selected: entry({id: 'a'}), candidate_ids: ['a', 'b'], interaction_mode: 'ask', interaction_source: 'global',
    governance_binding: null, external_effect_gates: null}});
  const model = parseEffective(body);
  assert.equal(model.effective.selected.id, 'a');
  assert.deepEqual(model.effective.candidateIds, ['a', 'b']);
  assert.equal(model.rows.length, 2);
  assert.equal(model.effective.governanceBinding, null);
  const none = parseEffective(registry([], {effective: {status: 'none', reason: 'no_match', selected: null, candidate_ids: []}}));
  assert.equal(none.effective.selected, null);
  assert.equal(viewState(none), 'empty');
  assert.throws(() => parseEffective(registry()), /effective/);
});

test('effective: absent selected / candidate_ids is a contract error, null and [] are real answers (adapter :98-108)', () => {
  const eff = {status: 'none', reason: 'no_match', selected: null, candidate_ids: []};
  assert.equal(parseEffective(registry([], {effective: eff})).effective.selected, null);
  assert.deepEqual(parseEffective(registry([], {effective: eff})).effective.candidateIds, []);
  const {selected, ...noSelected} = eff;
  assert.throws(() => parseEffective(registry([], {effective: noSelected})), /selected/);
  const {candidate_ids, ...noCandidates} = eff;
  assert.throws(() => parseEffective(registry([], {effective: noCandidates})), /candidate_ids/);
  assert.throws(() => parseEffective(registry([], {effective: {...eff, selected: 'x'}})), /selected/);
  assert.throws(() => parseEffective(registry([], {effective: {...eff, candidate_ids: 'a'}})), /candidate_ids/);
  assert.equal(parseEffective(registry([], {effective: eff})).sourceVerificationComplete, false);
});

test('contract violations throw instead of showing partial data', () => {
  assert.throws(() => parseRegistry({}), /Governance-Vertrag/);
  assert.throws(() => parseRegistry(registry([{kind: 'policy'}])), /ohne id/);
  assert.throws(() => parseLocks({availability: 'available'}), /locks/);
  assert.throws(() => parseLocks({availability: 'available', locks: [{scope: 'x'}]}), /name/);
});

test('failures: 401, 404, 409, 503 and network errors are distinguishable (governance_registry.py:9-15; auth gate)', () => {
  assert.equal(describeFailure(401, {error: 'Geräteanmeldung erforderlich'}).state, 'auth');
  assert.equal(describeFailure(403, null).state, 'auth');
  assert.equal(describeFailure(404, null).state, 'route');
  assert.equal(describeFailure(409, {detail: 'policy_registry_changed_during_read'}).state, 'changed');
  const unavailable = describeFailure(503, {detail: 'policy_provider_not_configured'});
  assert.equal(unavailable.state, 'unavailable');
  assert.equal(unavailable.detail, 'policy_provider_not_configured');
  assert.equal(describeFailure(0, null).state, 'network');
  assert.equal(describeFailure(500, null).state, 'error');
});

test('age labels never invent a time', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  assert.equal(ageLabel(null, now), 'unbekannt');
  assert.equal(ageLabel('garbage', now), 'unbekannt');
  assert.equal(ageLabel('2026-10-10T11:50:00Z', now), 'vor 10 Min.');
  assert.equal(ageLabel('2026-10-10T09:00:00Z', now), 'vor 3 Std.');
  assert.match(ageLabel('2026-10-10T13:00:00Z', now), /Zukunft/);
  assert.equal(ageLabel('2026-10-10T12:00:30Z', now), 'Zeitstempel in der Zukunft');
  assert.equal(ageLabel('2026-10-10T12:00:01Z', now), 'Zeitstempel in der Zukunft');
  assert.equal(ageLabel('2026-10-10T12:00:00Z', now), 'vor weniger als 1 Min.');
});

test('the governance page wires tabs, keeps the old view and offers no approval control', () => {
  const page = readFileSync(new URL('../src/pages/governance/index.astro', import.meta.url), 'utf8');
  assert.match(page, /role="tablist"/);
  for (const tab of ['status', 'locks', 'decisions', 'policies', 'registry', 'effective'])
    assert.match(page, new RegExp('href="/governance\\?tab=' + tab + '"'));
  assert.match(page, /governance-readers\.mjs/);
  assert.match(page, /\/api\/governance\/status/);
  assert.match(page, /parseStatus/);
  assert.doesNotMatch(page, /loadGovernanceStatus/);
  assert.match(page, /nextTabIndex/);
  assert.doesNotMatch(page, /method:\s*['"](POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(page, /Freigeben|Approve/i);
  const nav = JSON.parse(readFileSync(new URL('../src/config/nav_config.json', import.meta.url), 'utf8'));
  assert.ok(JSON.stringify(nav).includes('/governance?tab=locks'));
});
