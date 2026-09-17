# Rezeptplaner — Projektspezifikation

Baue eine moderne, iPhone-optimierte Web-App "Rezeptplaner" für Bennet (Homelab-Server,
Docker-basiert). Ziel: Gerichte für die Woche wählen, direkt Kochrezept + Zutatenliste
pro Gericht sehen, und automatisch eine zusammengefasste Wocheneinkaufsliste generieren.

## Tech-Stack (verbindlich)
- Backend: Python 3.13, FastAPI, uvicorn
- DB: SQLite (Datei `data/rezeptplaner.db`), über `sqlite3` stdlib oder SQLModel/SQLAlchemy
- Frontend: einfaches modernes Vanilla-JS + HTML/CSS (kein Build-Step, kein npm nötig,
  damit es ohne node in Docker leicht läuft) ODER ein sehr leichtgewichtiges Setup mit
  Vite falls es die UI deutlich verbessert — deine Entscheidung, aber KEIN schwerer
  Framework-Overhead. PWA-fähig (manifest.json + service worker), Safari/iOS-Meta-Tags
  (viewport, apple-mobile-web-app-capable, theme-color), Design: modern, klar,
  Karten-basiert, Touch-optimierte Buttons (min. 44px Tap-Targets), Dark-Mode-fähig via
  prefers-color-scheme.
- KI-Anbindung: Rezept-Generierung läuft NICHT über die Anthropic-API direkt (kein
  ANTHROPIC_API_KEY vorhanden), sondern durch Aufruf der bereits authentifizierten
  `claude` CLI (Claude Code, v2.x, im PATH als `claude`) im Backend via subprocess, im
  Print-Modus mit strukturiertem JSON-Output:
  ```
  claude -p "<prompt>" --output-format json --json-schema '<schema>' --max-turns 3
  ```
  Parse `structured_output` (oder `result` als JSON) aus der Antwort. Nutze
  `asyncio.create_subprocess_exec` im FastAPI-Endpoint, mit Timeout (z.B. 90s) und
  sauberer Fehlerbehandlung falls die CLI fehlschlägt oder kein valides JSON liefert.
  Kapsle das in einer eigenen Datei `app/ai_client.py` mit einer Funktion
  `generate_recipes(preferences: dict) -> list[dict]`.

## Funktionale Anforderungen

1. **Rezepte per KI generieren lassen**
   - UI: Formular/Button "Neue Rezeptideen generieren" mit optionalen Filtern
     (z.B. Küche/Stil, Anzahl Portionen, vegetarisch/vegan/keine Einschränkung,
     max. Kochzeit, freier Textwunsch "z.B. schnell, wenig Aufwand, italienisch").
   - Backend generiert via `claude` CLI N (z.B. 5) Rezeptvorschläge als strukturiertes
     JSON: {title, description, cuisine, servings, prep_time_min, cook_time_min,
     ingredients: [{name, amount, unit}], steps: [string], tags: [string]}.
   - Generierte Rezepte werden in der DB gespeichert (Tabelle `recipes`), damit sie
     wiederverwendbar sind und nicht bei jedem Laden neu generiert werden müssen.

2. **Gerichte auswählbar, mit Rezept + Zutatenliste direkt sichtbar**
   - Übersicht aller gespeicherten Rezepte als Kartenraster (Titel, Bild-Platzhalter/Icon,
     Kochzeit, Tags).
   - Klick auf ein Rezept öffnet Detailansicht: vollständiges Kochrezept (Schritt-für-
     Schritt-Anleitung) + komplette Zutatenliste mit Mengenangaben.
   - Auswahl-Mechanismus: pro Rezept ein Toggle/Checkbox "Für diese Woche einplanen"
     (bezogen auf eine aktuelle "Wochenplan"-Session, gespeichert in Tabelle
     `weekly_plan` mit Wochenstart-Datum + Liste referenzierter recipe_ids +
     Portionen-Multiplikator pro Rezept).

