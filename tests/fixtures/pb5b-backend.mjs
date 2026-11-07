// PB-5b (#3989): synthetic backend answers for the tile, status-pill and contrast browser tests and the before/after
// screenshots. It extends the PB-4 fixture with system agents, a worker in error state, backend-origin and compute data.
import {backend as abortBackend, WORKERS as ABORT_WORKERS} from './abort-visibility-backend.mjs';

const agent = (id, name, over = {}) => ({id, name, enabled: true, backend: 'ollama', model: 'qwen3.8:27b-mlx', avatar: '', symbol: '',
  runtime_verified: true, running: false, status: 'idle', slot_category: 'preconfigured_role_agent', role_id: 'assistant', ...over});

export const CORE_AGENTS = {
  schema: 'bach.core-system-agents.v1', configuration_version: 'a'.repeat(64),
  supported_backend_ids: ['ollama', 'openrouter', 'claude'], slot_presets: {assistant: {name: 'Assistent'}},
  optional_hardware_interface_slots: [{id: 'interface_homecontrol', name: 'SmartHome / HomeControl'}, {id: 'interface_robotics', name: 'ELLMOS Robotics'}],
  agents: [
    agent('buddha_chat', 'Buddha Chat', {slot_category: 'system_slot'}),
    agent('buddha_always_on', 'Buddha Always-On', {slot_category: 'system_slot', running: true, status: 'running', task_id: 3825, tool_round: 4, current_tool: 'read_file'}),
    agent('buddha_connector', 'Buddha Connector', {slot_category: 'system_slot', enabled: false, status: 'paused'}),
    agent('system-expert', 'Experte', {role_id: 'experte'}),
    agent('boss', 'Boss', {status: 'error', role_id: 'boss'}),
  ],
};

export const WORKERS = {
  ...ABORT_WORKERS,
  workers: [
    ...ABORT_WORKERS.workers,
    {id: 'worker-error', name: 'Fehlerhafter', backend: 'openrouter', model: 'deepseek/free', status: 'error', runtime_verified: true,
      running: false, worker_active: false},
    {id: 'worker-ready', name: 'Bereiter', backend: 'ollama-cloud', model: 'glm-5', status: 'idle', runtime_verified: true, running: false, worker_active: false},
    {id: 'worker-paused', name: 'Pausierter', backend: 'ollama', model: 'qwen', status: 'paused', runtime_verified: true, running: false, worker_active: false},
  ],
};

export const COCKPIT = {fackel: {capacity: {loaded_model_count: 1, used_gib: 27.2, loaded_models: ['qwen3.8:27b-mlx']}, priority: {value: 'ollama'},
  compute_turn: {active: true}}};

export function backend(requests, {compute = COCKPIT, origin = 'server'} = {}) {
  const inner = abortBackend(requests);
  return route => {
    const url = new URL(route.request().url());
    const json = body => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
    if (url.pathname === '/api/system/core-agents') { requests.push(url.pathname); return json(CORE_AGENTS); }
    if (url.pathname === '/api/system/workers') { requests.push(url.pathname); return json(WORKERS); }
    if (url.pathname === '/api/gui/backend-origin') {
      requests.push(url.pathname);
      return json({schema: 'ellmos-system-gui.backend-origin.v1', mode: origin, connection_verified: true, schema_verified: true,
        instance_verified: true, adapter_binding_verified: true, instance_label: 'Mac Studio', observed_at: '2026-11-07T08:00:00Z'});
    }
    if (url.pathname === '/api/system/cluster-cockpit') { requests.push(url.pathname); return json(compute); }
    return inner(route);
  };
}
