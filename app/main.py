"""Rezeptplaner: FastAPI-Backend mit SQLite und statischem Vanilla-JS-Frontend."""
import datetime as dt
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import ai_client, shopping

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "rezeptplaner.db"
STATIC = ROOT / "static"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cuisine TEXT NOT NULL DEFAULT '',
    servings INTEGER NOT NULL DEFAULT 2,
    prep_time_min INTEGER NOT NULL DEFAULT 0,
    cook_time_min INTEGER NOT NULL DEFAULT 0,
    ingredients TEXT NOT NULL,  -- JSON [{name, amount, unit, category}]
    steps TEXT NOT NULL,        -- JSON [string]
    tags TEXT NOT NULL,         -- JSON [string]
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Eine Zeile pro eingeplantem Rezept der aktuellen Woche.
CREATE TABLE IF NOT EXISTS weekly_plan (
    week_start TEXT NOT NULL,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    multiplier REAL NOT NULL DEFAULT 1,
    PRIMARY KEY (week_start, recipe_id)
);
CREATE TABLE IF NOT EXISTS shopping_checked (
    week_start TEXT NOT NULL,
    item_key TEXT NOT NULL,
    PRIMARY KEY (week_start, item_key)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(db()) as conn, conn:
        conn.executescript(SCHEMA_SQL)
        # Migration für Alt-Datenbanken: Nährwert-Spalten (nullable) nachrüsten.
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(recipes)")}
        for col in ("calories_kcal", "protein_g"):
            if col not in cols:
                conn.execute(f"ALTER TABLE recipes ADD COLUMN {col} INTEGER")
        if "favorite" not in cols:
            conn.execute("ALTER TABLE recipes ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0")


def current_week(conn) -> str:
    """Wochenstart der aktiven Plan-Session. Wechselt nur über 'Neue Woche starten'."""
    row = conn.execute("SELECT value FROM meta WHERE key = 'week_start'").fetchone()
    if row:
        return row["value"]
    return start_new_week(conn)


def start_new_week(conn) -> str:
    today = dt.date.today()
    week = (today - dt.timedelta(days=today.weekday())).isoformat()  # Montag
    conn.execute("DELETE FROM weekly_plan")
    conn.execute("DELETE FROM shopping_checked")
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('week_start', ?)", (week,))
    return week


def row_to_recipe(row) -> dict:
    r = dict(row)
    for f in ("ingredients", "steps", "tags"):
        r[f] = json.loads(r[f])
    r["favorite"] = bool(r.get("favorite"))
    return r


def get_recipe(conn, recipe_id: int) -> dict:
    row = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Rezept nicht gefunden")
    return row_to_recipe(row)


app = FastAPI(title="Rezeptplaner")
init_db()


# ---------- Rezepte ----------

@app.get("/api/recipes")
def list_recipes():
    with closing(db()) as conn:
        week = current_week(conn)
        rows = conn.execute(
            "SELECT r.*, p.multiplier FROM recipes r "
            "LEFT JOIN weekly_plan p ON p.recipe_id = r.id AND p.week_start = ? "
            "ORDER BY r.id DESC", (week,)).fetchall()
        conn.commit()
    out = []
    for row in rows:
        r = row_to_recipe(row)
        r["planned"] = r.pop("multiplier") is not None
        out.append(r)
    return out


@app.get("/api/recipes/{recipe_id}")
def recipe_detail(recipe_id: int):
    with closing(db()) as conn:
        return get_recipe(conn, recipe_id)


@app.delete("/api/recipes/{recipe_id}")
def delete_recipe(recipe_id: int):
    with closing(db()) as conn, conn:
        conn.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))
    return {"ok": True}


class GenerateRequest(BaseModel):
    cuisine: str = Field("", max_length=100)
    servings: int = Field(2, ge=1, le=12)
    diet: str = Field("", pattern="^(|vegetarisch|vegan)$")
    max_time_min: int | None = Field(None, ge=5, le=600)
    wish: str = Field("", max_length=500)
    count: int = Field(5, ge=1, le=8)


RECIPE_COLS = ("title", "description", "cuisine", "servings", "prep_time_min", "cook_time_min",
               "ingredients", "steps", "tags", "calories_kcal", "protein_g")


def recipe_values(r: dict) -> tuple:
    return tuple(json.dumps(r[c], ensure_ascii=False) if c in ("ingredients", "steps", "tags") else r.get(c)
                 for c in RECIPE_COLS)


async def generate_and_store(prefs: dict) -> list[int]:
    """KI-Rezepte generieren und speichern; liefert die neuen IDs. Gemeinsam für Generieren und Auto-Wochenplan."""
    with closing(db()) as conn:
        prefs["exclude_titles"] = [r["title"] for r in conn.execute("SELECT title FROM recipes ORDER BY id DESC LIMIT 40")]
    try:
        recipes = await ai_client.generate_recipes(prefs)
    except ai_client.AIError as e:
        raise HTTPException(503, str(e))
    with closing(db()) as conn, conn:
        return [conn.execute(f"INSERT INTO recipes ({', '.join(RECIPE_COLS)}) VALUES ({', '.join('?' * len(RECIPE_COLS))})",
                             recipe_values(r)).lastrowid for r in recipes]


