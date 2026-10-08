# Release and integration tasks

Historical release audit: 2026-10-03. Productive source import: 2026-10-08; release acceptance remains open. Repository: `ellmos-ai/ellmos-system-gui`.

## Status

| Category | Status | Notes |
|---|---|---|
| Secrets | Reviewed | Historical package reviewed; current source/build scan required. No new ZIP is established before clean-source release. |
| Private data and paths | Reviewed | Current source/build review; historical ZIP review does not establish a fresh archive. |
| License | Reviewed | MIT text is tracked and included in the ZIP; archive readback is part of packaging. |
| Source provenance | Reviewed | `SOURCE_PROVENANCE.json` preserves historical records and pins the 63 productive frontend import records with original and imported hashes. |
| Language | Intentional | German end-user labels serve the current BACH/Ocean audience; the README is in English. |
| Ocean adapters | Open | Implement and verify the corresponding REST handlers and capability metadata before claiming panel availability. |
| Consumers | Open | Pin source revision and archive hash in isolated BACH/Open-Ocean consumer changes, with independent review before Mac deployment. |
| Browser acceptance | Open | No browser/device acceptance or production provider execution is claimed for this package. |

## Next work

- Add an automated release job after the manual package and final gate are independently reviewed.
- Keep backend state, module availability, and activity badges driven by verified runtime evidence.
- Preserve the standalone Universal GUI in its own repository and package.

## Productive frontend import gates

- Review the 20-page import and its intentional status/authentication adaptations.
- Review the typed slot/blueprint task selector with the consumer Lead TaskDB adapter; native sequence execution remains a separate consumer runtime scope.
- Build verification does not establish an installed Ocean adapter or browser acceptance.
- Update source/archive consumer pins only after a fresh committed release and independent review.

- Final release scripts enforce clean source and a matching pre-build commit receipt.
