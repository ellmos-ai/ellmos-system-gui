# Shell und Seitennavigation

## Aufbau

`BachLayout.astro` bleibt das gemeinsame BACH-/Ocean-Layout. Es übergibt den aktuellen Pfad und die Query an `Header.astro`; die Hauptfläche erhält außerdem das Ziel des Tastatur-Sprunglinks. Der bestehende Device-Fetch, die Brand-Abfrage und die Prüfung des Backend-Ursprungs bleiben an ihren bisherigen Stellen.

`Header.astro` rendert die Kopfzeile, Theme-Steuerung, Schnellzugriffe und die linke Navigation aus `nav_config.json`. Gruppierte Ziele stehen in nativen Disclosure-Elementen. Kein konfiguriertes Kindziel wird herausgefiltert. Der aktive Link muss denselben normalisierten Pfad und dieselbe Query-Auswahl haben; dadurch kollidieren Pfadpräfixe und benachbarte Filter nicht.

Auf schmalen Ansichten öffnet ein Schalter die Navigation als seitliches Panel. `aria-expanded`, `aria-hidden` und `inert` beschreiben den Zustand. Escape, der Hintergrund und eine Linkauswahl schließen das Panel; beim Schließen per Escape oder Hintergrund geht der Fokus zum Schalter zurück.

## Gestaltung und Zustand

Shell-Farben liegen in eigenen CSS-Variablen. Kopfzeile und Navigation behalten das dunkle Blau, während das gespeicherte Seiten-Theme über `bach-theme` unverändert weiterwirkt. Backend- und Gerätestatus werden weiterhin nur aus den vorhandenen Abfragen angezeigt.
