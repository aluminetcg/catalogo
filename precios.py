#!/usr/bin/env python3
"""
Comparador interno de precios: tienda (ARS) vs TCGplayer (USD) -> data/precios.bin (cifrado)

Uso:
    pip install requests cryptography
    PRECIOS_CLAVE="tu-clave" python precios.py

Qué hace:
  1. Lee data/cards.json (lo genera crawl.py).
  2. Baja los precios de TCGplayer desde tcgcsv.com (se actualizan una vez por día; se
     guardan en data/tcgcsv/ y no se vuelven a bajar hasta que cambian).
  3. Empareja cada carta por número + nombre + set y elige el precio del acabado correcto
     (Normal / Holofoil / Reverse Holofoil).
  4. Toma el dólar oficial del día y guarda todo cifrado con la clave PRECIOS_CLAVE.
     La página precios.html lo abre solo con esa misma clave.
"""
import gzip
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests

from crawl import norm, normnum

TCG = "https://tcgcsv.com"
CATEGORIES = {("Pokémon", "Inglés"): 3, ("Pokémon", "Japonés"): 85}   # categorías de TCGplayer (precios)
# Categorías que se usan para completar rarezas (crawl.py). Idioma vacío = cualquiera.
RARITY_CATEGORIES = {("Pokémon", "Inglés"): 3, ("Pokémon", "Japonés"): 85, ("Pokémon", "Coreano"): 85,
                     ("One Piece", ""): 68,
                     ("Magic", ""): 1, ("Lorcana", ""): 71}
SALT = b"aluminetcg-precios-v1"
ITERATIONS = 200_000

HERE = Path(__file__).parent
CARDS = HERE / "data" / "cards.json"
CACHE = HERE / "data" / "tcgcsv"
OUT = HERE / "data" / "precios.bin"

session = requests.Session()
session.headers.update({"User-Agent": "catalogo-aluminetcg/1.0 (comparador interno de precios)"})


def get_json(url):
    for attempt in range(4):
        try:
            r = session.get(url, timeout=60)
            if r.status_code == 200:
                return r.json()
        except (requests.RequestException, ValueError):
            pass
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"No pude bajar {url}")


# ---------------------------------------------------------------- TCGplayer
def load_tcg(cat, only=None):
    """Devuelve la lista de grupos (sets) de una categoría, con productos y precios. Usa caché diaria."""
    CACHE.mkdir(parents=True, exist_ok=True)
    full = CACHE / f"{cat}.v4.json"                 # categoría completa (la usa singles.py)
    f = full if only is None else CACHE / f"{cat}.part.v4.json"   # solo los sets que tiene la tienda (crawl.py)
    stamp = session.get(f"{TCG}/last-updated.txt", timeout=30).text.strip()

    def needed(g):
        gw = words(g["name"].split(": ", 1)[-1])
        ws = set(gw.split())
        return any(gw == o or (len(gw) > 3 and len(o) > 3 and (gw in o or o in gw)) or
                   len(ws & set(o.split())) >= 0.6 * len(ws | set(o.split())) for o in only)
    for cand in ([f] if only is None else [full, f]):
        if cand.exists():
            old = json.loads(cand.read_text())
            if old.get("stamp") == stamp:
                gs = old["groups"]
                if only is not None and cand == full:
                    gs = [g for g in gs if needed(g)]
                return gs, stamp
    groups = get_json(f"{TCG}/tcgplayer/{cat}/groups")["results"]
    if only is not None:        # otros juegos: bajar solo los sets que la tienda tiene
        groups = [g for g in groups if needed(g)]

    def one(g):
        gid = g["groupId"]
        prods = get_json(f"{TCG}/tcgplayer/{cat}/{gid}/products")["results"]
        prices = {}
        for p in get_json(f"{TCG}/tcgplayer/{cat}/{gid}/prices")["results"]:
            if p.get("marketPrice"):
                prices.setdefault(p["productId"], {})[p["subTypeName"]] = p["marketPrice"]
        rows = []
        for p in prods:
            ext = {e["name"]: e["value"] for e in p.get("extendedData") or []}
            if ext.get("Number"):
                rows.append([p["productId"], p["name"], ext["Number"], prices.get(p["productId"], {}), ext.get("Rarity") or ""])
        return {"id": gid, "name": g["name"], "year": (g.get("publishedOn") or "")[:4], "abbr": g.get("abbreviation") or "", "products": rows}

    with ThreadPoolExecutor(max_workers=4) as ex:
        out = list(ex.map(one, groups))
    f.write_text(json.dumps({"stamp": stamp, "groups": out}, ensure_ascii=False, separators=(",", ":")))
    print(f"TCGplayer categoría {cat}: {len(out)} sets, {sum(len(g['products']) for g in out)} cartas con precio")
    return out, stamp


