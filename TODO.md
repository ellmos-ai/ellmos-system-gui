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

## TASKWRITER — 2026-11-01

- #508: erledigt, easy/local, Priorität medium — aktuelle Release-Orientierung abgleichen. Quelle: package.json 0.2.30, README bis 0.2.29, RELEASE_GATE aktueller Kandidat 0.2.25. Diese Versionen beweisen keine Veröffentlichung oder Abnahme.
- #509: offen, special/central, Priorität medium — getrennte Release-, Konsumenten- und sichtbare Abnahmegates freigeben. Vollständige Kriterien/Quellen/Blocker in TASKPLAN, keine Volltextduplikation.

Zwei neue Aufgaben, keine erledigt/zusammengeführt. Arbeitsbaum zuvor sauber und vollständiger Lockscan frei. AGENTS, TODO und Release-Gate gelesen; README und Paketmetadaten ausgewertet; sämtliche verlinkten Verbraucher-/Importbelege noch nicht vollständig geprüft, deshalb kein Projektsiegel. API/UTF-8/Diff zurückgelesen. Keine Tests, Builds, Veröffentlichungen, Deployments oder Änderungen der CCC-Pause.

## TASKSOLVER #508 — 2026-11-01

Aktuelle Orientierung in README und RELEASE_GATE ergänzt: Quelle 0.2.30/HEAD d248e503, lokales 0.2.30-Archiv/Commit 1306be35 und GitHub latest v0.2.28 sind getrennt belegt. Archivmanifest-Dateihashes und LICENSE-Bytes unabhängig geprüft; keine Gleichheit mit HEAD oder Verbraucherinstallation behauptet. Alte Current-candidate-Abschnitte historisch eingeordnet. #508 abgeschlossen; #509 special/central bleibt offen. JSON-/UTF-8-/Link-/Diff-Readback durchgeführt; kein Build/Test, keine Veröffentlichung, CCC-Pause unverändert.
