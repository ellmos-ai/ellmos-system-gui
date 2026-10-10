# ellmos System GUI

One shared Astro 7 frontend for **BACH and Ocean**. Both consumers use the same versioned static build and supply their own API adapters and validated runtime branding through `GET /api/gui/brand`.

The productive frontend at public BACH commit `8884fcd2277f5db89e1a267a81042b33358278b8` has been imported into the shared source, including its Blueprint editor, Living & Running controls, actual skill-source editor, five capability boards, portraits and Ticket-Master symbols. No BACH Git history, backend templates, database or device credentials were imported. [SOURCE_PROVENANCE.json](SOURCE_PROVENANCE.json) records both the pinned source hashes and final imported hashes. Shared branding and release scripts are retained. Intentional adaptations and the comparison with separate, uncommitted frontend work are described in [the import review](docs/BACH_FRONTEND_IMPORT_2026-10-08.md).

This repository owns the shared frontend after the import. Consumer transition copies must be replaced by a verified pinned release; they do not become separate frontend authorities. An HTML installation alone does not provide Ocean's missing backend adapters.

## Development and verification

Build prerequisites: Node `>=22.12.0` and npm `>=9.6.5`; the release packager and release tests also require Python 3.9 or newer. Astro is pinned to `7.3.7`; the lock includes `http-cache-semantics 4.3.0` and `sharp 0.35.5`. The previous Astro 5 lock reported security advisories. Text files use LF consistently so provenance hashes remain stable across Windows and Unix checkouts.

```sh
npm ci
node --test tests/*.test.mjs
npm run build
```

The frontend contains 22 HTML pages. Its tests exercise frontend rendering, source-version conflicts, receipt correlation, safe device authentication and source provenance using synthetic local fixtures. They do not claim browser, device or provider acceptance.

## Release

After the reviewed source has been committed, with a clean checkout including untracked files:

```sh
npm ci
npm run build:release
python scripts/package_release.py
```

`build:release` verifies the clean source before building and stores its exact commit in a preparation receipt. The manifest generator and packager require that same clean commit.

`dist/dist-manifest.json` records file SHA-256 hashes and the exact source commit. The packager refuses a stale build and produces a deterministic ZIP including the MIT license. Consumers must pin and verify both the source commit and ZIP hash. A development build from uncommitted changes is not a publishable release receipt.

`ellmos-module.v2.json` registers only `gui.static.distribution` and `gui.same-origin.client`. It owns no runtime state. Authentication, backend adapters, task authority and worker execution belong to the consumer; installing this static distribution does not make those capabilities available.

## Agent portraits

The shared portrait picker contains 55 choices: the six original atlas portraits,
19 existing Gemini portraits, ten image_gen comic portraits and ten additional
Gemini role portraits, plus ten colorful workshop robots. The new series use
256-pixel PNGs and the existing consumer
image-upload contract. A selected new picture is stored as bounded image data,
so consumers do not need new preset allowlists or a controller restart. The picker
recognizes the picture again after loading. Source and derivative hashes are in
[src/assets/agent-portraits-20261010/provenance.json](src/assets/agent-portraits-20261010/provenance.json).

## API and availability

Task detail can display canonical worker output and a separate operator acceptance
through `GET /api/tasks/{id}/result` and `POST /api/tasks/{id}/result/accept`.
Acceptance binds the result ID, digest, task version and status revision. A dedicated
operator credential is held only in sessionStorage and sent as
`X-BACH-Result-Operator` to the same origin, with redirects rejected. General device
credentials do not grant this permission. Missing consumer adapters are shown as
unavailable. Consumers provision the separate operator credential locally and
verify their own installed backend and GUI distribution before activation.

The creation controls, ready agents and ready teams share one visual group. Its
cards use white backgrounds with blue accents in light mode and normal text
colors for the creation subtitle. Ready sections remain collapsed initially.

Memory Facts use the native categories `user`, `project`, `system` and `domain`;
Lessons have separate free categories. A rejected save keeps the draft visible
and shows the consumer's error as text. Failed reads are not shown as empty tables.

BACH provides the reference REST adapters. Ocean must implement its own compatible handlers. The [consumer contract](docs/CONSUMER_CONTRACT.md) distinguishes configured adapter routes, runtime verification, installed modules and verified GUI artifacts. Missing adapters remain unavailable; a catalogue entry, saved profile or HTTP success alone cannot establish a running agent.

The bundled `device-fetch.js` forwards an existing device credential only to same-origin `/api/` requests. Provider-session cookies remain browser-managed. Task assignment uses `/api/task-assignees` (`bach.task-assignees.v1`) and explicit catalogue CAS. Existing unknown slots remain visible and unchanged until the user selects a new binding.

Chat, device registration and legacy boards remain consumer routes outside this static Astro source.

The separate **Universal GUI** is developed from `ellmos-unified-gui`; its Jinja/HTMX source is not included here.

German end-user labels intentionally use real umlauts. This technical README is in English.

License: MIT.
