#!/usr/bin/env python3
"""
Extractor del catálogo de aluminetcg.com.ar (Empretienda) -> data/cards.json

Uso:
    pip install requests
    python crawl.py                 # baja TODA la tienda de nuevo (precios y stock al día)
    python crawl.py --resume        # retoma una corrida que se cortó
    python crawl.py --only pokemon-cartas-ingles/1999/base-set   # prueba con una sola categoría
    python crawl.py --rebuild       # no baja nada, solo regenera cards.json desde data/raw

Cómo funciona (verificado en la tienda real):
  1. La home trae embebido el árbol completo de categorías (idCategorias, c_link, c_padre, hijos).
  2. Cada categoría se pagina con
        GET /v4/product/category?filter_page=N&filter_order=0&filter_categories[]=<id>
     que devuelve JSON con 12 productos por página (nombre, precio, link, stock, imágenes).
  3. La rareza NO está en la tienda (solo a veces en el título). Para las cartas Pokémon en
     inglés se cruza nombre + número con la base pública pokemon-tcg-data (GitHub), que trae
     rareza, tipo y clase de cada carta. Para el resto se usa lo que diga el título (AR, SR, UC...).
"""
import argparse
import json
import re
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests

BASE = "https://aluminetcg.com.ar"
CDN = "https://d22fxaf9t8d39k.cloudfront.net/"
PTCG = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/"
DELAY = 1.0          # segundos entre pedidos de cada hilo: amable con la tienda
WORKERS = 1          # categorías en paralelo (la tienda respondió bien a 6 simultáneos)
MAX_PAGES = 3000     # tope de seguridad por categoría
TRANSFER_DISCOUNT = 0.10

HERE = Path(__file__).parent
RAW = HERE / "data" / "raw"
DB = HERE / "data" / "ptcg"
OUT = HERE / "data" / "cards.json"

session = requests.Session()
session.headers.update({"User-Agent": "Mozilla/5.0 (catalogo-aluminetcg; uso propio del dueño de la tienda)"})


# --------------------------------------------------------------------------- red
def get(url, **kw):
    for attempt in range(7):
        try:
            r = session.get(url, timeout=30, **kw)
            if r.status_code in (403, 429, 500, 502, 503, 504):
                print(f"  la tienda respondió {r.status_code}; espero {30 * (attempt + 1)}s y reintento", flush=True)
                time.sleep(30 * (attempt + 1))
                continue
            return r
        except requests.RequestException:
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"No pude bajar {url}")


# ----------------------------------------------------------------- categorías
CAT_RE = re.compile(
    r'\{\\?"idCategorias\\?":(\d+),\\?"c_nombre\\?":\\?"(.*?)\\?",.*?\\?"c_link\\?":\\?"(.*?)\\?",'
    r'.*?\\?"c_nombre_full\\?":\\?"(.*?)\\?",\\?"c_padre\\?":(\d+|null),.*?\\?"hijos\\?":\[(.*?)\]'
)


def unescape(s):
    try:
        return json.loads(f'"{s}"')
    except Exception:
        return s


def load_categories():
    html = get(BASE + "/").text
    cats = {}
    for m in CAT_RE.finditer(html):
        cid = int(m.group(1))
        cats[cid] = {
            "id": cid, "name": unescape(m.group(2)), "link": m.group(3),
            "parent": None if m.group(5) == "null" else int(m.group(5)),
        }
    if not cats:
        sys.exit("No encontré el árbol de categorías en la home. ¿Cambió la tienda?")
    for c in cats.values():
        chain, x = [], c
        while x and len(chain) < 10:
            chain.insert(0, x)
            x = cats.get(x["parent"]) if x["parent"] else None
        c["path"] = "/".join(k["link"] for k in chain)
        c["names"] = [k["name"] for k in chain]
    return cats