PAREN = re.compile(r"\(([^)]*)\)")


def words(s):
    """Normaliza para comparar nombres: sin acentos ni signos, 'and' fuera, pokeball = poke ball."""
    s = norm((s or "").replace("'", "").replace("\u2019", "")).replace("pokeball", "poke ball").replace("masterball", "master ball")
    return " ".join(w for w in s.split() if w not in ("and", "the", "pattern"))


def split_number(n):
    a, _, b = n.partition("/")
    return normnum(a.strip()), normnum(b.strip())


def build_index(groups):
    idx = {}
    for g in groups:
        gname = words(g["name"].split(": ", 1)[-1])     # "SV: Scarlet & Violet 151" -> "scarlet violet 151"
        for pid, name, number, prices, rarity in g["products"]:
            head = name.split(" - ")[0]
            entry = {"name": " ".join(PAREN.sub(" ", head).split())}
            if words(entry["name"]):
                idx.setdefault(("w", words(entry["name"]).split()[0]), []).append(entry)   # para buscar por nombre
            idx.setdefault(split_number(number), []).append(entry)
            entry.update({
                "pid": pid, "base": words(PAREN.sub(" ", head)),
                "tags": [words(t) for t in PAREN.findall(head) if words(t)],
                "group": gname, "year": g["year"], "prices": prices, "rarity": rarity,
            })
    return idx


def candidates(idx, card):
    """Productos de TCGplayer con el mismo número y nombre, del más al menos parecido."""
    title = words(card["title"])
    context = words(card["set"] + " " + card["title"])
    if not card["number"]:       # títulos sin número (Magic): "<nombre> [Foil] <set>" -> el nombre es el comienzo
        out = [c for c in idx.get(("w", title.split()[0] if title else ""), [])
               if c["group"] and c["group"] in context and (title == c["base"] or title.startswith(c["base"] + " "))]
        longest = max((len(c["base"]) for c in out), default=0)
        return [(0, c, True) for c in out if len(c["base"]) == longest]
    cands = idx.get(split_number(card["number"]), [])
    base = words(card["card"])
    if not base or not cands:
        return []
    scored = []
    for c in cands:
        if c["base"] != base and not (c["base"].split()[:1] == base.split()[:1] and (c["base"] in base or base in c["base"])):
            continue
        gm = bool(c["group"]) and c["group"] in context
        score = (2 if c["base"] == base else 0)
        score += sum(2 if t in title else -2 for t in c["tags"])     # variantes: Master Ball, Cosmos Holo...
        score += 3 if gm else 0
        score += 1 if c["year"] and c["year"] == card["year"] else 0
        scored.append((score, c, gm))
    scored.sort(key=lambda x: -x[0])
    return scored


def find_product(idx, card):
    """Para precios: exige número con total impreso y que no haya empate entre productos distintos."""
    if "/" not in card["number"]:
        return None
    scored = [x for x in candidates(idx, card) if x[1]["prices"]]
    if not scored:
        return None
    if len(scored) > 1 and scored[0][0] == scored[1][0] and scored[0][1]["prices"] != scored[1][1]["prices"]:
        return None              # empate entre productos distintos: mejor no comparar que comparar mal
    return scored[0][1]


SIN_RAREZA = ("", "None", "Classic Collection")     # reimpresiones sin símbolo de rareza propio
BASICAS = ("Common", "Uncommon", "Rare")


