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
                        "name": norm(c["name"]).replace("impostor", "imposter"), "total": s.get("printedTotal"), "set": norm(s["name"]),
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
    nn = norm(t["name"]).replace(" pokemon c ", " c ").replace("impostor", "imposter")
    if not nn or not cands:
        return None
    hit = [c for c in cands if c["name"] == nn]
    if not hit:
        first = nn.split()[0]
        hit = [c for c in cands if c["name"].split()[:1] == [first] and (c["name"] in nn or nn in c["name"])]
    if not hit:
        return None
    # "Classic Collection" es un set de reimpresiones, no una rareza: vale la de la carta original
    hit = [c for c in hit if c["rarity"] != "Classic Collection"] or hit
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


# ------------------------------------------------- rarezas unificadas
# Cada idioma y cada época nombran la rareza distinto (C, Common, RR, Rare Holo V...).
# Acá se agrupan en pocos nombres para que el filtro sea claro.
RAREZA = {}
for _canon, _raws in {
    "Common": ["C (Common)"],
    "Uncommon": ["U (Uncommon)", "UC (Uncommon)"],
    "Rare": ["R (Rare)", "Rare Holo", "Pikachu Rare"],
    "Double Rare": ["RR (Double Rare)", "RRR (Triple Rare)", "Rare Holo V", "Rare Holo VMAX", "Rare Holo VSTAR",
                    "Rare Holo GX", "Rare Holo EX", "Rare BREAK", "Rare Holo LV.X", "Rare Prime", "Rare Prism Star"],
    "Ultra Rare": ["Rare Ultra", "SR (Super Rare)", "Full Art", "TR (Trainer Rare)"],
    "Illustration Rare": ["AR (Art Rare)", "CHR (Character Rare)", "Trainer Gallery Rare Holo"],
    "Special Illustration Rare": ["SAR (Special Art Rare)", "CSR (Character Super Rare)", "Alt Art"],
    "Hyper Rare": ["HR (Hyper Rare)", "UR (Ultra Rare)", "Rare Rainbow", "Rare Secret", "SEC (Secret Rare)"],
    "Shiny Rare": ["Rare Shiny", "Shiny Ultra Rare", "Rare Shiny GX", "SSR (Shiny Super Rare)"],
    "ACE SPEC": ["ACE SPEC Rare", "ACE"],
    "Mega Attack Rare": ["MEGA_ATTACK_RARE"],
    "Leader": ["L (Leader)"],
    "Promo": ["PR (Promo)"],
}.items():
    for _r in _raws:
        RAREZA[_r] = _canon
# Nombres que usa TCGplayer (segunda fuente de rarezas)
RAREZA.update({"Holo Rare": "Rare", "Triple Rare": "Double Rare", "Prism Rare": "Double Rare", "Super Rare": "Ultra Rare",
               "Art Rare": "Illustration Rare", "Character Rare": "Illustration Rare",
               "Special Art Rare": "Special Illustration Rare", "Character Super Rare": "Special Illustration Rare",
               "Secret Rare": "Hyper Rare", "Mega Hyper Rare": "Hyper Rare", "Shiny Holo Rare": "Shiny Rare",
               "Shiny Super Rare": "Shiny Rare", "Rare ACE": "ACE SPEC", "ACE Rare": "ACE SPEC", "Kagayaku": "Radiant Rare",
               "Code Card": ""})
# En otros juegos TCGplayer da la rareza como sigla
SIGLAS = {"C": "Common", "U": "Uncommon", "UC": "Uncommon", "R": "Rare", "M": "Mythic Rare", "SR": "Super Rare",
          "SEC": "Secret Rare", "L": "Leader", "P": "Promo", "PR": "Promo", "T": "Token", "TR": "Treasure Rare",
          "SP": "Special", "S": "Special"}
# En One Piece y Dragon Ball, SR y SEC son escalones propios (no equivalen a los de Pokémon).
RAREZA_OTROS = {"SR (Super Rare)": "Super Rare", "SEC (Secret Rare)": "Secret Rare"}


def unify(rarity, game, finish):
    """Devuelve (rareza unificada, acabado). 'Rare Holo' pasa a Rare + acabado Holo."""
    if not rarity or rarity in ("None", "Classic Collection"):
        return "", finish
    if rarity in ("Rare Holo", "Holo Rare", "Trainer Gallery Rare Holo") and not finish:
        finish = "Holo"
    if game != "Pokémon":
        if game == "Magic" and rarity == "L":
            return "Land", finish
        if rarity in SIGLAS:
            return SIGLAS[rarity], finish
        if rarity in RAREZA_OTROS:
            return RAREZA_OTROS[rarity], finish
        return (RAREZA.get(rarity, rarity) if "(" in rarity else rarity), finish
    return RAREZA.get(rarity, rarity), finish