# ------------------------------------------------------------------ descarga
def fetch_category(cid):
    products, page = [], 1
    while page <= MAX_PAGES:
        time.sleep(DELAY)   # la tienda bloquea (403) si se le pide muy rápido
        r = get(f"{BASE}/v4/product/category", params={
            "filter_page": page, "filter_order": 0, "filter_categories[]": cid})
        if r.status_code != 200:
            raise RuntimeError(f"La tienda respondió {r.status_code} en la categoría {cid}")
        data = r.json().get("data") or []
        if not data:
            break
        products.extend(data)
        if len(data) < 12:      # última página: no hace falta pedir otra
            break
        page += 1
    return products


def download(cats, only=None, resume=False):
    """Baja todas las categorías. Por defecto baja TODO de nuevo (precios y stock frescos);
    con resume=True saltea las que ya están en data/raw (para retomar una corrida cortada)."""
    RAW.mkdir(parents=True, exist_ok=True)
    targets = [c for c in cats.values() if not only or c["path"] == only]
    if only and not targets:
        sys.exit(f"No existe la categoría {only}")
    if not resume and not only:
        for f in RAW.glob("*.json"):
            f.unlink()
    todo = [c for c in targets if not (resume and (RAW / f"{c['id']}.json").exists())]

    def work(c):
        prods = fetch_category(c["id"])
        (RAW / f"{c['id']}.json").write_text(json.dumps(prods, ensure_ascii=False))
        return c, len(prods)

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for done, (c, n) in enumerate(ex.map(work, todo), 1):
            if n:
                print(f"[{done}/{len(todo)}] {c['path']}: {n} productos", flush=True)


# --------------------------------------------------- lectura de los títulos
def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s)).strip()


def normnum(n):
    m = re.fullmatch(r"([a-z]*)0*(\d+)([a-z]*)", (n or "").lower().strip())
    return f"{m.group(1)}{m.group(2)}{m.group(3)}" if m else (n or "").lower()


NUM_RE = re.compile(r"(?<!\w)([A-Za-z]{0,4}\d{1,3}[a-z]?)\s*/\s*([A-Za-z]{0,4}\d{1,3})(?!\w)")
PROMO_RE = re.compile(r"\b(SWSH|SVP|MEP|HGSS|SM|XY|BW|DP)[ -]?(\d{1,3})\b")
OP_RE = re.compile(r"\b([A-Z]{1,3}\d{2}-\d{3})\b")
HASH_RE = re.compile(r"#\s?(\d{1,4}[a-z]?)\b")
NAME_CUT = re.compile(r"\s+-\s+|\s+\(|\s+\[|\s+#\s?\d|\s+[A-Za-z]{0,4}\d{1,3}[a-z]?\s*/\s*[A-Za-z]{0,4}\d{1,3}\b|\s+[A-Z]{1,5}\d{2,3}\b|\s+[A-Z]{1,3}\d{2}-\d{3}")
TYPE_RE = re.compile(r"\b(VMAX|VSTAR|V-UNION|GX|EX|ex|BREAK|TAG TEAM|Prime|LEGEND|Radiant|V)\b")
MEGA_RE = re.compile(r"^(Mega|M)\s")

