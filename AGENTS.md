# Arbeitsregeln

- Diese Repository-Quelle ist die gemeinsame Astro-Oberfläche für BACH und Ocean. Änderungen an einem Konsumenten gehören in dessen eigenes Repository.
- Vor einer Veröffentlichung Quell- und Build-Artefakte auf Zugangsdaten, feste private Hostnamen und scheinbare Live-Zustände prüfen.
- Keine BACH-/Ocean-Datenbank, lokalen Zugangsdaten oder Mac-Checkout-Dateien in dieses Repository kopieren.
- Fehlende Backend-Adapter als nicht verfügbar kennzeichnen. Aus statischen Beispielen keinen aktiven Laufstatus ableiten.
- Vor einem Release `npm ci`, `npm run build:release` und die Dist-Dateihashes prüfen. Release-Archive der Konsumenten werden an einen Commit und einen SHA-256-Wert gebunden.
