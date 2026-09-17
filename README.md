# Rezeptplaner

iPhone-optimierte Web-App (PWA) fürs Homelab: Rezeptideen per KI generieren, Gerichte für die Woche einplanen,
automatisch zusammengefasste Einkaufsliste mit Abhaken.

## Setup

### Lokal (ohne Docker)

Voraussetzung: Python 3.13, eingeloggte `claude` CLI im `PATH` (`claude --version`, einmal interaktiv `claude` → Login).

```bash
pip install -r requirements.txt        # am besten in einem venv
uvicorn app.main:app --host 0.0.0.0 --port 8010
```

Dann `http://<server-ip>:8010` öffnen. Die SQLite-DB `data/rezeptplaner.db` wird beim Start automatisch angelegt.
Auf dem iPhone in Safari: Teilen → „Zum Home-Bildschirm“ für den Vollbild-App-Modus.

### Mit Docker

```bash
mkdir -p data                          # vorab anlegen, sonst gehört es root und ist nicht beschreibbar
docker compose up -d --build
```

> Der Container läuft als UID/GID `1000:1000`. Hat dein User eine andere ID (`id -u`), trag sie in eine `.env`
> neben der Compose-Datei ein: `UID=1001` / `GID=1001`.

**Wichtig: claude CLI im Container.** Das Image enthält die CLI *nicht*. `docker-compose.yml` mountet vom Host:

| Host | Container | Zweck |
|---|---|---|
| `~/.local/bin/claude` | `/usr/local/bin/claude` (ro) | natives CLI-Binary (Symlink wird beim Start aufgelöst) |
| `~/.claude` | `/home/app/.claude` | OAuth-Credentials, Settings |
| `~/.claude.json` | `/home/app/.claude.json` | CLI-Config/State |

Der Container läuft mit der UID/GID des Host-Users, damit er die Credentials lesen darf. Die beiden Config-Mounts
sind bewusst **nicht** read-only, weil die CLI Token-Refreshes und State zurückschreibt.

⚠️ **Ohne diese Mounts (oder ohne Login auf dem Host) schlägt die KI-Generierung fehl.** Die App läuft trotzdem
weiter; das UI zeigt im Generieren-Formular eine Meldung wie „Die `claude` CLI wurde nicht gefunden …“ bzw.
„KI-Anfrage fehlgeschlagen: Not logged in …“. Bibliothek, Wochenplan und Einkaufsliste funktionieren weiter.

Nach einem CLI-Update auf dem Host (neue Version unter `~/.local/share/claude/versions/`) den Container neu
erstellen (`docker compose up -d --force-recreate`), damit der Symlink neu aufgelöst wird. Auto-Updates sind im
Container deaktiviert (`DISABLE_AUTOUPDATER=1`).

## Architektur

```
app/main.py       FastAPI: REST-API + Auslieferung des Frontends, SQLite via sqlite3 (stdlib)
app/ai_client.py  generate_recipes(preferences) -> list[dict]: ruft die claude CLI auf, validiert das JSON
app/images.py     Titelbild-Generierung (SDXS-512, CPU), läuft als kurzlebiger Subprozess
app/shopping.py   Aggregation der Einkaufsliste (Namens-Normalisierung, Einheiten, Kategorien)
static/           Vanilla JS/HTML/CSS ohne Build-Step, manifest.json + Service Worker (PWA)
data/             SQLite-Datei, images/<id>.webp, hf-cache/ (Modell) – alles im Volume
```

**Tabellen:** `recipes` (Zutaten/Schritte/Tags als JSON-Spalten), `weekly_plan` (week_start, recipe_id,
multiplier), `shopping_checked` (week_start, item_key), `meta` (aktueller Wochenstart).

**API:**

| Methode | Pfad | |
|---|---|---|
| GET | `/api/recipes` | alle Rezepte (+ `planned`-Flag) |
| GET / DELETE | `/api/recipes/{id}` | Detail / löschen |
| POST | `/api/recipes/generate` | `{cuisine, servings, diet: ""\|vegetarisch\|vegan, max_time_min, wish, count}` |
| GET | `/api/recipes/{id}/image` | Titelbild (WebP), 404 falls keins |
| POST | `/api/recipes/{id}/image` | Titelbild (neu) im Hintergrund erzeugen |
| GET | `/api/plan` | Wochenplan |
| PUT / DELETE | `/api/plan/{recipe_id}` | einplanen `{multiplier}` / entfernen |
| POST | `/api/plan/new-week` | Plan + Häkchen zurücksetzen, Rezepte bleiben |
| GET | `/api/shopping-list` | aggregierte Liste, gruppiert nach Kategorie |
| PUT | `/api/shopping-list/check` | `{key, checked}` |

**Einkaufsliste:** Zutaten werden über einen normalisierten Namen (kleingeschrieben, simple Plural-Heuristik:
„Zwiebeln“ = „Zwiebel“, „Eier“ = „Ei“) und eine Basiseinheit (kg→g, l→ml, leer→Stück) zusammengeführt und mit dem
Portionen-Multiplikator addiert. Gibt es dieselbe Zutat in inkompatiblen Einheiten (z. B. g und EL), erscheinen
beide Zeilen mit Hinweis. Die Kategorie liefert die KI (Enum im JSON-Schema); für Zutaten ohne Kategorie greift ein
Keyword-Mapping.