FINISH_RULES = [(re.compile(p, re.I), n) for p, n in [
    (r"master ?ball", "Master Ball"), (r"pok[eé] ?ball", "Poké Ball"), (r"reverse", "Reverse Holo"),
    (r"cosmos", "Cosmos Holo"), (r"\bfoil\b", "Foil"), (r"\bholo\b", "Holo"),
]]
# Rareza escrita con palabras en el título (lo más específico primero)
RARITY_WORDS = [(re.compile(p, re.I), n) for p, n in [
    (r"special illustration rare", "Special Illustration Rare"), (r"illustration rare", "Illustration Rare"),
    (r"special art rare", "SAR (Special Art Rare)"), (r"art rare", "AR (Art Rare)"),
    (r"hyper rare|rainbow", "Hyper Rare"), (r"secret rare", "Rare Secret"), (r"super rare", "SR (Super Rare)"),
    (r"ultra rare", "Ultra Rare"), (r"double rare", "Double Rare"), (r"amazing rare", "Amazing Rare"),
    (r"full art", "Full Art"), (r"alt(ernate)? art", "Alt Art"), (r"\bpromos?\b", "Promo"),
]]
# Rareza abreviada pegada al número (cartas japonesas, One Piece): "182/172 AR", "OP01-109 UC"
ABBR_RE = re.compile(r"\d\s+(SAR|SIR|SSR|CSR|CHR|SEC|RRR|ACE|UR|HR|SR|AR|RR|UC|TR|PR|R|C|U|L)\b")
ABBR = {"SAR": "SAR (Special Art Rare)", "SIR": "Special Illustration Rare", "SSR": "SSR (Shiny Super Rare)",
        "CSR": "CSR (Character Super Rare)", "CHR": "CHR (Character Rare)", "SEC": "SEC (Secret Rare)",
        "RRR": "RRR (Triple Rare)", "ACE": "ACE", "UR": "UR (Ultra Rare)", "HR": "HR (Hyper Rare)",
        "SR": "SR (Super Rare)", "AR": "AR (Art Rare)", "RR": "RR (Double Rare)", "UC": "UC (Uncommon)",
        "TR": "TR (Trainer Rare)", "PR": "PR (Promo)", "R": "R (Rare)", "C": "C (Common)",
        "U": "U (Uncommon)", "L": "L (Leader)"}


def parse_title(title):
    """Del título de la tienda saca: nombre, número, total del set, acabado, rareza (si la dice) y variante."""
    number = total = ""
    m = NUM_RE.search(title)
    if m:
        number, total = m.group(1), m.group(2)
    else:
        m = PROMO_RE.search(title) or OP_RE.search(title) or HASH_RE.search(title)
        if m:
            number = "".join(m.groups())
    name = NAME_CUT.split(title, maxsplit=1)[0].strip() or title
    finish = next((n for rx, n in FINISH_RULES if rx.search(title)), "")
    rarity = next((n for rx, n in RARITY_WORDS if rx.search(title)), "")
    if not rarity:
        a = ABBR_RE.search(title)
        if a:
            rarity = ABBR[a.group(1)]
    t = TYPE_RE.search(name)
    variant = "Mega" if MEGA_RE.match(name) else (t.group(1) if t else "")
    return {"name": name, "number": number, "total": total, "finish": finish, "rarity": rarity, "variant": variant}


# ------------------------------------- base pública de cartas Pokémon (inglés)
TYPES_ES = {"Grass": "Planta", "Fire": "Fuego", "Water": "Agua", "Lightning": "Eléctrico", "Psychic": "Psíquico",
            "Fighting": "Lucha", "Darkness": "Siniestro", "Metal": "Metal", "Fairy": "Hada", "Dragon": "Dragón",
            "Colorless": "Incoloro"}
SUPER_ES = {"Pokémon": "Pokémon", "Trainer": "Entrenador", "Energy": "Energía"}


