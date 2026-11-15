# Stand der Überarbeitung (Tracking, Pose, Bodenkontakte)

Zuletzt aktualisiert: 15.11.2026. Neue Session: diese Datei zuerst lesen, dann `tests/BASELINE.md` und `tests/README.md`.

## Arbeitsweise (vom Nutzer festgelegt)

- Bestehende Oberfläche und Funktionen erhalten: Personenauswahl, Kontakt-Editor, Export, gespeicherte Läufe (v2).
- Die ausgewählte Person darf nie automatisch durch eine andere ersetzt werden. Lieber „Tracking verloren“ anzeigen.
- Bei Unsicherheit Warnung statt geratener Werte. Schätzungen nie als Messung beschriften.
- Jeden Schritt einzeln umsetzen, committen, auf `main` pushen und mit dem Testgerüst gegen die vorherige Version messen.
- Nach jedem Schritt kurz berichten (geändert, gemessen, offen) und **auf das Okay des Nutzers warten**.
- Antworten auf Deutsch, knapp und konkret.

## Fahrplan

| # | Schritt | Status |
| --- | --- | --- |
| 1 | Kalibrierungs-Bug in `runAnalysis()`, Testgerüst, Diagnose-Export v2, Basiswerte | **fertig** (Commits 2e26e15, 76c8051) |
| 2 | Landmarker trennen: Vollbild-Suche aller Personen und Ausschnitt-Verfeinerung der Zielperson (IMAGE-Modus) in getrennten Instanzen | **als Nächstes**, wartet auf Okay |
| 3 | Multi-Person-Tracker (ByteTrack-Logik): Track IDs, Kalman, Hungarian (Abstand, IoU, Pose, Farbe), Zustände aktiv/unsicher/verloren, Anzeige anderer Personen, verlorene Abschnitte rot, neu antippen | offen |
| 4 | Pose-Nachbearbeitung: Kalman mit Innovation-Gating, Fuß als starres Dreieck, Links/Rechts aus mehreren Hinweisen, Widersprüche markieren | offen |
| 5 | Bodenkontakte: Zustandsmaschine mit Hysterese, Schwellen in m und m/s, Unsicherheit in ms, erst parallel zur alten Erkennung; ergänzte Kontakte nicht in Mittelwerte; `autoTune` schlägt Bildrate nur vor | offen |
| 6 | Kennwerte: Vertikalkraft aus Schrittdauer/Kontaktzeit und Feder-Masse-Modell als Schätzung beschriftet; Tempo/Schrittlänge ohne Kalibrierung als Schätzung | offen |
| 7 | Modell-Schnittstelle, Vergleich MediaPipe Full / Heavy / RTMPose Halpe26 | offen |

Ausführliche Begründung: Bericht „Sprint-Analyse – Phase 1: Bestandsaufnahme & Konzept“ (Claude-Artefakt des Nutzers, Link beim Nutzer).

## Wichtige Erkenntnisse aus Schritt 1

- **Problemvideo IMG_6246** (hochkant 1080×1920, 60 fps, Schwenk, zwei Läufer mit schwarzen Shirts, dahinter eine Frau): Für Läufer A liegt die App nur in 44 % der Bilder auf der richtigen Person (10 Identitätswechsel), für Läufer B in 4 % (ab 3,8 s verloren). Details in `tests/BASELINE.md`.
- **MediaPipe findet im Vollbild dieses Hochkantvideos bis 2,5 s keine Person und danach immer nur eine**, obwohl zwei bis drei zu sehen sind. Für Schritt 2/3 deshalb Personensuche in Kacheln (überlappende Ausschnitte) oder einen anderen Detektor (z. B. RTMDet) einplanen.
- Eine automatische Identitäts-Referenz über die Hosenfarbe ist unbrauchbar (misst bei Unschärfe Haut, hielt die Frau für Läufer B). Referenz deshalb über von Hand markierte Hüftpositionen (`tests/data/IMG_6246.ref.json`, alle 0,25 s).
- Die gerundeten Punkte im alten Diagnose-Export verschoben einzelne Kontakte. Export v2 speichert die Zielpose in voller Genauigkeit; `tests/run-analysis.mjs` rechnet damit exakt dieselben Kontakte wie die App.
- Testlauf im Headless-Chrome auf CPU dauert 12–17 Minuten pro Video (auf dem Gerät des Nutzers mit Grafikkarte deutlich schneller). Das Video selbst liegt nicht im Repo; es muss als H.264 vorliegen (siehe `tests/README.md`).

## Offene Fragen an den Nutzer

- [ ] Welcher Läufer im Video IMG_6246 ist er, A (schwarze Hose) oder B (graue Hose)?
- [ ] Weitere Testvideos: 5–8 mit mehreren Läufern (kreuzen, überdecken, ähnliche Kleidung), 5–10 für Bodenkontakte (möglichst 120/240 fps, zusammen ≥ 100 Kontakte), 1–2 Stativ mit zwei Markierungen bekannten Abstands.
- [ ] Bodenkontakt-Referenz: Claude markiert die Kontakte Bild für Bild selbst; der Nutzer markiert zur Kontrolle bei einem Video etwa 10 Kontakte unabhängig. Noch nicht begonnen.
- [ ] Öffentliche Datensätze zusätzlich ins Testgerüst einbauen? VideoRun2D (Sprint-Pose, von Hand markiert), SportsMOT (Tracking mit ähnlicher Kleidung). Noch nicht entschieden.
- [ ] Okay für Schritt 2.

Hinweis des Nutzers vom 15.11.: Er hat das Video nach Schritt 1 erneut analysiert, das Tracking war genauso schlecht. Das ist erwartet, Schritt 1 hat am Tracking nichts geändert.