## claude-CLI-Anbindung

`app/ai_client.py` startet per `asyncio.create_subprocess_exec` (kein Shell-Aufruf, keine Injection):

```
claude -p "<prompt>" --output-format json --json-schema '<schema>' --max-turns 3 --tools "" --no-session-persistence
```

- `--tools ""` und `--no-session-persistence`: reiner Text→JSON-Aufruf, keine Tool-Nutzung, keine Session-Dateien.
- Arbeitsverzeichnis ist das Temp-Verzeichnis, damit keine Projekt-`CLAUDE.md` in den Kontext rutscht.
- Aus der Antwort wird `structured_output` gelesen (Fallback: `result` als JSON). Jedes Rezept wird defensiv
  normalisiert; unvollständige Rezepte (ohne Zutaten/Schritte) werden verworfen.
- Fehler (CLI fehlt, Exit-Code ≠ 0, `is_error`, Timeout, kaputtes JSON) werden als `AIError` → HTTP 503 mit
  lesbarer Meldung ans UI gegeben.
- Umgebungsvariablen: `CLAUDE_BIN` (Default `claude`), `CLAUDE_TIMEOUT` in Sekunden (Default `180`).
- Bereits vorhandene Rezepttitel werden im Prompt ausgeschlossen, um Dubletten zu vermeiden.

## Titelbilder (lokales Bildmodell)

Neue KI-Rezepte (Generieren und Auto-Wochenplan) bekommen nach der HTTP-Antwort per FastAPI-`BackgroundTasks` ein
Titelbild. Modell: [`IDKiro/sdxs-512-0.9`](https://huggingface.co/IDKiro/sdxs-512-0.9) (1-Schritt-Diffusion,
Lizenz openrail++), rein auf der CPU mit torch (CPU-Wheel).

- **Download:** automatisch beim ersten Bild, ~2,6 GB (UNet 1,3 GB + Text-Encoder 1,36 GB fp32, Tiny-VAE 10 MB) nach
  `data/hf-cache/` (`HF_HOME`). Liegt im `data`-Volume, überlebt also Container-Neustarts. Danach kein Internet
  nötig. Das erste Bild dauert entsprechend der Leitung einige Minuten.
- **Image-Größe:** torch-CPU + diffusers/transformers machen das Docker-Image ~1,2 GB größer.
- **Laufzeit (gemessen auf dem Zielhost, 6 Kerne, 3 Threads, `nice 15`):** ~2,4 s pro 512×512-Bild, Modell laden
  ~1–8 s; 6 Bilder inkl. Laden ~20 s. Gespeichert wird als 384×384-WebP (~20–45 KB) in `data/images/<id>.webp`.
- **RAM:** ~3,1–3,8 GB Spitze, aber nur während der Generierung. Das Modell läuft in einem eigenen Subprozess
  (`python -m app.images`), der danach endet und den Speicher komplett freigibt; ein OOM-Kill trifft nur ihn,
  nicht den Webserver. Ein globaler Lock sorgt dafür, dass nie zwei Modelle gleichzeitig geladen sind.
- **Fehler** (kein Netz beim Erstdownload, OOM, Platte voll) werden nur geloggt; das Rezept bleibt ohne Bild, das
  UI zeigt weiter das Icon. Im Detailsheet gibt es „Bild (neu) generieren“, auch für Alt-Rezepte.
- **Umgebungsvariable** `IMAGE_THREADS` (Default `3`): CPU-Threads fürs Modell; `0` schaltet die Bildgenerierung ab.
- Nach dem Bearbeiten eines Rezepts bleibt das alte Bild bestehen, bis man es neu generiert.

## Bekannte Grenzen

- **Antwortzeit:** Die CLI braucht spürbar Zeit (getestet: ~15–20 s für 1–2 Rezepte; 5–8 Rezepte eher 40–120 s).
  Der Request blockiert so lange; das UI zeigt einen Spinner. Timeout 180 s.
- **Rate Limits:** Läuft über das Pro/Max-Abo des eingeloggten Accounts und zählt gegen dessen Nutzungslimits.
  Ist das Limit erreicht, kommt die Fehlermeldung der CLI im UI an.
- **Plural-/Einheiten-Heuristik** ist bewusst simpel: Umlaut-Plurale („Äpfel“/„Apfel“) oder „1 Dose“ vs. „400 g“
  Tomaten werden nicht zusammengeführt.
- **Wochenwechsel** passiert nur manuell über „Neue Woche starten“, nicht automatisch am Montag.
- Kein Login/Multi-User — nur im vertrauenswürdigen LAN betreiben.
- `apple-touch-icon` ist ein SVG; iOS nutzt dann einen Screenshot als Homescreen-Icon. Für ein echtes Icon eine
  180×180-PNG ablegen und in `index.html` referenzieren.
- Rezepte manuell per Formular anlegen ist nicht implementiert (optional laut Spezifikation).