def load_card_db():
    """Devuelve {numero_normalizado: [cartas]} o {} si no se pudo bajar (el catálogo sale igual, sin rareza)."""
    try:
        DB.mkdir(parents=True, exist_ok=True)
        sets = get(PTCG + "sets/en.json").json()
        (DB / "_sets.json").write_text(json.dumps(sets))

        def one(s):
            f = DB / f"{s['id']}.json"
            if not f.exists():
                r = get(f"{PTCG}cards/en/{s['id']}.json")
                if r.status_code != 200:
                    return s, []
                f.write_text(r.text)
            return s, json.loads(f.read_text())

        idx, n = {}, 0
        with ThreadPoolExecutor(max_workers=8) as ex:
            for s, cards in ex.map(one, sets):
                for c in cards:
                    n += 1
                    idx.setdefault(normnum(c.get("number")), []).append({
                        "name": norm(c["name"]), "total": s.get("printedTotal"), "set": norm(s["name"]),
                        "year": (s.get("releaseDate") or "")[:4], "rarity": c.get("rarity") or "",
                        "super": SUPER_ES.get(c.get("supertype"), ""),
                        "type": TYPES_ES.get((c.get("types") or [""])[0], ""),
                    })
        print(f"Base de cartas Pokémon: {len(sets)} sets, {n} cartas")
        return idx
    except Exception as e:  # nunca frenar el catálogo por esto
        print(f"AVISO: no pude cargar la base de rarezas ({e}). Sigo sin enriquecer.")
        return {}


def lookup(db, t, year, context):
    """Busca la carta por número + nombre; desempata por total del set, año y nombre del set."""
    if not db or not t["number"]:
        return None
    cands = db.get(normnum(t["number"]), [])
    nn = norm(t["name"])
    if not nn or not cands:
        return None
    hit = [c for c in cands if c["name"] == nn]
    if not hit:
        first = nn.split()[0]
        hit = [c for c in cands if c["name"].split()[:1] == [first] and (c["name"] in nn or nn in c["name"])]
    if not hit:
        return None
    if t["total"].isdigit():
        same_total = [c for c in hit if c["total"] == int(t["total"])]
        if not same_total:
            return None          # mismo nombre y número pero de otro set: mejor no adivinar
        hit = same_total
    for pref in (lambda c: c["set"] and c["set"] in context, lambda c: c["year"] == year):
        better = [c for c in hit if pref(c)]
        if better:
            hit = better
    if len({c["rarity"] for c in hit}) > 1 and not t["total"].isdigit():
        return None              # ambiguo (ej. promos con el mismo número)
    return hit[0]


# ------------------------------------------------------------------- registros
GAMES = {
    "pokemon-cartas-ingles": ("Pokémon", "Inglés", "Cartas"),
    "pokemon-cartas-jap": ("Pokémon", "Japonés", "Cartas"),
    "pokemon-cartas-chino-s": ("Pokémon", "Chino", "Cartas"),
    "pokemon-cartas-korea": ("Pokémon", "Coreano", "Cartas"),
    "pokemon-cartas-espanol": ("Pokémon", "Español", "Cartas"),
    "pokemon-sellado": ("Pokémon", "", "Sellado"),
    "pokemon-booster-packs": ("Pokémon", "", "Sellado"),
    "pokemon-monedas": ("Pokémon", "", "Accesorios"),
    "cartas-gradeadas": ("Pokémon", "", "Gradeadas"),
    "one-piece": ("One Piece", "", "Cartas"),
    "disney-lorcana": ("Lorcana", "", "Cartas"),
    "dragon-ball": ("Dragon Ball", "", "Cartas"),
    "yu-gi-oh": ("Yu-Gi-Oh!", "", "Cartas"),
    "magic-the-gathering-sellado": ("Magic", "", "Sellado"),
    "mtg-singles-modern": ("Magic", "", "Cartas"),
    "mtg-singles-premodern": ("Magic", "", "Cartas"),
    "marvel-y-dc-tcg": ("Marvel y DC", "", "Cartas"),
    "star-wars-unlimited": ("Star Wars Unlimited", "", "Cartas"),
    "riftbound": ("Riftbound", "", "Cartas"),
    "gi-joe": ("GI Joe", "", "Cartas"),
    "folios-carpetas-playmats-etc": ("Accesorios", "", "Accesorios"),
    "comics": ("Comics", "", "Otros"), "figuras": ("Figuras", "", "Otros"),
    "impresiones-3d": ("Impresiones 3D", "", "Otros"), "ceramica": ("Cerámica", "", "Otros"),
    "otros": ("Otros", "", "Otros"),
}


