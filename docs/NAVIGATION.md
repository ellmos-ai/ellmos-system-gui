# Navigation (PB-5a, BACH #3989)

Eine gemeinsame Bereichsnavigation für alle Seiten eines Bereichs. Sie steht in `src/config/nav_config.json` unter `area_navs` (Agenten-Bibliothek, Betrieb, Governance), wird von `src/components/AreaNav.astro` gerendert und über `BachLayout` automatisch eingebaut: eine Seite braucht dafür nur ihren `currentPath`. Seiten bauen keine eigene Reiterleiste.

- **Zuordnung:** `areaForPath` (`src/lib/area-nav.mjs`) ordnet einen Pfad über die Einträge und die Präfixe `paths` genau einem Bereich zu. Ein Eintrag führt nie in einen anderen Bereich.
- **Aktiv-Markierung:** `resolveActiveItem` wählt genau einen Eintrag nach Pfad und Query, nicht nur nach der exakten URL. Die Seitenleiste nutzt `resolveSidebarActive`; eine Seite ohne eigenen Seitenleisteneintrag markiert den Heimeintrag ihres Bereichs.
- **Rückweg:** Ein Link in einen anderen Bereich hängt `?from=<bereichs-id>` an. Die Zielseite zeigt dann „← zurück zu <Bereich>“ (nur bekannte Bereiche aus `area_navs`).
- **Weiterleitungen:** `redirects` in der Konfiguration (`/agenten/fabrika`, `/agenten/bibliothek` → `/agenten/blueprints`); die Altlink-Parameter (`?load=`, `?blueprint=`, `?tab=teams`) bleiben über `src/lib/library-redirect.mjs` erhalten.
- **Governance:** jede Teilroute hat eigenen Inhalt und eine eigene Datenquelle (`data-source`): `/governance` (Kennzahlen), `/governance/regeln`, `/governance/sperren`, `/governance/hooks` (`GET /api/governance/hooks`), `/governance/rechte` (`GET /api/governance/permission-matrix`), `/governance/funk`, `/governance/logs`. Die alten Adressen `/governance?tab=…` leiten weiter.
- **Tests:** `npm test` prüft den Vertrag an den Quellen (`tests/area-navigation.test.mjs`); `npm run test:dist` prüft dasselbe an einem fertigen Build (`GUI_DIST=<dir>` oder `dist/`).
