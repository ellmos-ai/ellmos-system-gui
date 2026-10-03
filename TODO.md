# Release and integration tasks

Audit date: 2026-10-03. Repository: `ellmos-ai/ellmos-system-gui`.

## Status

| Category | Status | Notes |
|---|---|---|
| Secrets | Reviewed | Tracked source, static build, and ZIP scanned; no embedded credential pattern found. |
| Private data and paths | Reviewed | No user home path or private host pattern in tracked source, build, or ZIP. |
| License | In progress | MIT text is tracked; corrected ZIP needs rebuild and readback. |
| Source provenance | Reviewed | `SOURCE_PROVENANCE.json` records the 22 reviewed BACH source file hashes. |
| Language | Intentional | German end-user labels serve the current BACH/Ocean audience; the README is in English. |
| Ocean adapters | Open | Implement and verify the corresponding REST handlers and capability metadata before claiming panel availability. |
| Consumers | Open | Pin source revision and archive hash in isolated BACH/Open-Ocean consumer changes, with independent review before Mac deployment. |
| Browser acceptance | Open | No browser/device acceptance or production provider execution is claimed for this package. |

## Next work

- Add an automated release job after the manual package and final gate are independently reviewed.
- Keep backend state, module availability, and activity badges driven by verified runtime evidence.
- Preserve the standalone Universal GUI in its own repository and package.