def original_rarity(idx, card, year=""):
    """Reimpresiones sin rareza impresa (high class japoneses, espejos Quick Ball / Friend Ball,
    Pokémon TCG Classic): se usa la rareza de la carta original, buscándola por nombre."""
    a, _, b = card["number"].partition("/")
    if a.strip().isdigit() and b.strip().isdigit() and int(a) > int(b):
        return ""                # las secretas tienen su propia rareza: no adivinar
    base = words(card["card"])
    if not base:
        return ""
    count, prev = {}, []
    for c in idx.get(("w", base.split()[0]), []):
        if c["base"] == base and c["rarity"] in BASICAS:
            count[c["rarity"]] = count.get(c["rarity"], 0) + 1
            if year and c["year"] and c["year"] <= year:
                prev.append((c["year"], c["rarity"]))
    best = sorted(count.items(), key=lambda x: -x[1])
    if not best:
        return ""
    if len(best) == 1 or best[0][1] > best[1][1]:
        return best[0][0]        # la rareza más habitual de esa carta
    if prev:                     # empate: vale la impresión anterior más cercana (la que se reimprimió)
        last = max(y for y, _ in prev)
        near = {r for y, r in prev if y == last}
        if len(near) == 1:
            return near.pop()
    return ""


TIERS = BASICAS + ("Holo Rare", "Double Rare", "Triple Rare")
SUFIJOS = ("v", "vmax", "vstar", "gx", "ex")


def name_rarity(idx, card):
    """Cartas chinas: numeración propia, pero son reimpresiones de cartas japonesas.
    Se busca la carta japonesa cuyo nombre es el comienzo del título y se usa su rareza más habitual."""
    a, _, b = card["number"].partition("/")
    if a.strip().isdigit() and b.strip().isdigit() and int(a) > int(b):
        return ""                # secretas: no adivinar
    title = words(card["title"])
    if title.startswith("pokemon "):
        title = title[8:]
    if not title:
        return ""
    pool = [c for c in idx.get(("w", title.split()[0]), [])
            if c["base"] and (title == c["base"] or title.startswith(c["base"] + " "))]
    longest = max((len(c["base"]) for c in pool), default=0)
    for w in title.split()[1:]:  # nombre con V, VMAX, VSTAR, GX o ex y número normal: siempre es RR / RRR
        if any(ch.isdigit() for ch in w):
            break
        if w in SUFIJOS:
            return "Double Rare"
    count = {}
    for c in pool:
        if len(c["base"]) == longest and c["rarity"] in TIERS:
            count[c["rarity"]] = count.get(c["rarity"], 0) + 1
    best = sorted(count.items(), key=lambda x: -x[1])
    if not best or (len(best) > 1 and best[0][1] == best[1][1]):
        return ""
    return best[0][0]


def secret_rarities(idx, card):
    """Cartas chinas con número secreto (132/127): rarezas especiales (AR, SR, SAR...) que tiene la carta
    japonesa del mismo nombre. Devuelve (rarezas, si el nombre lleva V / ex / GX)."""
    title = words(card["title"])
    if title.startswith("pokemon "):
        title = title[8:]
    if not title:
        return set(), False
    sufijo = False
    for w in title.split()[1:]:
        if any(ch.isdigit() for ch in w):
            break
        sufijo = sufijo or w in SUFIJOS
    pool = [c for c in idx.get(("w", title.split()[0]), [])
            if c["base"] and (title == c["base"] or title.startswith(c["base"] + " "))]
    longest = max((len(c["base"]) for c in pool), default=0)
    return {c["rarity"] for c in pool if len(c["base"]) == longest and c["rarity"] not in TIERS
            and c["rarity"] not in SIN_RAREZA and c["rarity"] != "Promo"}, sufijo


