#!/usr/bin/env python3
"""
Índice de cartas para la herramienta de carga rápida (carga.js) -> _site/data/singles/*.json

Usa los mismos datos de TCGplayer que ya baja precios.py (tcgcsv.com, caché diaria en data/tcgcsv/).
Cada archivo trae, por carta: id de TCGplayer (sirve para la foto), nombre, número, set, rareza ya
unificada como en el catálogo y precio de mercado en USD por acabado. No se guarda en el repo:
se arma en cada actualización y se publica junto con la web.
"""
import json
import sys
from pathlib import Path

from crawl import unify
from precios import load_tcg, dolar_oficial

HERE = Path(__file__).parent
OUT = HERE / "_site" / "data" / "singles"
CATS = {"en": 3, "jp": 85}          # Pokémon inglés y japonés en TCGplayer


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"files": {}}
    try:
        meta["usd"], meta["usd_source"] = dolar_oficial()
    except Exception as e:
        print(f"AVISO: sin dólar oficial ({e})")
    for key, cat in CATS.items():
        groups, stamp = load_tcg(cat)
        sets, cards = [], []
        for g in sorted(groups, key=lambda g: g["year"] or "0000", reverse=True):
            if not g["products"]:
                continue
            gi = len(sets)
            sets.append([g["name"], g["year"]])
            for pid, name, number, prices, rarity in g["products"]:
                rar = unify(rarity, "Pokémon", "")[0] if rarity else ""
                p = {k: round(v, 2) for k, v in (prices or {}).items() if v}
                cards.append([pid, name, number, gi, rar, p])
        data = {"stamp": stamp, "sets": sets, "cards": cards}
        f = OUT / f"{key}.json"
        f.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
        meta["files"][key] = len(cards)
        print(f"Índice de carga rápida {key}: {len(cards)} cartas en {len(sets)} sets ({f.stat().st_size // 1024} KB)")
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:          # nunca frenar la actualización del catálogo por esto
        print(f"AVISO: no pude armar el índice de carga rápida ({e})")
        sys.exit(0)
