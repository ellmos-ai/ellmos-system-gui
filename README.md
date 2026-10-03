# ellmos System GUI

One shared Astro 5 frontend source for the **BACH/Ocean GUI**. BACH and Ocean consume the same versioned static build. Each consumer supplies its own API adapter and validated runtime brand configuration through `GET /api/gui/brand`.

The source was extracted from the sanitized public BACH commit `4b007a51776592ff2426511c585360b6ce58897f` plus reviewed GUI fixes `85f9b5edaf278c9899c5f59897108578afd6b8d3` and `0d5a1e39893a3f7180df3c450df46e7cbf2b774f`. The old BACH Git history was not imported. Every copied file is pinned in [SOURCE_PROVENANCE.json](SOURCE_PROVENANCE.json). The current frontend source is synchronized with reviewed public BACH commit `5f918a6602bbc6656f46a7e049105e1a2196225e`; this records source parity only. Ocean API adapters and a verified Ocean consumer install are still required.

## Build

```sh
npm ci
npm run build:release
python scripts/package_release.py
```

The build produces 16 HTML pages and related assets. `dist/dist-manifest.json` records their SHA-256 hashes and the exact source commit. The packager refuses a stale build and creates a deterministic ZIP with the MIT license. Consumers must pin both the source commit and release ZIP hash and verify them before installation.

## API and availability

BACH currently provides the reference adapter for existing REST routes. Ocean still lacks adapters for many of the 16 pages. Installing this HTML artifact alone does not make those panels functional. The [consumer contract](docs/CONSUMER_CONTRACT.md) specifies public metadata, runtime branding, and capability boundaries.

The separate **Universal GUI** is developed from the existing `ellmos-unified-gui` module. Its Jinja/HTMX source is not included here.

German end-user labels in the interface are intentional for the current BACH/Ocean deployments. They use real umlauts. This repository's technical README is in English for public use.

License: MIT.
