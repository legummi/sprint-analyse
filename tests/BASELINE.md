# Basiswerte vor dem Umbau (Commit 4ef1f35, Stand nach Schritt 1)

Video IMG_6246: hochkant 1080×1920, 60 fps, 6,5 s, Kamera schwenkt mit. Zwei Läufer mit schwarzen Shirts (A schwarze Hose, B graue Hose), dahinter eine Frau (W). Angetippt jeweils bei 3,5 s. Echte App-Pipeline im Headless-Chrome (CPU), MediaPipe Full.

| Messgröße | Ziel A | Ziel B |
| --- | --- | --- |
| Bilder mit Pose | 383 von 389 | 115 von 389 |
| davon richtige Person | 171 (44 %) | 16 (4 %) |
| falsche Person | 151 Bilder | 61 Bilder |
| nicht entscheidbar (Überdeckung) | 61 | 38 |
| Identitätswechsel | 10 | 7 |
| längster Ausfall | 33 ms | 2583 ms |
| Fußspitze: Sprünge > 15 cm/Bild relativ zur Hüfte | 14,7 % | 25,3 % |
| Bodenkontakte erkannt | 2 | 7 (Kontaktzeit-Median 42 ms, unplausibel) |
| Laufzeit (CPU) | 702 s | 996 s |

Verlauf für Ziel A (je 0,1 s, `-` = keine Pose):
`???BBBBBBBBBBBBBBBBBB?WAAA????AAAAAWB-?BBB?BBBBAAAAAAAAAAAAAAAAAA`
Bis 2,0 s wird B verfolgt, kurz die Frau, ab 3,6 s wieder B, erst ab 4,7 s A.

Verlauf für Ziel B:
`-------------------B-?WAAA????AAAAABBW?--------------------------`
Nur am Antipp-Bild auf B, sonst A oder die Frau, ab 3,8 s verloren.

Weitere Befunde:
- MediaPipe findet im Vollbild (1080×1920) bis 2,5 s gar keine Person und danach immer nur eine, obwohl zwei bis drei zu sehen sind. Der Personendetektor ist für kleine Personen im Hochkantbild zu grob. Ein Vollbild-Tracker aller Personen (Schritt 3) braucht deshalb eine Suche in Kacheln oder einen anderen Detektor.
- Kontaktzeiten gegen manuelle Referenz sind noch nicht gemessen (Referenz fehlt).

Nachrechnen: `node tests/run-analysis.mjs tests/data/IMG_6246_A.base.diag.json tests/data/IMG_6246.ref.json --target A`
