"""Rezept-Generierung über die lokal authentifizierte `claude` CLI (Print-Modus, strukturiertes JSON)."""
import asyncio
import json
import math
import os
import tempfile

CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")
# 5 vollständige Rezepte brauchen je nach Auslastung gern 60-120 s.
TIMEOUT_S = float(os.environ.get("CLAUDE_TIMEOUT", "180"))

CATEGORIES = ["Gemüse & Obst", "Fleisch & Fisch", "Milchprodukte & Eier", "Brot & Backwaren",
              "Nudeln, Reis & Getreide", "Konserven & Vorrat", "Gewürze & Öle", "Tiefkühl", "Sonstiges"]

SCHEMA = {
    "type": "object",
    "properties": {
        "recipes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "cuisine": {"type": "string"},
                    "servings": {"type": "integer"},
                    "prep_time_min": {"type": "integer"},
                    "cook_time_min": {"type": "integer"},
                    "ingredients": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "amount": {"type": ["number", "null"]},
                                "unit": {"type": "string"},
                                "category": {"type": "string", "enum": CATEGORIES},
                            },
                            "required": ["name", "amount", "unit", "category"],
                        },
                    },
                    "steps": {"type": "array", "items": {"type": "string"}},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "calories_kcal": {"type": "integer"},
                    "protein_g": {"type": "integer"},
                },
                "required": ["title", "description", "cuisine", "servings", "prep_time_min",
                             "cook_time_min", "ingredients", "steps", "tags", "calories_kcal", "protein_g"],
            },
        }
    },
    "required": ["recipes"],
}


class AIError(Exception):
    """Fehler mit einer für das UI geeigneten Meldung."""


def build_prompt(p: dict) -> str:
    count = p.get("count") or 5
    wishes = [f"Genau {count} unterschiedliche Rezeptvorschläge für ein Abendessen zu Hause."]
    if p.get("cuisine"):
        wishes.append(f"Küche/Stil: {p['cuisine']}.")
    wishes.append(f"Portionen pro Rezept: {p.get('servings') or 2}.")
    diet = p.get("diet")
    if diet == "vegetarisch":
        wishes.append("Alle Rezepte strikt vegetarisch.")
    elif diet == "vegan":
        wishes.append("Alle Rezepte strikt vegan.")
    if p.get("max_time_min"):
        wishes.append(f"Gesamtzeit (Vorbereitung + Kochen) höchstens {p['max_time_min']} Minuten.")
    if p.get("wish"):
        wishes.append(f"Zusätzlicher Wunsch: {p['wish']}")
    if p.get("exclude_titles"):
        wishes.append("Bitte nicht diese bereits vorhandenen Gerichte: " + "; ".join(p["exclude_titles"][:40]))
    return (
        "Du bist ein erfahrener Koch. " + " ".join(wishes) + "\n"
        "Regeln: Alles auf Deutsch. Zutatennamen im Singular ohne Mengen im Namen (z.B. 'Zwiebel'). "
        "Einheiten nur aus: g, kg, ml, l, EL, TL, Stück, Prise, Bund, Zehe, Dose, Packung, Scheibe; "
        "amount null nur bei 'nach Geschmack'. Schritte klar und vollständig, ohne Nummerierung. "
        "Tags kurz (z.B. 'schnell', 'vegetarisch'). "
        "calories_kcal und protein_g: realistische, grobe Schätzung pro Portion (nicht fürs ganze Rezept), "
        "ganzzahlig und sinnvoll gerundet (z.B. 620 kcal, 34 g), keine Scheingenauigkeit. Antworte ausschließlich mit den strukturierten Daten."
    )


