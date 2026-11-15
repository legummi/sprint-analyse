# Tests

Ziel: Jede Änderung an Tracking, Pose-Verarbeitung und Kontakterkennung wird an echten Videos gegen eine Referenz gemessen und mit der vorherigen Version verglichen.

## Ablauf

1. **Video vorbereiten** (Chrome unter Linux spielt kein HEVC):
   `ffmpeg -i IMG.mov -an -c:v libx264 -crf 16 -pix_fmt yuv420p -r 60 IMG.mp4`
2. **Echte App-Pipeline laufen lassen** (Headless-Chrome, gleicher Code wie im Browser):
   `python3 tests/browser/run_app.py IMG.mp4 --fps 60 --tap 3.5 0.60 0.55 --out tests/data/NAME.diag.json`
   `--tap T X Y` = Person antippen bei Zeit T (s) an Stelle X, Y (0…1). Ergebnis ist der Diagnose-Export v2.
   Denselben Export bekommt man in der App über den Knopf „Diagnose“.
3. **Identitäts-Referenz**: In `tests/data/VIDEO.ref.json` unter `persons` die Hüftmitte jeder Person alle 0,25 s von Hand eintragen (x, y normiert). Das Testskript ordnet die verfolgte Pose in jedem Bild der nächstgelegenen Person zu; liegen zwei Personen fast gleich nah, zählt das Bild als „?“. Die Referenz hängt nicht vom Tracker ab und gilt für jede neue Version.
   Eine automatische Zuordnung über die Hosenfarbe wurde ausprobiert und verworfen: Bei Unschärfe misst sie Haut statt Hose und hielt eine Frau für Läufer B.
4. **Auswerten**: `node tests/run-analysis.mjs tests/data/NAME.diag.json tests/data/VIDEO.ref.json --target A`

Die Videos selbst liegen nicht im Repo (Größe, Privatsphäre). Die Exporte in `tests/data/*.diag.json` reichen, um die Auswertung ohne Video nachzurechnen.

## Referenzdatei (`*.ref.json`)

```json
{
  "video": "IMG_6246",
  "target": "A",
  "persons": { "A": [[0.25, 0.59, 0.545], [0.5, 0.59, 0.546], [null], …], "B": [ … ] },
  "contacts": [ { "side": "L", "td": 1.234, "to": 1.345 } ]
}
```

- `persons`: je Person Liste aus `[Zeit in s ab Videobeginn, x, y]`, `[null]` = Person nicht im Bild. Die Zielperson wählt man beim Aufruf mit `--target A`.
- `contacts`: manuell bestimmte Bodenkontakte der Zielperson, Zeiten in s ab Ausschnittbeginn (Aufsetzen `td`, Abdruck `to`).

## Messgrößen

| Bereich | Größe |
| --- | --- |
| Tracking | Identitätswechsel, Bilder mit falscher Person, Bilder ohne Pose, längster Ausfall (ms) |
| Pose | Anteil Sprünge > 5 cm/Bild (Beine 15 cm) relativ zur Hüfte, fehlende Punkte je Gelenk |
| Kontakte | gefunden / verpasst / zusätzlich, Abweichung Aufsetzen, Abdruck, Kontaktzeit in ms |