def build_record(p, cat, db=None):
    qty = 0
    for s in p.get("stock") or []:
        qty += 9999 if s.get("s_ilimitado") else int(s.get("s_cantidad") or 0)
    price = p.get("p_precio_oferta") if p.get("p_oferta") and p.get("p_precio_oferta") else p.get("p_precio")
    imgs = p.get("imagenes") or []
    title = " ".join(p["p_nombre"].split())
    names = cat["names"]
    top = cat["path"].split("/")[0]
    game, lang, kind = GAMES.get(top, (names[0].title(), "", "Otros"))
    if "sellad" in cat["path"]:
        kind = "Sellado"
    year = next((n for n in names if re.fullmatch(r"(19|20)\d\d", n)), "")
    t = parse_title(title) if kind in ("Cartas", "Gradeadas") else {
        "name": title, "number": "", "total": "", "finish": "", "rarity": "", "variant": ""}
    rarity, supert, ptype = t["rarity"], "", ""
    if game == "Pokémon" and lang == "Inglés" and kind == "Cartas":
        hit = lookup(db, t, year, norm(" ".join(names) + " " + title))
        if hit:
            rarity, supert, ptype = hit["rarity"] or rarity, hit["super"], hit["type"]
    return {
        "id": p["idProductos"], "title": title, "card": t["name"],
        "number": t["number"] + ("/" + t["total"] if t["total"] else ""),
        "rarity": rarity, "finish": t["finish"], "variant": t["variant"], "super": supert, "ptype": ptype,
        "price": price, "transfer": round(price * (1 - TRANSFER_DISCOUNT)) if price else None, "stock": qty,
        "url": f"{BASE}/{cat['path']}/{p['p_link']}", "img": (CDN + imgs[0]["i_link"]) if imgs else "",
        "game": game, "lang": lang, "kind": kind, "year": year, "set": names[-1],
    }


def rebuild(cats, force=False):
    db = load_card_db()
    seen, rows = set(), []
    for f in sorted(RAW.glob("*.json")):
        cat = cats.get(int(f.stem))
        if not cat:
            continue
        for p in json.loads(f.read_text()):
            if p["idProductos"] in seen or p.get("p_desactivado"):
                continue
            seen.add(p["idProductos"])
            rows.append(build_record(p, cat, db))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # Red de seguridad: si la tienda falló a mitad de camino y vino mucho menos que antes,
    # no pisamos el catálogo publicado con uno incompleto.
    if OUT.exists() and not force:
        try:
            prev_n = len(json.loads(OUT.read_text())["cards"])
        except Exception:
            prev_n = 0
        if prev_n and len(rows) < prev_n * 0.7:
            sys.exit(f"ABORTO: bajé {len(rows)} productos y antes había {prev_n}. "
                     f"No actualizo el catálogo (usá --force si es correcto).")
    payload = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "cards": rows}
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    tmp.replace(OUT)
    cartas = [r for r in rows if r["kind"] == "Cartas"]
    print(f"\n{len(rows)} productos -> {OUT}")
    print(f"  con stock: {sum(1 for r in rows if r['stock'] > 0)}")
    print(f"  cartas sueltas: {len(cartas)} | con rareza: {sum(1 for r in cartas if r['rarity'])}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="ruta de una categoría, ej: pokemon-cartas-ingles/1999/base-set")
    ap.add_argument("--rebuild", action="store_true", help="no baja nada, solo regenera cards.json")
    ap.add_argument("--resume", action="store_true", help="retoma una corrida cortada")
    ap.add_argument("--force", action="store_true", help="publica aunque haya muchos menos productos que antes")
    a = ap.parse_args()
    cats = load_categories()
    print(f"{len(cats)} categorías encontradas")
    if not a.rebuild:
        download(cats, a.only, a.resume)
    rebuild(cats, a.force or bool(a.only))


if __name__ == "__main__":
    main()
