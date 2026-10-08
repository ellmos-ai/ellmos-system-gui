# Productive BACH frontend import

## Pinned source and scope

Source: `ellmos-ai/bach`, public commit `8884fcd2277f5db89e1a267a81042b33358278b8`, `system/gui/web/src`, eight frontend test files and the public `system/gui/static/js/device-fetch.js` helper. Destination baseline: `ellmos-ai/ellmos-system-gui` commit `85dbe25fe665fb6d540f9a689773b5616b49bc60`.

The byte comparison identified 32 additional source files and 22 differing common files. Common files that only differed in newlines were initially retained; the final shared source normalizes text to LF with `.gitattributes` so the recorded hashes survive fresh Windows and Unix checkouts. `SOURCE_PROVENANCE.json` records all 63 reviewed import records: 54 source files, eight test files and the device-fetch helper. Every record includes the original source SHA-256, destination SHA-256 and an adaptation flag.

No backend module, chat template, database, host configuration, device key, generated release or private runtime receipt was copied. The shared package identity, runtime brand component, cluster component, license, release manifest generator and deterministic packager were retained. Astro was deliberately upgraded to pinned `7.3.7`, with `http-cache-semantics 4.3.0` and `sharp 0.35.5` in the lock, after the original lock reported four advisories including a critical Astro issue. See the [official Astro advisory](https://github.com/withastro/astro/security/advisories/GHSA-26w7-cxv4-gfx2). The updated dependency audit reports zero vulnerabilities.

## Intentional adaptations

- The device authentication helper is bundled as `public/device-fetch.js`; the layout loads `/device-fetch.js` from the same origin instead of depending on a consumer's `/static/js` tree. Existing explicit authorization wins. Cross-origin requests never receive the stored device credential.
- The neutral dashboard description is retained. Machine-specific display labels are generalized to the backend or local host.
- Idle/wakeup readiness remains `Nicht geprüft` without a matching backend observation.
- Worker inventory must match the existing `bach.workers.status.v1` adapter schema. Expired, failed, paused and unknown profiles do not count as ready; a missing model/provider does not enable start.
- Two system-slot tests that depended on the BACH-only chat template were excluded from the shared frontend suite; Running parsing and state tests remain. The factory redirect test uses a reserved synthetic example origin.
- Task create and edit use the canonical `/api/task-assignees` catalogue, only selectable enabled/assignable targets and exact binding fields with `assignment_configuration_version`. Unknown existing slots remain visible and unchanged; deleting a binding also requires catalogue CAS. The CAS is request metadata and is excluded from persisted-task readback comparisons. Blueprint declarations without instances remain disabled with a link to the editor. Conflicts require an explicit reload and new choice.
- Release preparation, manifest and packager require clean source including untracked files, and the source commit must stay identical from preflight through packaging. Ordinary development builds remain available with dirty source.
- Additional frontend tests cover credential origin boundaries, status honesty, all 20 pages and final imported file hashes.

## Separate uncommitted Running changes

A separate canonical checkout contains an uncommitted Running delta. That file was inspected without modification. Its worker creation form, role/model/turn/pause fields and start/pause/stop/delete/handoff controls overlap the productive BACH implementation imported here. The productive implementation also provides source-version checks, correlated run receipts and task-version-bound decomposition.

No additional working function unique to that delta was identified. The separate code's `type: dynamic` payload and success messages based only on HTTP acceptance were not merged into the validated worker/receipt flow. The original uncommitted delta remains available to its owner for reconciliation; this import does not discard or declare it accepted.

## Remaining acceptance gates

- Native agent/skill sequences remain a separate BACH runtime change. The imported MarbleRun page honestly disables execution without a dispatcher.
- The typed task selector requires the consumer's canonical Lead TaskDB adapter and browser acceptance. Legacy/manual assignee IDs continue through `/api/assignees`; no free-text agent slot is accepted by these two forms.
- Time/event triggers, service/workflow execution, complete legacy-board parity and every governance provider remain separate backend contracts.
- Ocean requires its own adapter and session-authentication readbacks. Capability declarations do not establish runtime execution.
- A fresh source commit, release build, source/archive hash review, consumer pin updates and browser/device acceptance are required before release or deployment.

No commit, publication or deployment is established by this working source import.
