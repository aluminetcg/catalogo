# Catálogo ALUMINETCG

Buscador de todo el catálogo de la tienda, sin el límite de 24 resultados, con filtros por
rareza, acabado, expansión, año, idioma, tipo, precio y stock. Cada carta lleva a su ficha en
la tienda para comprar.

## Qué hay acá

| Archivo | Para qué |
|---|---|
| `index.html` | La web (un solo archivo, sin instalar nada). |
| `crawl.py` | Baja todos los productos de la tienda y arma `data/cards.json`. |
| `data/cards.json` | Los datos que lee la web. Viene con 25 cartas de muestra. |
| `.github/workflows/actualizar.yml` | Hace que todo se actualice solo cada 2 horas. |

## Ponerla online y que se actualice sola (gratis, con GitHub)

1. Creá una cuenta en github.com y un repositorio **público** nuevo (ej. `catalogo`).
2. Subí todo el contenido de esta carpeta (botón *Add file > Upload files*; arrastrá también la carpeta `.github`).
3. En el repo: **Settings > Pages > Source: GitHub Actions**.
4. En **Actions**, abrí *Actualizar catálogo* y tocá **Run workflow**. Tarda unos 10 a 15 minutos la primera vez.
5. La web queda en `https://TU-USUARIO.github.io/catalogo/`. Desde ahí se actualiza sola cada 2 horas.

Para cambiar la frecuencia, editá la línea `cron` del archivo `actualizar.yml`
(`"17 * * * *"` = cada hora). Para forzar una actualización en el momento: *Run workflow*.

Si querés usar tu propio dominio (ej. `catalogo.aluminetcg.com.ar`), se configura en *Settings > Pages > Custom domain*.

## Probarla en tu computadora

```
pip install requests
python crawl.py --only pokemon-cartas-ingles/1999/base-set    # prueba rápida con una expansión
python crawl.py                                               # toda la tienda
python -m http.server 8000                                    # y abrí http://localhost:8000
```

## Cómo se obtiene la rareza

Empretienda no guarda la rareza. El extractor la saca así:

- **Pokémon en inglés:** cruza nombre + número de cada carta con la base pública
  [pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data). De ahí salen rareza
  (Common, Rare Holo, Double Rare, Illustration Rare...), tipo (Fuego, Agua...) y clase (Pokémon, Entrenador, Energía).
- **Japonés, chino, coreano, One Piece:** usa la sigla que esté en el título (`AR`, `SR`, `SAR`, `RR`, `UC`...).
  Si el título no la trae, la carta queda como "Sin dato". Agregar la sigla al título en Empretienda la hace aparecer.
- **Acabado** (Holo, Reverse Holo, Poké Ball, Master Ball, Foil): siempre sale del título.

## Si algo falla

- El extractor no publica un catálogo incompleto: si baja menos del 70% de lo que había, corta y deja el anterior.
- Si GitHub no puede entrar a la tienda (bloqueo por IP), corré `python crawl.py` en tu compu con una tarea programada y subí `data/cards.json`.
