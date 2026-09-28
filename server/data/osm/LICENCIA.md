# Datos de la ciudad

`acoruna.json.gz` se genera con `tools/osm/build-city.mjs` a partir de datos de
OpenStreetMap: © colaboradores de OpenStreetMap, disponibles bajo la licencia
Open Database License (ODbL) — https://www.openstreetmap.org/copyright

La base de datos derivada se distribuye bajo la misma licencia ODbL.

## Relieve (acoruna-dem.bin.gz)

Teselas de elevación "Terrarium" de AWS Terrain Tiles (Registry of Open Data on AWS,
https://registry.opendata.aws/terrain-tiles/), generadas a partir de fuentes abiertas:
SRTM (NASA), Copernicus EU-DEM (© DEM producido con fondos de la Unión Europea) y otras.
Atribución requerida según las licencias de cada fuente.

## Edificios (Catastro)

Dentro del municipio de A Coruña, las plantas de los edificios y su número de plantas
sobre rasante salen del servicio INSPIRE de edificios de la Dirección General del
Catastro (https://www.catastro.hacienda.gob.es), licencia CC BY 4.0:
"Fuente: Dirección General del Catastro". Se incorporan con tools/osm/build-catastro.mjs.
