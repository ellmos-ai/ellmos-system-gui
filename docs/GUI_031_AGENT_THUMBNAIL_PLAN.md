# Agentenbilder: Thumbnail- und Lazy-Load-Plan

**Task:** 2054
**Status:** Analyse und Planung; keine Bildänderungen, Tests oder Deploys
**Session:** 01a14d8e-398f-7f03-ae14-078b080946bd | `codex@ASUS-GEI` | 2026-10-18
**Geprüfter Quellstand:** `origin/main` bei `4bc28c7bb3d179395403c6625edc6057071b66d6`

## Ergebnis

Der Bildauswahlpfad lädt die 45 neuen PNG-Varianten als inline Data-URIs und baut beim Öffnen des Pickers alle 70 auswählbaren Presets sofort in das DOM ein. Die 19 älteren Gemini-JPEGs werden zwar als separate URLs referenziert, aber auch sie werden beim Aufbau des Pickers unmittelbar als Avatar-Elemente verwendet. Eine Thumbnail-Schicht, eine begrenzte sichtbare Auswahl und ein verzögertes Nachladen beim Öffnen oder Scrollen sind im geprüften Stand nicht vorhanden.

Die Analyse belegt die Quellmechanik und die Dateigrößen. Sie belegt weder die tatsächliche Netzübertragung im Browser noch den Renderer-RAM-Verbrauch. Aussagen über eine konkrete Speicher- oder Laufzeitersparnis benötigen die Messungen aus dem Abschnitt [Messprotokoll](#messprotokoll).

## Bestand

| Bildgruppe | Auswahl | Importmechanik | Dateien | Gemessene Dateigröße |
|---|---:|---|---:|---:|
| Atlas-Sprite | 6 | eine Sprite-Datei, CSS-Hintergrundbild | 1 | 2.285.291 Bytes |
| ältere Gemini-Porträts | 19 | `?url&no-inline`, separate URL-Referenzen | 19 | 9.125.403 Bytes |
| neue portable Serien | 45 | `?url&inline`, Data-URIs | 45 | 3.429.431 Bytes |
| **Avatar-Katalog gesamt** | **70** | **drei Quellen** | **65 Dateien** | **14.840.125 Bytes** |

Die 65 Dateien ergeben sich daraus, dass der Atlas sechs Presets aus einer Sprite-Datei bedient. Unter `src/assets` liegen zusätzlich Workshop-Materialien; die dort ermittelte Gesamtmenge von 66 Bilddateien und 15.608.276 Bytes ist deshalb nicht identisch mit dem Avatar-Katalog.

Stichproben der Bildabmessungen bestätigen den erwarteten Ausgangspunkt: Der Atlas ist 1536 × 1024 Pixel groß, die älteren Gemini-Porträts sind 1024 × 1024 Pixel groß und die neuen PNGs sind 256 × 256 Pixel groß. Eine vollständige Dimensionsliste ist für diese Planungsaufgabe nicht erforderlich und wurde nicht als Release-Messung ausgegeben.

## Aktuelle Implementierung

- `src/lib/agent-avatar.mjs` definiert 6 Atlas-, 19 Gemini- und 45 portable Presets, insgesamt 70 Optionen.
- `src/lib/new-agent-avatar-assets.mjs` importiert alle 45 PNGs mit `?url&inline`.
- `src/lib/gemini-avatar-assets.mjs` importiert alle 19 älteren JPEGs mit `?url&no-inline`.
- `src/lib/agent-avatar-browser.mjs` importiert beide Asset-Listen statisch und setzt sie beim Laden über `setAvatarPresetImages` und `setAvatarPresetUrls`.
- `createAvatar` verwendet für Asset-Presets ein CSS-`backgroundImage`; Uploads verwenden weiterhin ein `<img>` mit Data-URI.
- `mountAvatarPicker` erzeugt beim Rendern für jedes Preset sofort einen Button und ein Avatar-Element. Es gibt dort keine Pagination, Virtualisierung oder Sichtbarkeitsgrenze.
- Der Browser-Adapter wird in `src/pages/agenten/blueprints.astro` und `src/pages/agenten/running.astro` verwendet. Die Blueprint- und Running-Editoren öffnen ihre Picker erst im jeweiligen Editorfluss, aber der aktuelle Picker rendert dann alle Presets auf einmal.
- Der bestehende Data-URI-Vertrag begrenzt Bilder auf 240.000 Zeichen und verlangt eindeutige Bilder. Vorhandene Preset-IDs, Uploads und Data-URI-Importe dürfen durch eine spätere Thumbnail-Schicht nicht ungültig werden.

## Geplante Folgearbeiten

### 1. Versionierten Asset-Katalog einführen

Eine gemeinsame Katalogstruktur soll pro Preset die stabile ID, die Originalquelle, eine kleine Thumbnail-URL und bei Bedarf größere Varianten beschreiben. Die URLs müssen versioniert und cachebar sein. Bestehende IDs und gespeicherte Upload- beziehungsweise Data-URI-Werte bleiben lesbar. Der Katalog soll für BACH und Ocean dieselbe Zuordnung verwenden, damit Branding und Oberfläche getrennt bleiben, während die Asset-Verträge identisch sind.

Vor der Umsetzung sind die Bildmetadaten zu prüfen: EXIF-, XMP- und IPTC-Felder sowie PNG-Textblöcke dürfen keine privaten Herkunftsdaten in ausgelieferte Varianten übertragen. Herkunft und Lizenznachweis gehören in den Katalog oder seine Referenzdokumentation.

### 2. Auswahl erst bei tatsächlicher Nutzung laden

Die Initialisierung der Agenten-Seite soll den kompletten Bildkatalog nicht mehr als inline Daten in den Routen-JavaScript-Bundle ziehen. Der Picker lädt seine Katalogdaten und Thumbnails erst, wenn der Editor geöffnet oder der Picker sichtbar gemacht wird. Während des Nachladens braucht die Oberfläche einen erkennbaren Ladezustand; bei einem Fehler bleibt die bisherige Auswahl und der Atlas-Fallback verständlich verfügbar.

### 3. Sichtbare Menge begrenzen

Die Auswahl soll mit kleinen Varianten starten und nur sichtbare oder kurz bevorstehende Elemente laden. Für `<img>`-Varianten sind `srcset`, `sizes`, `loading="lazy"` und `decoding="async"` zu prüfen. Falls die CSS-Hintergrunddarstellung beibehalten wird, braucht sie eine gleichwertige Sichtbarkeitssteuerung, zum Beispiel über einen IntersectionObserver. Eine begrenzte Rasteransicht, Pagination oder Virtualisierung verhindert, dass alle 70 Elemente beim ersten Öffnen erzeugt werden.

### 4. Vertrag und Rückwärtskompatibilität absichern

Die Auflösung muss zuerst stabile Preset-IDs und danach die passende Thumbnail- oder Vollbildvariante verwenden. Uploads und vorhandene Data-URIs bleiben ein eigener Pfad. Der Atlas bleibt als robuste lokale Fallback-Quelle erhalten. Ein fehlendes Thumbnail darf weder den gespeicherten Agenten noch den Editor unbrauchbar machen.

## Messprotokoll

Die Implementierung darf erst mit Messdaten bewertet werden. Für jede Variante sind mindestens folgende Zustände zu erfassen:

1. Route kalt laden, ohne den Avatar-Picker zu öffnen: JavaScript-Bytes, Bild-Requests und Zeitpunkt des ersten Bild-Requests.
2. Route warm laden und anschließend den Picker öffnen: Katalog- und Thumbnail-Requests, Anzahl der erzeugten DOM-Elemente und Zeit bis zur nutzbaren Auswahl.
3. In kleinen und großen Rasteransichten scrollen: zusätzliche Requests, maximal gleichzeitig sichtbare Bilder und Verhalten beim Zurückscrollen.
4. Browser-Renderer-RAM beziehungsweise die verfügbare Speicheranzeige des gewählten Testwerkzeugs vor dem Öffnen, nach dem Öffnen und nach dem Scrollen erfassen. Ohne diese Messung keine RAM-Einsparung behaupten.
5. Mit 1x- und 2x-DPR sowie mit kaltem und warmem Cache wiederholen.
6. Bestehende Preset-IDs, Uploads und Data-URIs laden und speichern; danach prüfen, dass die Auflösung unverändert bleibt.
7. Für BACH- und Ocean-Adapter denselben Katalog und dieselben Fallback-Regeln prüfen.

## Abnahmekriterien für die Umsetzung

- Beim Laden einer Agentenroute werden keine 45 neuen PNGs als inline Data-URIs in den initialen Avatar-Browserpfad gezogen.
- Der Picker erzeugt beim ersten Öffnen nur die begrenzte sichtbare Auswahl und lädt weitere Varianten bedarfsgesteuert.
- Kleine Varianten werden für Rasteransichten verwendet; größere Varianten werden erst für die geeignete Detailansicht angefordert.
- Bestehende Preset-IDs, Uploads, Data-URIs und der Atlas-Fallback funktionieren weiter.
- Katalog-URLs sind versioniert, cachebar und frei von privaten Bildmetadaten.
- Die Messung deckt Kaltstart, Warmstart, Öffnen, Scrollen, 1x-DPR und 2x-DPR ab.
- BACH und Ocean verwenden denselben Asset-Vertrag.

## Nicht Bestandteil von Task 2054

Task 2054 ändert keine Bilddateien und keine Runtime-Implementierung. Es werden keine Tests, Builds, Deployments oder Provider-Starts ausgeführt. Eine konkrete Verbesserung von Übertragungsgröße, RAM oder Startzeit wird erst nach der beschriebenen Implementierung und Messung behauptet.
