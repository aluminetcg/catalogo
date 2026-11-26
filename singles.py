#!/usr/bin/env python3
"""
Índice de cartas para la herramienta de carga rápida (carga.js) -> _site/data/singles/*.json

Usa los mismos datos de TCGplayer que ya baja precios.py (tcgcsv.com, caché diaria en data/tcgcsv/).
Cada archivo trae, por carta: id de TCGplayer (sirve para la foto), nombre, número, set, rareza ya
unificada como en el catálogo y precio de mercado en USD por acabado. No se guarda en el repo:
se arma en cada actualización y se publica junto con la web.
"""
import csv
import gzip
import io
import json
import re
import sys
import time
from pathlib import Path

import requests

from crawl import unify
from precios import load_tcg, dolar_oficial

HERE = Path(__file__).parent
OUT = HERE / "_site" / "data" / "singles"
CATS = {"en": 3, "jp": 85, "mtg": 1}   # Pokémon inglés y japonés, y Magic, en TCGplayer


def norm_set(s):
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def fotos_tienda():
    """Fotos de las publicaciones que ya tenés: '1990 Impel Marvel Universe #19 - Mister Fantastic' -> (set, número) -> foto."""
    out = {}
    try:
        for r in json.loads((HERE / "data" / "cards.json").read_text(encoding="utf-8"))["cards"]:
            m = re.match(r"^(.*?) #(\S+) - (.+)$", r.get("title", ""))
            if m and r.get("img") and r.get("game") == "Marvel y DC":
                k = (norm_set(m.group(1)), m.group(2).lower())
                if k not in out or r.get("stock"):
                    out[k] = r["img"]
    except Exception as e:
        print(f"AVISO: sin fotos de la tienda ({e})")
    return out


def manual(carpeta="chino", key="cn", titulo="Base china"):
    """Bases armadas a mano (chino, Marvel y DC): data/<carpeta>/*.txt ('# set: Nombre' + líneas 'número|nombre|rareza').
    Si el mismo número de un set aparece en varios archivos, gana el más nuevo (por nombre de archivo)."""
    porset = {}
    fotos = fotos_tienda() if key == "mv" else {}
    for f in sorted((HERE / "data" / carpeta).glob("*.txt")):
        s = None
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.lower().startswith("# set:"):
                s = line.split(":", 1)[1].strip()
            elif line and not line.startswith("#") and s and "|" in line:
                num, name, rz = (line.split("|") + ["", ""])[:3]
                if num.strip() and name.strip():
                    porset.setdefault(s, {})[num.strip().upper() + ("|" + name.strip().upper() if key == "mv" else "")] = (num.strip(), name.strip(), rz.strip())
    sets, cards = [], []
    for gi, s in enumerate(sorted(porset)):
        sets.append([s, ""])
        for k, (num, name, rz) in sorted(porset[s].items()):
            foto = fotos.get((norm_set(s), num.lower()))
            if not foto and fotos:      # títulos viejos con el set abreviado ("1994 SkyBox Batman #54" -> Saga of the Dark Knight)
                ws = set(norm_set(s).split())
                foto = next((v for (ks, kn), v in fotos.items() if kn == num.lower() and set(ks.split()) <= ws), None)
            cards.append([f"{key}|{gi}|{k}", name, num, gi, rz, {}] + ([foto] if foto else []))
    (OUT / f"{key}.json").write_text(json.dumps({"stamp": "", "sets": sets, "cards": cards}, ensure_ascii=False, separators=(",", ":")))
    print(f"{titulo}: {len(cards)} cartas en {len(sets)} sets")
    return len(cards)