async def generate_recipes(preferences: dict) -> list[dict]:
    """Ruft `claude -p` auf und liefert validierte Rezept-Dicts. Wirft AIError bei jedem Fehlschlag."""
    args = [CLAUDE_BIN, "-p", build_prompt(preferences), "--output-format", "json",
            "--json-schema", json.dumps(SCHEMA), "--max-turns", "3",
            # Keine Tools, keine Session-Dateien: reiner Text->JSON-Aufruf.
            "--tools", "", "--no-session-persistence"]
    try:
        # Neutrales cwd, damit keine Projekt-CLAUDE.md o.ä. in den Prompt einfließt.
        proc = await asyncio.create_subprocess_exec(
            *args, cwd=tempfile.gettempdir(), stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    except FileNotFoundError:
        raise AIError("Die `claude` CLI wurde nicht gefunden. Ist sie installiert bzw. in den Container gemountet?")
    except OSError as e:
        raise AIError(f"`claude` CLI konnte nicht gestartet werden: {e}")

    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=TIMEOUT_S)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise AIError(f"Die KI hat nicht innerhalb von {int(TIMEOUT_S)} s geantwortet. Bitte später erneut versuchen.")

    return parse_output(proc.returncode, out.decode(errors="replace"), err.decode(errors="replace"))


def parse_output(returncode: int, stdout: str, stderr: str) -> list[dict]:
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        detail = (stderr or stdout).strip()[:300]
        raise AIError(f"`claude` CLI fehlgeschlagen (Exit {returncode}). Evtl. nicht eingeloggt? {detail}")

    if returncode != 0 or data.get("is_error"):
        detail = str(data.get("result") or data.get("subtype") or stderr).strip()[:300]
        raise AIError(f"KI-Anfrage fehlgeschlagen: {detail}")

    payload = data.get("structured_output")
    if payload is None and isinstance(data.get("result"), str):
        try:
            payload = json.loads(data["result"])
        except json.JSONDecodeError:
            payload = None
    recipes = payload.get("recipes") if isinstance(payload, dict) else payload
    if not isinstance(recipes, list):
        raise AIError("Die KI hat kein gültiges Rezept-JSON geliefert.")

    valid = [r for r in (clean_recipe(r) for r in recipes) if r]
    if not valid:
        raise AIError("Die KI-Antwort enthielt keine verwertbaren Rezepte.")
    return valid


def _int(v, default=0):
    try:
        return max(0, int(v))
    except (TypeError, ValueError, OverflowError):
        return default


def clean_recipe(r) -> dict | None:
    """Defensive Normalisierung: fehlende/kaputte Felder werden ersetzt, unbrauchbare Rezepte verworfen."""
    if not isinstance(r, dict) or not str(r.get("title", "")).strip():
        return None
    ingredients = []
    for i in r.get("ingredients") or []:
        if not isinstance(i, dict) or not str(i.get("name", "")).strip():
            continue
        amount = i.get("amount")
        ingredients.append({
            "name": str(i["name"]).strip(),
            "amount": float(amount) if isinstance(amount, (int, float)) and math.isfinite(amount) else None,
            "unit": str(i.get("unit") or "").strip(),
            "category": i.get("category") if i.get("category") in CATEGORIES else None,
        })
    steps = [str(s).strip() for s in r.get("steps") or [] if str(s).strip()]
    if not ingredients or not steps:
        return None
    return {
        "title": str(r["title"]).strip(),
        "description": str(r.get("description") or "").strip(),
        "cuisine": str(r.get("cuisine") or "").strip(),
        "servings": _int(r.get("servings"), 2) or 2,
        "prep_time_min": _int(r.get("prep_time_min")),
        "cook_time_min": _int(r.get("cook_time_min")),
        "ingredients": ingredients,
        "steps": steps,
        "tags": [str(t).strip() for t in r.get("tags") or [] if str(t).strip()],
        # Nährwerte sind nur eine Schätzung und optional: kaputt/fehlend -> None statt Rezept verwerfen.
        "calories_kcal": _int(r.get("calories_kcal"), None),
        "protein_g": _int(r.get("protein_g"), None),
    }