def find_rarity(idx, card):
    """Para rarezas: alcanza con que los mejores candidatos coincidan en la rareza."""
    scored = candidates(idx, card)
    if not scored:
        return "", None
    top = [x for x in scored if x[0] == scored[0][0]]
    if "/" not in card["number"] and not top[0][2]:
        return "", None          # sin total impreso hace falta que coincida el set
    rs = {x[1]["rarity"] for x in top if x[1]["rarity"] not in SIN_RAREZA}
    if len(rs) == 1:
        return rs.pop(), top[0][1]["name"]
    if not rs and card["number"]:
        return original_rarity(idx, card, top[0][1]["year"]), None
    return "", None


def pick_price(prices, card):
    """Elige el acabado de TCGplayer que corresponde a la carta de la tienda."""
    title = words(card["title"])
    subs = list(prices)
    if card["finish"] == "Reverse Holo" or "reverse" in title:
        subs = [s for s in subs if "Reverse" in s]
    else:
        subs = [s for s in subs if "Reverse" not in s]
        first = [s for s in subs if "1st Edition" in s]
        if "1st edition" in title or "1st ed" in title:
            subs = first
        elif len(first) < len(subs):
            subs = [s for s in subs if s not in first]
        holo = [s for s in subs if "Holofoil" in s]
        plain = [s for s in subs if "Holofoil" not in s]
        wants_holo = card["finish"] in ("Holo", "Cosmos Holo", "Master Ball", "Poké Ball")
        subs = (holo or plain) if wants_holo else (plain or holo)
    return (subs[0], prices[subs[0]]) if subs else None


# -------------------------------------------------------------------- dólar
def dolar_oficial():
    try:
        d = get_json("https://dolarapi.com/v1/dolares/oficial")
        return float(d["venta"]), "dolarapi.com"
    except Exception:
        d = get_json("https://api.bluelytics.com.ar/v2/latest")
        return float(d["oficial"]["value_sell"]), "bluelytics.com.ar"


# ------------------------------------------------------------------ cifrado
def encrypt(data, password):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=SALT, iterations=ITERATIONS).derive(password.encode())
    iv = os.urandom(12)
    return iv + AESGCM(key).encrypt(iv, data, None)


def main():
    password = os.environ.get("PRECIOS_CLAVE", "").strip()
    if not password:
        print("AVISO: falta el secreto PRECIOS_CLAVE. No genero el comparador de precios.")
        return
    cards = json.loads(CARDS.read_text())
    cards = cards["cards"] if isinstance(cards, dict) else cards
    usd, fuente = dolar_oficial()
    print(f"Dólar oficial (venta): ${usd:,.2f} ({fuente})")

    rows, stats, stamp = [], {}, ""
    for (game, lang), cat in CATEGORIES.items():
        mine = [c for c in cards if c["game"] == game and c["lang"] == lang and c["kind"] == "Cartas" and c["price"]]
        if not mine:
            continue
        groups, stamp = load_tcg(cat)
        idx = build_index(groups)
        ok, sin = 0, []
        for c in mine:
            prod = find_product(idx, c)
            hit = pick_price(prod["prices"], c) if prod else None
            if not hit:
                sin.append(c["title"])
                continue
            ok += 1
            rows.append([c["card"], c["set"], c["number"], c["finish"], c["rarity"], lang, c["stock"], c["price"],
                         c["transfer"], round(hit[1], 2), hit[0], c["url"], prod["pid"], c["img"]])
        stats[lang] = [ok, len(mine)]
        print(f"{game} {lang}: {ok} de {len(mine)} cartas comparadas con TCGplayer")
        for t in sin[:: max(1, len(sin) // 15)][:15]:
            print("   sin precio:", t)

    payload = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "tcg_updated": stamp,
               "usd": usd, "usd_source": fuente, "stats": stats, "total": len(cards),
               "cols": ["card", "set", "number", "finish", "rarity", "lang", "stock", "ars", "transfer", "tcg",
                        "sub", "url", "pid", "img"],
               "rows": rows}
    raw = gzip.compress(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(), mtime=0)
    OUT.write_bytes(encrypt(raw, password))
    print(f"{len(rows)} comparaciones -> {OUT} ({OUT.stat().st_size // 1024} KB, cifrado)")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:      # el comparador nunca debe frenar la actualización del catálogo
        print(f"AVISO: no pude generar el comparador de precios: {e}")
        sys.exit(0)
