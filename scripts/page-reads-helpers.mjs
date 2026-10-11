// Fetch helpers the guard knows. A call of one of these is a call site of its own (URL and method are read from
// THAT call). Fields: url = argument index of the URL; options = index of the fetch options object;
// method = argument index of the HTTP method, or a fixed method; prefix = constant the helper puts in front of the URL;
// scope 'global' = callable from other files under the same name, otherwise only inside `file`.
// A fetch/fetcher call that forwards a parameter of a function missing here fails the guard.
export const HELPERS = [
  {file: 'src/lib/capability-board-client.mjs', name: 'requestJson', url: 0, options: 1, scope: 'global'},
  {file: 'src/pages/life.astro', name: 'lifeApiFetch', url: 0, options: 1},
  {file: 'src/pages/life.astro', name: 'changeRoutine', url: 0, method: 1},
  {file: 'src/pages/artefakte.astro', name: 'artifactFetch', url: 0, method: 'GET'},
  {file: 'src/lib/agent-history.mjs', name: 'read', url: 0, method: 'GET'},
  {file: 'src/lib/domain-pins.mjs', name: 'request', url: 0, options: 1},
  {file: 'src/lib/hierarchy-assignment.mjs', name: 'request', method: 0, url: 1},
  {file: 'src/lib/model-sockets.mjs', name: 'request', url: 0, options: 1, prefix: '/api/system/model-sockets'},
  {file: 'src/pages/governance/usecases.astro', name: 'request', url: 0, options: 1},
  {file: 'src/pages/agenten/running.astro', name: 'coreRequest', url: 0, method: 1, prefix: '/api/system/core-agents'},
  {file: 'src/scripts/agent-template-picker.mjs', name: 'api', url: 0, options: 1},
  {file: 'src/scripts/blueprint-studio.mjs', name: 'api', url: 0, options: 1},
  {file: 'src/scripts/blueprint-studio.mjs', name: 'post', url: 0, method: 'POST'},
  {file: 'src/scripts/marblerun-studio.mjs', name: 'api', url: 0, options: 1},
];

// Files whose fetch calls only forward the caller's arguments (they wrap the global fetch for every page).
export const PASSTHROUGH_FILES = ['public/device-fetch.js'];
