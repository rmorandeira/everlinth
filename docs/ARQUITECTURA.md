# Arquitectura

## Componentes

```
┌────────────────────┐    WebSocket JSON     ┌──────────────────────────────┐
│  Cliente Godot 4   │ ◄───────────────────► │  Servidor Node (autoridad)   │
│  godot/            │   (protocolo shared)  │  server/                     │
│  render, HUD,      │                       │  mundo, generadores, zombis, │
│  entrada, audio    │ ◄── HTTP /assets.json │  disparos, SQLite            │
└────────────────────┘     /models, /textures└──────────────┬───────────────┘
                                                              │ HTTP
                                              ┌───────────────▼──────────────┐
                                              │ Web: backoffice (/admin) y   │
                                              │ gestor de assets (/admin/assets)
                                              └──────────────────────────────┘
```

- **`shared/`**: tipos y constantes comunes: tamaño de sala, velocidades, tipos de casilla, biomas, lugares y mensajes. El cliente Godot recibe una copia generada en `godot/scripts/net/protocol.gd`, que se crea con `node tools/godot/gen-protocol.mjs` después de compilar `shared`.
- **`server/`**: la única autoridad del juego. Genera cada sala, mueve zombis y paseantes, resuelve los disparos y las explosiones, guarda jugadores, salas y daños en SQLite (`world.db`) y sirve el backoffice y el catálogo.
- **`godot/`**: el cliente. Dibuja lo que manda el servidor, a veces con elementos solo visuales que se deciden en el propio cliente pero salen igual en todos: tráfico, coches y árboles rompibles. También envía la entrada del jugador.
- **`client/`**: el cliente web antiguo (three.js), que sigue como referencia, y el gestor de assets web (`client/admin-assets.html`, `client/src/admin/`).

## El mundo

### Coordenadas

| Magnitud | Valor |
|---|---|
| Casilla (tile) | 1,5 m |
| Sala (pantalla) | 48 × 27 casillas (72 × 40 m) |
| Tile global | `sala × 48 + x`, `sala × 27 + y` (la y crece hacia el sur) |
| Unidad de render (Godot) | 3 m = 2 casillas (`TILE_SIZE = 0.5`) |
| Planta de edificio | 1 unidad (3 m) |

El cliente dibuja siempre la sala actual y sus 8 vecinas. El origen de la escena es la
esquina de la sala actual (`(tile global − origen) × 0,5`).

### Regiones y biomas

| Región (salas) | Lugar | Generador |
|---|---|---|
| x −70…40, y −50…135 (`OSM_REGION`) | A Coruña real | `server/src/citygen/osmcity.ts` |
| x −200…−80 (`COUNTRYSIDE_REGION`) | Campo | `server/src/citygen/countryside.ts` |
| Resto | Ciudad generada | `server/src/citygen/index.ts` (MapGenerator) + `highways.ts` |

Los lugares del desplegable están en `LOCATIONS` (`shared/src/index.ts`). El mensaje
`travel` lleva al personaje a una calle del lugar elegido.

### Qué manda el servidor por sala (`ScreenData`)

- `tiles`: casillas, que sirven para las colisiones y el tipo de suelo.
- `city` (`CityData`): la geometría vectorial.
  - Calles (`roads`, con `ow` sentido único).
  - Edificios (`buildings`: planta, plantas, tipo, nombre y grupo catastral `g`).
  - Cruces (`nodes`), autovías (`highways`) y pilares (`pillars`).
  - En A Coruña: `osm`, `coast`, `sand`, `piers`, `landmarks` y `elev` (rejilla de alturas).
  - En el campo: `rural`, `tracks`, `fields` y `props`.

Casi toda la geometría se regenera de forma determinista cada vez; lo que se guarda en
SQLite es el estado: jugadores, daño de edificios y salas vistas.

### Simulación (servidor, `server/src/game.ts`)

- **Ritmo:** tick de 100 ms. Los mensajes de zombis y paseantes salen a 10 Hz.
- **Zombis:** manadas con cohesión y separación que se reparten en busca de presas. Los disparos los frenan y los empujan.
- **Paseantes:** deambulan por las aceras, entran en pánico, tropiezan, se ayudan y se contagian al ser mordidos.
- **Disparos:** el servidor traza la bala; el mensaje `shot` lleva el origen, el destino y lo que impactó.
- **Explosiones:** dañan edificios (`server/src/buildings.ts`); al derrumbarse, sus casillas quedan libres.

## Cliente Godot

### Escena (`godot/scripts/main.gd`)

Conexión, mensajes, entrada y el bucle de cada fotograma. Al cambiar de sala se
reconstruye la escena de la ciudad (`_build_city`):

1. `Terrain.set_rooms`: el relieve de la escena en una rejilla.
2. `City.build`: calles, marcas, mobiliario y edificios (del kit o reales).
3. `Rural.build`: salas de campo.
4. `Coast.build`: suelo recortado por la costa, muros, playas, mar y árboles de los parques.
5. `Cars`, `Destruction`, `Traffic`, `TreeFall`: estado visual del cliente.

