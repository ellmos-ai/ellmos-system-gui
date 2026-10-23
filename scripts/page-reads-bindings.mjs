// Call sites whose URL or method the code does not decide on its own (map lookups, variables, open-ended paths,
// methods held in variables). Each is bound by ID "file#function@n" (n = order among such sites of that function) to the
// explicit "METHOD path" alternatives it may produce. Every alternative needs a dynamic manifest entry whose found_in is
// "file#function". A new unresolved call site, a changed alternative or a stale binding fails scripts/page-reads-check.mjs.
export const BINDINGS = {
  // Runtime-whitelisted read-only transport shared by the Governance views.
  'src/lib/governance-request.mjs#createGovernanceRequest@1': [
    'GET /api/governance/locks', 'GET /api/governance/policy-registry', 'GET /api/governance/decisions',
    'GET /api/governance/policies', 'GET /api/governance/effective-policy', 'GET /api/gui/capabilities',
  ],
  // INVENTORIES[kind] in capability-board-client.mjs: one inventory per board
  'src/lib/capability-board-ui.mjs#refresh@1': [
    'GET /api/capabilities/skills/library', 'GET /api/capabilities/plugins/inventory', 'GET /api/capabilities/mcp/connections',
    'GET /api/capabilities/software', 'GET /api/capabilities/ocean',
  ],
  // reader.url(filters) in governance-readers.mjs: one URL per tab
  'src/pages/governance/index.astro#load@1': [
    'GET /api/governance/locks', 'GET /api/governance/policy-registry', 'GET /api/governance/decisions',
    'GET /api/governance/policies', 'GET /api/governance/effective-policy',
  ],
  // requests.map(([key, url, field]) => api(url)) in blueprint-studio.mjs
  'src/scripts/blueprint-studio.mjs#loadData@1': [
    'GET /api/agenten/teams', 'GET /api/capabilities/skills', 'GET /api/agent-studio/tools',
    'GET /api/agent-studio/contractus-presets', 'GET /api/agent-studio/governance-presets',
  ],
  // url built from new URL('/api/tasks', origin) in life.astro
  'src/pages/life.astro#loadUserTasks@1': ['GET /api/tasks'],
  // path and method are variables set per operation kind (socket PUT, bind PUT, unbind DELETE) in model-sockets.mjs
  'src/lib/model-sockets.mjs#saveSocketChange@1': [
    'PUT /api/system/model-sockets', 'PUT /api/system/model-sockets/bindings/{id}/{id2}', 'DELETE /api/system/model-sockets/bindings/{id}',
  ],
  // idPath(id) = BASE + '/' + id in daemon-chains.mjs: one operation per client method
  'src/lib/daemon-chains.mjs#createChainClient@1': ['PUT /api/daemon/chains/{id}'],
  'src/lib/daemon-chains.mjs#createChainClient@2': ['PUT /api/daemon/chains/{id}/toggle'],
  'src/lib/daemon-chains.mjs#createChainClient@3': ['DELETE /api/daemon/chains/{id}'],
  'src/lib/daemon-chains.mjs#createChainClient@4': ['POST /api/daemon/chains/{id}/run'],
  'src/lib/daemon-chains.mjs#createChainClient@5': ['GET /api/daemon/chains/{id}/runs'],
  // idPath(id) = BASE + '/' + id in prompt-library.mjs
  'src/lib/prompt-library.mjs#createPromptClient@1': ['GET /api/prompt-library/{id}'],
  'src/lib/prompt-library.mjs#createPromptClient@2': ['PUT /api/prompt-library/{id}'],
  'src/lib/prompt-library.mjs#createPromptClient@3': ['DELETE /api/prompt-library/{id}'],
};
