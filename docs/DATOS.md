# Datos reales

A Coruña se construye con tres fuentes abiertas, procesadas por herramientas de
`tools/osm/`. El resultado va a `server/data/osm/` (en el repositorio). Las descargas
brutas quedan en carpetas ignoradas por git.

| Paso | Herramienta | Fuente | Salida |
|---|---|---|---|
| 1. Ciudad | `build-city.mjs` | Extracto de OpenStreetMap (Overpass, `out tags geom`) | `acoruna.json.gz` |
| 2. Relieve | `build-dem.mjs` | AWS Terrain Tiles (Terrarium, zoom 14) | `acoruna-dem.bin.gz` |
| 3. Edificios | `build-catastro.mjs` | Catastro INSPIRE Buildings, municipio 15900 | reescribe `acoruna.json.gz` |

## 1. OpenStreetMap → `acoruna.json.gz`

```bash
node tools/osm/build-city.mjs <overpass.json> [salida.json.gz] [lat] [lon]
```

- **Proyección:** equirectangular alrededor de la plaza de María Pita (43.37092, −8.39588), que cae en el centro de la sala (0, 0). 1 casilla = 1,5 m.
- **Calles:** tipo (avenida, principal o menor), sentido único y puentes con su nivel.
- **Otros elementos:**
  - **Edificios:** planta y plantas (`building:levels`, `height` o un valor por tipo).
  - **Costa:** la tierra queda a la izquierda de la línea.
  - **Zonas:** parques (solo usos verdes reales), playas, agua y muelles.
- **Hitos modelados a mano:** estadio de Riazor (posición, tamaño y orientación reales).

## 2. Relieve → `acoruna-dem.bin.gz`

```bash
node tools/osm/build-dem.mjs
```

- **Remuestreo:** las teselas Terrarium se pasan a una rejilla de 4 casillas (6 m) con la misma proyección. La caché queda en `tools/osm/.dem-cache/`.
- **Suavizado:** el servidor desenfoca el relieve para quitar el ruido de edificios y árboles del modelo de superficie, y manda a cada sala una rejilla de alturas cada 3 casillas.

## 3. Catastro → edificios

```bash
node tools/osm/build-catastro.mjs [ciudad.json.gz] [municipio]
```

- **Descarga:** el ZIP INSPIRE del municipio (`A.ES.SDGC.BU.15900.zip`) va a `tools/osm/.catastro/`.
- **Partes de edificio:** cada `BuildingPart` es una planta con su número de plantas sobre rasante. Se reproyectan de UTM 29N (ETRS89) a la rejilla del juego y se descartan patios, bajo rasante y piezas diminutas.
- **Uso:** el uso del edificio (residencial, industrial, oficinas, comercio, público) decide el tipo; con 2 plantas o menos, "casa".
- **Mezcla con OSM:**
  - fuera del municipio se quedan los edificios de OSM;
  - dentro, los sustituyen las partes catastrales, que heredan los nombres de OSM;
  - el Palacio de los Deportes conserva su modelo propio;
  - la Torre de Hércules se fuerza a su altura real (`HEIGHT_OVERRIDE`).

> Ojo: `build-catastro.mjs` **reescribe** `acoruna.json.gz`. Para rehacerlo desde cero,
> primero `build-city.mjs` y luego `build-catastro.mjs`.

## Licencias y atribución

- **OpenStreetMap:** © colaboradores de OpenStreetMap, ODbL. La base derivada se distribuye con la misma licencia.
- **Catastro:** Dirección General del Catastro, CC BY 4.0.
- **Relieve:** SRTM (NASA), Copernicus EU-DEM y otras, vía AWS Terrain Tiles.

El HUD muestra "Mapa © colaboradores de OpenStreetMap · Edificios: Dirección General del
Catastro" en la ciudad real. Ver `server/data/osm/LICENCIA.md`.

## Descartado: Google Maps 3D

Las condiciones de Photorealistic 3D Tiles prohíben extraer, guardar o derivar su
geometría y texturas, y su malla fotogramétrica no separa edificios. Por eso se usan
fuentes abiertas: Catastro, y más adelante el LiDAR y la ortofoto del IGN (PNOA) para
tejados y alturas exactas.
