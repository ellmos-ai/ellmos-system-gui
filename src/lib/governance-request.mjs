// SPDX-License-Identifier: MIT
// One in-flight read generation, no cached snapshots and no mutation/retry path.
import {classifyBody, describeFailure, BODY_PROBLEM, viewState} from './governance-readers.mjs';
const PATHS = new Set(['/api/governance/locks', '/api/governance/decisions',
  '/api/governance/policies', '/api/governance/policy-registry', '/api/governance/effective-policy', '/api/gui/capabilities']);
export function createGovernanceRequest(onState) {
  let generation = 0, active = null;
  const publish = value => onState({model:null, payload:null, failure:null, ...value});
  return {
    cancel() {
      generation += 1;
      active?.abort(); active = null;
      publish({state:'idle'});
    },
    async load(url, parse, fetcher, classify = viewState) {
      const current = ++generation;
      active?.abort(); active = new AbortController();
      publish({state:'loading'});
      let path;
      try {
        if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) throw new Error();
        path = new URL(url, 'https://governance.invalid');
        if (path.origin !== 'https://governance.invalid' || !PATHS.has(path.pathname) || path.hash) throw new Error();
      } catch {
        publish({state:'contract', label:'Kein zulässiger Governance-Leseendpunkt.'});
        return;
      }
      let response, raw;
      try {
        response = await fetcher(url, {method:'GET', cache:'no-store', signal:active.signal});
        if (current !== generation) return;
        raw = await response.text();
      } catch {
        if (current !== generation) return;
        publish({state:'network', failure:describeFailure(0, null)});
        return;
      }
      if (current !== generation) return;
      const parsed = classifyBody(raw);
      if (!response.ok) {
        const failure = describeFailure(response.status, parsed.value);
        publish({state:failure.state, failure});
        return;
      }
      if (parsed.kind !== 'ok') {
        publish({state:'contract', label:BODY_PROBLEM[parsed.kind]});
        return;
      }
      let model;
      try { model = parse(parsed.value); } catch {
        publish({state:'contract', label:'Antwort passt nicht zum Governance-Vertrag.'});
        return;
      }
      if (current !== generation) return;
      publish({state:classify(model), model, payload:parsed.value});
    },
  };
}