3. **Automatische Wocheneinkaufsliste**
   - Endpoint/View "Einkaufsliste", der aus allen für die aktuelle Woche eingeplanten
     Rezepten automatisch eine aggregierte Zutatenliste baut:
     - gleiche Zutaten (normalisiert, z.B. "Zwiebel" vs "Zwiebeln", case-insensitive)
       werden zusammengeführt und Mengen addiert (wenn Einheiten kompatibel sind, sonst
       getrennt aufgelistet mit Hinweis).
     - Gruppierung nach Kategorie (z.B. Gemüse, Fleisch/Fisch, Milchprodukte, Gewürze,
       Sonstiges) — Kategorie kann grob heuristisch (Keyword-Mapping) oder durch die KI
       mitgeliefert werden (ergänze `category` Feld im Rezept-JSON-Schema).
   - Abhak-Funktion pro Position (Checkbox "gekauft"), Zustand bleibt bis Wochenwechsel
     erhalten (in DB speichern).
   - Button "Neue Woche starten" setzt Plan + Einkaufsliste zurück (alte Rezepte bleiben
     in der Bibliothek erhalten).

4. **Navigation**: Bottom-Tab-Bar (iPhone-Stil) mit 3 Tabs: "Rezepte" (Bibliothek +
   Generieren-Button), "Wochenplan" (ausgewählte Gerichte der Woche), "Einkaufsliste".

## Nicht-Ziele
- Kein Multi-User/Login (Single-User im Homelab-LAN reicht).
- Kein externer Cloud-Storage, keine Bilder-Uploads/-Generierung nötig (Icon/Emoji
  je nach Cuisine-Tag reicht als visueller Platzhalter).
- Keine Rezept-Import-Scraper von externen Websites — nur KI-generierte + evtl.
  manuell per Formular hinzufügbare Rezepte (optional, nice-to-have, kein Muss).

## Deployment
- Läuft als eigenständiger Prozess (uvicorn) auf Port **8010**, erreichbar im
  Homelab-LAN unter `http://<server-ip>:8010`.
- Liefere ein `Dockerfile` (python:3.13-slim Basis) UND eine `docker-compose.yml`
  (Service-Name `rezeptplaner`, Port-Mapping `8010:8010`, Volume für `data/` zur
  Persistenz der SQLite-DB). WICHTIG: die `claude` CLI muss im Container verfügbar
  UND authentifiziert sein — mounte `~/.claude` (enthält OAuth-Credentials) sowie
  `~/.local/bin/claude` (oder installiere Node + `@anthropic-ai/claude-code` im
  Dockerfile und mounte nur die Credentials/Config-Verzeichnisse
  `~/.claude` und `~/.claude.json` als read-only Volumes). Dokumentiere das exakte
  Vorgehen in der README, inkl. Warnung dass ohne diese Mounts die KI-Generierung
  fehlschlägt (klare Fehlermeldung im UI in diesem Fall, kein Absturz).
- Erstelle außerdem eine `README.md` mit: Setup-Schritten (lokal ohne Docker starten,
  UND mit Docker), Architekturüberblick, wie die claude-CLI-Anbindung funktioniert,
  bekannte Grenzen (z.B. Rate Limits vom Pro-Abo, Antwortzeit der CLI).
- Erstelle eine `requirements.txt` mit exakten Paketen.

## Qualitätsanforderungen
- Code muss lauffähig sein: nach dem Bauen `pip install -r requirements.txt` und
  `uvicorn app.main:app --host 0.0.0.0 --port 8010` sollten die App starten.
- Teste selbst am Ende (soweit ohne echten claude-CLI-Call im Sandbox-Kontext möglich):
  Server startet fehlerfrei, `/` liefert HTML, `/api/recipes` liefert leeres Array
  initial, DB-Datei wird angelegt. Wenn `claude` CLI im Sandbox nicht aufrufbar/
  authentifiziert ist, dokumentiere das als bekannte Einschränkung statt es zu
  verschweigen — täusche keinen erfolgreichen Live-Test der KI-Generierung vor, wenn
  er nicht wirklich lief.
- Sauberer Code, kommentiert wo nicht selbsterklärend, sinnvolle Fehlerbehandlung
  (kein stiller Absturz bei fehlendem `claude`-CLI oder ungültigem KI-Output).