@app.post("/api/recipes/generate")
async def generate(req: GenerateRequest):
    ids = await generate_and_store(req.model_dump())
    with closing(db()) as conn:
        return [get_recipe(conn, i) for i in ids]


@app.put("/api/recipes/{recipe_id}")
def update_recipe(recipe_id: int, body: dict = Body(...)):
    # Gleiche Normalisierung wie bei KI-Rezepten; Nicht-Listen vorher neutralisieren (sonst iteriert clean_recipe über Strings).
    for f in ("ingredients", "steps", "tags"):
        if not isinstance(body.get(f), list):
            body[f] = []
    r = ai_client.clean_recipe(body)
    if not r:
        if not str(body.get("title") or "").strip():
            raise HTTPException(422, "Der Titel darf nicht leer sein.")
        raise HTTPException(422, "Das Rezept braucht mindestens eine Zutat und einen Zubereitungsschritt.")
    with closing(db()) as conn, conn:
        get_recipe(conn, recipe_id)
        conn.execute(f"UPDATE recipes SET {', '.join(c + ' = ?' for c in RECIPE_COLS)} WHERE id = ?",
                     (*recipe_values(r), recipe_id))
        return get_recipe(conn, recipe_id)


class FavoriteEntry(BaseModel):
    favorite: bool


@app.put("/api/recipes/{recipe_id}/favorite")
def set_favorite(recipe_id: int, entry: FavoriteEntry):
    with closing(db()) as conn, conn:
        get_recipe(conn, recipe_id)
        conn.execute("UPDATE recipes SET favorite = ? WHERE id = ?", (int(entry.favorite), recipe_id))
    return {"ok": True}


# ---------- Wochenplan ----------

@app.get("/api/plan")
def get_plan():
    with closing(db()) as conn, conn:
        week = current_week(conn)
        rows = conn.execute(
            "SELECT r.*, p.multiplier FROM weekly_plan p JOIN recipes r ON r.id = p.recipe_id "
            "WHERE p.week_start = ? ORDER BY r.title", (week,)).fetchall()
    items = []
    for row in rows:
        r = row_to_recipe(row)
        items.append({"multiplier": r.pop("multiplier"), "recipe": r})
    return {"week_start": week, "items": items}


class PlanEntry(BaseModel):
    multiplier: float = Field(1, gt=0, le=20)


@app.put("/api/plan/{recipe_id}")
def plan_recipe(recipe_id: int, entry: PlanEntry):
    with closing(db()) as conn, conn:
        get_recipe(conn, recipe_id)
        conn.execute("INSERT OR REPLACE INTO weekly_plan (week_start, recipe_id, multiplier) VALUES (?, ?, ?)",
                     (current_week(conn), recipe_id, entry.multiplier))
    return {"ok": True}


@app.delete("/api/plan/{recipe_id}")
def unplan_recipe(recipe_id: int):
    with closing(db()) as conn, conn:
        conn.execute("DELETE FROM weekly_plan WHERE week_start = ? AND recipe_id = ?", (current_week(conn), recipe_id))
    return {"ok": True}


class AutoPlanRequest(BaseModel):
    count: int = Field(5, ge=1, le=10)
    diet: str = Field("", pattern="^(|vegetarisch|vegan)$")
    wish: str = Field("", max_length=500)


@app.post("/api/plan/auto-generate")
async def auto_plan(req: AutoPlanRequest):
    ids = await generate_and_store(req.model_dump())
    with closing(db()) as conn, conn:
        week = current_week(conn)
        conn.executemany("INSERT OR REPLACE INTO weekly_plan (week_start, recipe_id, multiplier) VALUES (?, ?, 1)",
                         [(week, i) for i in ids])
    return get_plan()


@app.post("/api/plan/new-week")
def new_week():
    with closing(db()) as conn, conn:
        return {"week_start": start_new_week(conn)}


# ---------- Einkaufsliste ----------

@app.get("/api/shopping-list")
def shopping_list():
    plan = get_plan()
    with closing(db()) as conn:
        checked = {r["item_key"] for r in conn.execute(
            "SELECT item_key FROM shopping_checked WHERE week_start = ?", (plan["week_start"],))}
    planned = [(i["recipe"], i["multiplier"]) for i in plan["items"]]
    return {"week_start": plan["week_start"], "groups": shopping.build_list(planned, checked)}


class CheckEntry(BaseModel):
    key: str = Field(..., max_length=300)
    checked: bool


@app.put("/api/shopping-list/check")
def check_item(entry: CheckEntry):
    with closing(db()) as conn, conn:
        week = current_week(conn)
        if entry.checked:
            conn.execute("INSERT OR IGNORE INTO shopping_checked VALUES (?, ?)", (week, entry.key))
        else:
            conn.execute("DELETE FROM shopping_checked WHERE week_start = ? AND item_key = ?", (week, entry.key))
    return {"ok": True}


# ---------- Frontend ----------

@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/sw.js")
def service_worker():
    # Service Worker muss vom Root ausgeliefert werden, damit sein Scope die ganze App umfasst.
    return FileResponse(STATIC / "sw.js", media_type="application/javascript")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
