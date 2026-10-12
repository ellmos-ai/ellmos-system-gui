# Release gate: ellmos-system-gui

**Current candidate: 0.2.21. This source preparation updates the version metadata for the already reviewed shared GUI changes; it does not claim publication, consumer pinning, browser acceptance, or native installation.**

## Current candidate scope and checks (2026-10-12)

- Source base: `0843531b32fe37bb4f7335a78bf2f3c73998833e`, after the reviewed Task-Result UI merge. The candidate includes the previously merged data-age display, read-only/refresh safeguards, and task-result history and correction UI.
- Task-result corrections require the dedicated operator capability and current result/task bindings. Ambiguous acknowledgements require an explicit reopen before another correction can be sent. `result_max_chars` is sent only when the backend advertises the strict capability; unsupported legacy backends keep their existing behavior.
- The optional Ocean source timestamp is presented as source metadata, not as proof of live truth. Missing Ocean source data preserves the established BACH display. Read-only or invalid source states do not enable mutation controls; absent source support preserves legacy behavior.
- Source checks: `npm ci` exited 0; `npm test` passed 412/412 with no skips; `npm run build` exited 0 and built 26 pages. These are source checks, not a released artifact.
- `npm audit --json` reported two low-severity advisories (Mermaid and transitive KaTeX). Its suggested fix is Mermaid 10.8.0, a downgrade from the pinned 11.17.2; no dependency change is included in this version-metadata preparation. Resolve that dependency decision before publication.
- Release procedure: commit the reviewed source, require a clean checkout including untracked files, run `npm run build:release`, package with `scripts/package_release.py`, and independently verify source commit, file hashes, archive hash, and the MIT license.
- Consumer pins, protected API behavior, browser/CSP acceptance, and installed/native readback remain separate. This candidate does not claim those gates.

## Historical remediation record (2026-10-03)

The following checklist and execution notes describe their dated earlier releases, not the current candidate.

The initial GitHub repository was created publicly on 2026-10-03 before this ecosystem final gate was applied. The first gated versioned release, v0.1.1, was subsequently published. This file records the remedial gate review; it does not claim retroactive pre-publication approval.

## Checklist

| Check | Status |
|---|---|
| `.gitignore` minimum entries | PASS |
| English README | PASS |
| MIT license in repository and ZIP | PASS; archive bytes reviewed independently |
| No tracked database or environment files | PASS |
| No embedded secrets, personal paths, or internal documents | PASS |
| TODO status table | Present |

## Gate execution

On 2026-10-03, the copied `.AI/.MODULES/_scripts/final_gate_check.py` returned exit code 0 with 10 PASS, 0 FAIL, and 0 WARN. The packager's stale-build rejection returned exit code 1 as expected; the corrected ZIP contained the MIT license and passed an independent read-only source/archive review. v0.1.2 and v0.1.3 were published after fresh gates, builds, and independent archive reviews. At that time, the planned v0.1.4 governance and settings release still required a fresh final gate, build, archive hash review, and consumer pin update before tagging. A source commit by itself establishes neither a released artifact nor a working Ocean backend adapter. This dated record does not erase the earlier pre-gate public repository creation.
