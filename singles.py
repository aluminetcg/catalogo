#!/usr/bin/env python3
"""
Índice de cartas para la herramienta de carga rápida (carga.js) -> _site/data/singles/*.json

Usa los mismos datos de TCGplayer que ya baja precios.py (tcgcsv.com, caché diaria en data/tcgcsv/).
Cada archivo trae, por carta: id de TCGplayer (sirve para la foto), nombre, número, set, rareza ya
unificada como en el catálogo y precio de mercado en USD por acabado. No se guarda en el repo:
se arma en cada actualización y se publica junto con la web.
"""
import json
import re
import sys
from pathlib import Path

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
            cards.append([f"{key}|{gi}|{k}", name, num, gi, rz, {}] + ([foto] if foto else []))
    (OUT / f"{key}.json").write_text(json.dumps({"stamp": "", "sets": sets, "cards": cards}, ensure_ascii=False, separators=(",", ":")))
    print(f"{titulo}: {len(cards)} cartas en {len(sets)} sets")
    return len(cards)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"files": {}}
    try:
        meta["usd"], meta["usd_source"] = dolar_oficial()
    except Exception as e:
        print(f"AVISO: sin dólar oficial ({e})")
    for key, cat in CATS.items():
        try:
            groups, stamp = load_tcg(cat)
        except Exception as e:      # si falla un juego, que los otros igual se armen
            print(f"AVISO: no pude bajar la categoría {cat} ({e})")
            continue
        sets, cards = [], []
        for g in sorted(groups, key=lambda g: g["year"] or "0000", reverse=True):
            if not g["products"]:
                continue
            gi = len(sets)
            sets.append([g["name"], g["year"]])
            for pid, name, number, prices, rarity in g["products"]:
                rar = unify(rarity, "Magic" if key == "mtg" else "Pokémon", "")[0] if rarity else ""
                p = {k: round(v, 2) for k, v in (prices or {}).items() if v}
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
