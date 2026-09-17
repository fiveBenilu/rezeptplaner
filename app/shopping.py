"""Aggregation der Einkaufsliste aus eingeplanten Rezepten."""
import re

from .ai_client import CATEGORIES
from collections import defaultdict

# Einheit -> (Basiseinheit, Faktor). Unbekannte Einheiten bleiben wie sie sind (kleingeschrieben).
UNITS = {
    "g": ("g", 1), "gramm": ("g", 1), "kg": ("g", 1000),
    "ml": ("ml", 1), "l": ("ml", 1000), "liter": ("ml", 1000),
    "": ("Stück", 1), "stück": ("Stück", 1), "stk": ("Stück", 1), "stk.": ("Stück", 1),
    "el": ("EL", 1), "tl": ("TL", 1),
}

IRREGULAR = {"eier": "ei"}

# ponytail: grobes Keyword-Mapping als Fallback, wenn die KI keine Kategorie liefert (z.B. alte/manuelle Rezepte).
KEYWORDS = [
    ("Fleisch & Fisch", "hähnchen huhn pute rind schwein hack fleisch speck schinken wurst lachs thunfisch fisch garnele salami chorizo"),
    ("Konserven & Vorrat", "dose passiert tomatenmark kichererbse bohnen mais kokosmilch"),
    ("Milchprodukte & Eier", "milch sahne butter käse parmesan mozzarella feta joghurt quark schmand frischkäse ei eier eigelb crème"),
    ("Gewürze & Öle", "salz pfeffer öl essig paprikapulver kreuzkümmel curry zimt oregano thymian chili gewürz sojasauce zucker honig brühe senf"),
    ("Nudeln, Reis & Getreide", "nudel spaghetti pasta reis mehl couscous quinoa bulgur haferflocken linsen"),
    ("Brot & Backwaren", "brot brötchen toast baguette tortilla wrap"),
    ("Gemüse & Obst", "zwiebel knoblauch tomate paprika karotte möhre kartoffel zucchini salat gurke spinat pilz champignon brokkoli lauch "
                      "sellerie apfel zitrone limette ingwer petersilie basilikum koriander schnittlauch aubergine kürbis avocado frühlingszwiebel"),
]


def normalize_name(name: str) -> str:
    """'Zwiebeln' und 'zwiebel' -> gleicher Schlüssel. Naive deutsche Plural-Heuristik."""
    key = re.sub(r"\s+", " ", name.strip().lower())
    key = re.sub(r"\(.*?\)", "", key).strip()
    if key in IRREGULAR:
        return IRREGULAR[key]
    # ponytail: Suffix-Stripping statt Lemmatizer; reicht für Zwiebeln/Tomaten/Champignons, stolpert bei Umlaut-Pluralen.
    for suffix in ("s", "n", "e"):
        if len(key) > 3 and key.endswith(suffix):
            key = key[:-1]
    return key


def guess_category(name: str) -> str:
    n = name.lower()
    for cat, words in KEYWORDS:
        # Kurze Keywords ("ei", "öl") nur am Wortende, sonst matcht "Reis" auf "ei".
        if any(re.search(rf"{w}\b", n) if len(w) <= 3 else w in n for w in words.split()):
            return cat
    return "Sonstiges"


def build_list(planned: list[tuple[dict, float]], checked: set[str]) -> list[dict]:
    """planned: [(recipe, multiplier)]. Liefert [{category, items:[...]}], sortiert."""
    agg = {}  # (name_key, base_unit) -> item
    for recipe, mult in planned:
        for ing in recipe["ingredients"]:
            unit_raw = (ing.get("unit") or "").strip()
            base, factor = UNITS.get(unit_raw.lower(), (unit_raw, 1))
            name_key = normalize_name(ing["name"])
            item = agg.setdefault((name_key, base), {
                "key": f"{name_key}|{base}", "name": ing["name"].strip(), "unit": base, "amount": 0.0,
                "unquantified": False, "category": ing.get("category") or guess_category(ing["name"]),
                "recipes": [],
            })
            if ing.get("amount") is None:
                item["unquantified"] = True  # z.B. "Salz nach Geschmack"
            else:
                item["amount"] += ing["amount"] * factor * mult
            if recipe["title"] not in item["recipes"]:
                item["recipes"].append(recipe["title"])

    units_per_name = defaultdict(set)
    for name_key, base in agg:
        units_per_name[name_key].add(base)

    groups = defaultdict(list)
    for (name_key, base), item in agg.items():
        amount = item.pop("amount")
        # Große Mengen wieder lesbar machen: 1500 g -> 1.5 kg
        if base in ("g", "ml") and amount >= 1000:
            amount, item["unit"] = amount / 1000, "kg" if base == "g" else "l"
        item["amount"] = round(amount, 2) if amount else None
        item["note"] = "in unterschiedlichen Einheiten gelistet" if len(units_per_name[name_key]) > 1 else ""
        item["checked"] = item["key"] in checked
        groups[item.pop("category")].append(item)

    return [
        {"category": cat, "items": sorted(items, key=lambda i: i["name"].lower())}
        for cat, items in sorted(groups.items(), key=lambda kv: (CATEGORIES.index(kv[0]) if kv[0] in CATEGORIES else 99, kv[0]))
    ]


if __name__ == "__main__":
    assert normalize_name("Zwiebeln") == normalize_name("zwiebel")
    assert normalize_name("Tomaten") == normalize_name("Tomate")
    assert normalize_name("Champignons") == normalize_name("Champignon")
    assert normalize_name("Eier") == normalize_name("Ei")
    r1 = {"title": "A", "ingredients": [{"name": "Zwiebel", "amount": 1, "unit": "Stück"},
                                        {"name": "Mehl", "amount": 0.5, "unit": "kg"},
                                        {"name": "Salz", "amount": None, "unit": "Prise"}]}
    r2 = {"title": "B", "ingredients": [{"name": "Zwiebeln", "amount": 2, "unit": ""},
                                        {"name": "Mehl", "amount": 700, "unit": "g"},
                                        {"name": "Mehl", "amount": 2, "unit": "EL"}]}
    out = build_list([(r1, 2), (r2, 1)], checked={"zwiebel|Stück"})
    items = {i["key"]: i for g in out for i in g["items"]}
    assert items["zwiebel|Stück"]["amount"] == 4 and items["zwiebel|Stück"]["checked"]
    assert items["mehl|g"]["amount"] == 1.7 and items["mehl|g"]["unit"] == "kg"
    assert items["mehl|EL"]["note"] and items["salz|Prise"]["amount"] is None
    assert guess_category("Reis") == "Nudeln, Reis & Getreide" and guess_category("Eier") == "Milchprodukte & Eier"
    assert guess_category("Kokosmilch") == "Konserven & Vorrat" and guess_category("Olivenöl") == "Gewürze & Öle"
    assert items["zwiebel|Stück"]["recipes"] == ["A", "B"]
    print("ok")