def ck_prices():
    """Precios de venta de Card Kingdom (Magic), del archivo diario de MTGJSON, por id de producto de TCGplayer:
    {productId: {"CK Normal": 0.35, "CK Foil": 1.2}}. Caché de un día en data/tcgcsv/ck.json."""
    f = HERE / "data" / "tcgcsv" / "ck.json"
    if f.exists() and time.time() - f.stat().st_mtime < 20 * 3600:
        return {int(k): v for k, v in json.loads(f.read_text()).items()}
    h = {"User-Agent": "AlumineTCG-catalogo/1.0"}
    get = lambda u: gzip.decompress(requests.get(u, headers=h, timeout=600).content)
    precios = json.loads(get("https://mtgjson.com/api/v5/AllPricesToday.json.gz"))["data"]
    ck = {}
    for uuid, fmts in precios.items():
        r = ((fmts.get("paper") or {}).get("cardkingdom") or {}).get("retail") or {}
        val = {}
        for acab, key in (("normal", "CK Normal"), ("foil", "CK Foil"), ("etched", "CK Foil")):
            serie = r.get(acab) or {}
            if serie and key not in val:
                v = serie[max(serie)]          # el día más reciente
                if v:
                    val[key] = round(float(v), 2)
        if val:
            ck[uuid] = val
    del precios
    ids = {}
    try:                                       # CSV chico de identificadores (si no está, el JSON completo)
        rows = csv.DictReader(io.StringIO(get("https://mtgjson.com/api/v5/csv/cardIdentifiers.csv.gz").decode("utf-8")))
        for row in rows:
            if row.get("uuid") in ck:
                ids[row["uuid"]] = (row.get("tcgplayerProductId"), row.get("tcgplayerEtchedProductId"))
    except Exception as e:
        print(f"  sin CSV de identificadores ({e}); uso AllIdentifiers")
        allid = json.loads(get("https://mtgjson.com/api/v5/AllIdentifiers.json.gz"))["data"]
        for uuid, c in allid.items():
            if uuid in ck:
                i = c.get("identifiers") or {}
                ids[uuid] = (i.get("tcgplayerProductId"), i.get("tcgplayerEtchedProductId"))
    out = {}
    for uuid, (tp, te) in ids.items():
        v = ck[uuid]
        if tp and str(tp).isdigit():
            out.setdefault(int(tp), {}).update({k: x for k, x in v.items() if not (te and k == "CK Foil" and "etched" in k)})
        if te and str(te).isdigit() and "CK Foil" in v:
            out.setdefault(int(te), {})["CK Foil"] = v["CK Foil"]
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(out))
    print(f"Card Kingdom: precios de {len(out)} productos")
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"files": {}}
    try:                            # la carga rápida usa el dólar cripto (venta); si no anda, el oficial
        d = requests.get("https://dolarapi.com/v1/dolares/cripto", timeout=30).json()
        meta["usd"], meta["usd_source"], meta["usd_kind"] = float(d["venta"]), "dolarapi.com", "cripto"
    except Exception as e:
        print(f"AVISO: sin dólar cripto ({e}), uso el oficial")
        try:
            meta["usd"], meta["usd_source"] = dolar_oficial()
            meta["usd_kind"] = "oficial"
        except Exception as e:
            print(f"AVISO: sin dólar oficial ({e})")
    print(f"Dólar {meta.get('usd_kind')}: {meta.get('usd')}")
    for key, cat in CATS.items():
        try:
            groups, stamp = load_tcg(cat)
        except Exception as e:      # si falla un juego, que los otros igual se armen
            print(f"AVISO: no pude bajar la categoría {cat} ({e})")
            continue
        ck = {}
        if key == "mtg":
            try:
                ck = ck_prices()
            except Exception as e:
                print(f"AVISO: sin precios de Card Kingdom ({e})")
        sets, cards = [], []
        for g in sorted(groups, key=lambda g: g["year"] or "0000", reverse=True):
            if not g["products"]:
                continue
            gi = len(sets)
            sets.append([g["name"], g["year"]])
            for pid, name, number, prices, rarity in g["products"]:
                rar = unify(rarity, "Magic" if key == "mtg" else "Pokémon", "")[0] if rarity else ""
                p = {k: round(v, 2) for k, v in (prices or {}).items() if v}
                p.update(ck.get(pid, {}))
                cards.append([pid, name, number, gi, rar, p])
        data = {"stamp": stamp, "sets": sets, "cards": cards}
        f = OUT / f"{key}.json"
        f.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
        meta["files"][key] = len(cards)
        print(f"Índice de carga rápida {key}: {len(cards)} cartas en {len(sets)} sets ({f.stat().st_size // 1024} KB)")
    meta["files"]["cn"] = manual()
    meta["files"]["mv"] = manual("marvel", "mv", "Base Marvel y DC")
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:          # nunca frenar la actualización del catálogo por esto
        print(f"AVISO: no pude armar el índice de carga rápida ({e})")
        sys.exit(0)