def classify(title, game, lang, kind, year, context, db):
    """Lee el título y devuelve nombre, número, rareza, acabado, variante, clase y tipo."""
    t = parse_title(title) if kind in ("Cartas", "Gradeadas") else {
        "name": title, "number": "", "total": "", "finish": "", "rarity": "", "variant": ""}
    rarity, supert, ptype = t["rarity"], "", ""
    if game != "Pokémon" and rarity in ("Full Art", "Alt Art"):
        rarity = ""                  # en otros juegos son estilos de la carta, no rarezas
    if game == "Pokémon" and lang == "Inglés" and kind == "Cartas":
        hit = lookup(db, t, year, norm(context + " " + title))
        if hit:
            rarity, supert, ptype = hit["rarity"] or rarity, hit["super"], hit["type"]
    rarity, finish = unify(rarity, game, t["finish"])
    return {"card": t["name"], "number": t["number"] + ("/" + t["total"] if t["total"] else ""),
            "rarity": rarity, "finish": finish, "variant": t["variant"], "super": supert, "ptype": ptype}


def tcg_rarities(rows):
    """Segunda fuente: completa con TCGplayer la rareza de las cartas que quedaron sin dato."""
    for r in rows:              # las Radiant (Kagayaku) tienen rareza propia en todos los idiomas
        if (not r["rarity"] and r["game"] == "Pokémon" and r["kind"] in ("Cartas", "Gradeadas")
                and re.search(r"\bradiant\b(?! collection)", r["title"].lower())):
            r["rarity"] = "Radiant Rare"
    try:
        import precios
        falta = [r for r in rows if not r["rarity"] and r["kind"] in ("Cartas", "Gradeadas")
                 and "art card" not in r["title"].lower()]
        for (game, lang), cat in precios.RARITY_CATEGORIES.items():
            mine = [r for r in falta if r["game"] == game and (not lang or r["lang"] == lang)]
            if not mine:
                continue
            sets = None if game == "Pokémon" else {precios.words(r["set"]) for r in rows if r["game"] == game}
            groups, _ = precios.load_tcg(cat, sets)
            idx = precios.build_index(groups)
            ok = 0
            for r in mine:
                raw, name = precios.find_rarity(idx, r)
                if raw:
                    r["rarity"], r["finish"] = unify(raw, game, r["finish"])
                    ok += bool(r["rarity"])
                    if not r["number"] and name:
                        r["card"] = name     # título sin separadores: usar el nombre limpio de la carta
            print(f"Rareza por TCGplayer, {game} {lang}: {ok} de {len(mine)} que faltaban", flush=True)
        # Chino: sets con numeración propia que reimprimen cartas japonesas -> rareza de la carta japonesa
        chino = [r for r in rows if not r["rarity"] and r["game"] == "Pokémon" and r["lang"] == "Chino"
                 and r["kind"] in ("Cartas", "Gradeadas") and not re.search(r"gem .*pack|cbb\d", (r["set"] + " " + r["title"]).lower())]
        if chino:
            idx = precios.build_index(precios.load_tcg(85)[0])
            ok = 0
            for r in chino:
                raw = precios.name_rarity(idx, r)
                if raw:
                    r["rarity"], r["finish"] = unify(raw, "Pokémon", r["finish"])
                    ok += bool(r["rarity"])
            print(f"Rareza por carta japonesa, Pokémon Chino: {ok} de {len(chino)} que faltaban", flush=True)
    except Exception as e:      # nunca frenar el catálogo por esto
        print(f"AVISO: no pude completar rarezas con TCGplayer ({e})")


def resumen(rows):
    cartas = [r for r in rows if r["kind"] == "Cartas"]
    print(f"  con stock: {sum(1 for r in rows if r['stock'] > 0)}")
    print(f"  cartas sueltas: {len(cartas)} | con rareza: {sum(1 for r in cartas if r['rarity'])}")
    for g in sorted({(r["game"], r["lang"]) for r in cartas}):
        mine = [r for r in cartas if (r["game"], r["lang"]) == g]
        print(f"    {g[0]} {g[1]}: {sum(1 for r in mine if r['rarity'])} de {len(mine)}")


def reenrich():
    """Recalcula rareza, acabado y tipo sobre el cards.json que ya existe, sin recorrer la tienda."""
    data = json.loads(OUT.read_text())
    db = load_card_db()
    for r in data["cards"]:
        r.update(classify(r["title"], r["game"], r["lang"], r["kind"], r["year"], r["set"], db))
    tcg_rarities(data["cards"])
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    tmp.replace(OUT)
    print(f"\n{len(data['cards'])} productos reclasificados -> {OUT}")
    resumen(data["cards"])


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
    return {
        "id": p["idProductos"], "title": title, **classify(title, game, lang, kind, year, " ".join(names), db),
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
    tcg_rarities(rows)
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
    print(f"\n{len(rows)} productos -> {OUT}")
    resumen(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="ruta de una categoría, ej: pokemon-cartas-ingles/1999/base-set")
    ap.add_argument("--rebuild", action="store_true", help="no baja nada, solo regenera cards.json")
    ap.add_argument("--resume", action="store_true", help="retoma una corrida cortada")
    ap.add_argument("--force", action="store_true", help="publica aunque haya muchos menos productos que antes")
    ap.add_argument("--reenrich", action="store_true", help="recalcula rarezas sobre cards.json sin recorrer la tienda")
    a = ap.parse_args()
    if a.reenrich:
        reenrich()
        return
    cats = load_categories()
    print(f"{len(cats)} categorías encontradas")
    if not a.rebuild:
        download(cats, a.only, a.resume)
    rebuild(cats, a.force or bool(a.only))


if __name__ == "__main__":
    main()