### Módulos de render (`godot/scripts/render/`)

| Módulo | Qué hace |
|---|---|
| `city.gd` | Ciudad vectorial: calzadas, marcas, cruces, mobiliario, aparcamiento, edificios. En las ciudades generadas, controles, obras y restos (`_apocalypse`) |
| `osm_building.gd` | Edificio real extruido con fachada procedural (se funden por sala en una malla) |
| `landmarks.gd` | Estadio de Riazor y Palacio de los Deportes |
| `coast.gd` | Costa por marching squares sobre distancias con signo, muros del paseo, playas y mar |
| `terrain.gd` | Relieve (consulta de alturas) |
| `rural.gd` | Campo: parcelas, trigo por capas, carreteras, pistas, tendido, farolas y vallas |
| `trees.gd` / `tree_fall.gd` | Árboles detallados (racimos de hojas horneados) y su rotura a balazos |
| `kenney.gd` | Modelos del catálogo (GLB del kit, primitivas y assets detallados con PBR) |
| `people.gd` / `pixel_people.gd` | Personas y horda como sprites de pixel art procedurales |
| `traffic.gd` / `cars.gd` | Tráfico cosmético y coches aparcados destructibles |
| `destruction.gd` | Derrumbes (hundimiento, vuelco, corte) y cascotes con física Jolt |
| `occlusion.gd` | Halo de visión del personaje (ver más abajo) |
| `lighting.gd` / `quality.gd` | Día y noche; calidad adaptativa para mantener 30 FPS o más |
| `highways_mesh.gd`, `street_furniture.gd`, `facades.gd`, `fx.gd`, `ground.gd`, `geo_batch.gd`, `iso_camera.gd` | Autovías, mobiliario, fachadas PBR, efectos, suelo, geometría fusionada, cámara |

### Shaders (`godot/shaders/`)

- **Edificios:** `kenney` (modelos) y `osm_building` (edificios reales: estuco, piedra, ladrillo, galerías, ventanas, tejados).
- **Suelo:** `asphalt`, `sidewalk`, `rural_ground` y `wheat` (trigo por capas).
- **Costa:** `coast_pbr`, `sea` y `stadium`.
- **Árboles:** `tree_leaf` y `tree_bark`.
- **Personas:** `people` y `people_ghost`.
- **Efectos y posproceso:** `fx_*`, `lamp_pool`, `puddle` y `tilt_blur` (tilt-shift y gradación).
- **Halo de visión:** `occlusion.gdshaderinc`.

### Halo de visión

Es una máscara radial en espacio de pantalla, centrada en el personaje. Un fragmento se
oculta si cumple dos condiciones:
- cae dentro del círculo;
- está más cerca de la cámara que un punto un poco por detrás del personaje.

El borde se funde con un degradado tramado. De lo oculto se dibujan solo las aristas reales del
modelo: coordenadas baricéntricas por vértice (`ARRAY_CUSTOM1`, `Occlusion.edge_bary`)
con las aristas entre caras coplanarias anuladas.

Solo ocultan los edificios, según su categoría en el catálogo, junto con los hitos, las
autovías elevadas y los árboles, que se funden sin silueta. Farolas, barreras, semáforos,
coches y mobiliario no se tocan. El parámetro por instancia `occluder` marca qué ocultar.

### Rendimiento

- **Instancias agrupadas:** MultiMesh para todo lo repetido.
- **Edificios reales:** fundidos en una malla por sala.
- **Mallas troceadas por sala:** la cámara descarta lo que no ve.
- **Personas:** se suben a la gráfica de una vez en un solo búfer.
- **Tráfico:** rejillas espaciales, para que cada coche solo mire lo que tiene cerca.
- **Mar opaco:** la profundidad del agua sale de una textura precalculada.
- **Calidad adaptativa** (`quality.gd`).

Cifras de referencia en una gráfica integrada AMD a 1280 × 720:
- centro de A Coruña: 100+ FPS;
- Monte Alto: ~55 FPS;
- campo: ~50 FPS.

## Protocolo (resumen)

**Del cliente al servidor:**
- `join`, `input`, `shoot`, `attack` y `pickup`;
- `setZombies` y `travel`;
- de prueba: `debugExplode` y `debugTeleport`.

**Del servidor al cliente:**
- **Partida:** `joined`, `screen`, `youUpdate`, `died`, `error` y `discovery`.
- **Otros jugadores:** `playerUpdate` y `playerLeft`.
- **Horda y población:** `zombies`, `zombieDied`, `kill` y `civilians`.
- **Combate:** `shot`, `explosion` y `buildingDamaged`.
- **Ajustes y catálogo:** `assetsChanged` y `visionSettings`.

Definición exacta: `shared/src/index.ts` (`ClientMessage`, `ServerMessage`).
