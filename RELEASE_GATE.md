# Release gate: ellmos-system-gui

**Current candidate: 0.2.20. Source tests and development build are verified; clean committed release build, archive review, publication and native consumer deployment remain separate pending gates.**

## Current candidate evidence (2026-10-12)

- Source base: shared main 2d1e059ef90aac23932e33266764a1dfa801028f, including the reviewed Subscription-Agents board and collapsed memory map.
- npm ci: exit 0. npm test: 371 passed, 0 failed, 0 skipped. Development build: exit 0, 26 pages. These are source checks, not a released artifact.
- Release procedure: commit the reviewed source, require a clean checkout including untracked files, run npm run build:release, package with scripts/package_release.py, and independently verify the source commit, file hashes, archive hash and MIT license. Publish only after these checks pass.
- Consumer pins and installation/readback are separate. The board needs compatible backend adapters; neither static installation nor a prompt preview proves BACH/Ocean readiness or starts an agent.

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
