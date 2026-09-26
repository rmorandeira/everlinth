# Migración del cliente de Everlinth a Godot 4

## Estado (2026-09-26)

Fases 0-7 hechas y verificadas con capturas (ciudad, pixel art procedural para
personas y horda, combate, coches y edificios destructibles, HUD, calidad adaptativa,
catálogo del gestor web con recarga en caliente). Fase 8: ajustes de exportación y
`tools/godot/exportar.bat` listos; falta instalar las plantillas de exportación para
generar los ejecutables. Pendientes menores: afinar la noche, recorte translúcido de
farolas y semáforos, pestaña "Vista Godot" en el gestor, generación por IA (clave).

## Objetivo

Pasar el juego (el cliente) de three.js en el navegador a **Godot 4**, para soportar la
carga visual prevista: edificios texturizados, muchos más assets en pantalla,
destrucción de edificios con física, hordas mayores.

Se mantiene:

- **El servidor Node** (`server/`): mundo persistente, generación de ciudad
  (MapGenerator), zombis, disparos, jugadores, SQLite. Sigue siendo la autoridad.
- **El protocolo WebSocket JSON** (`shared/src/index.ts`): Godot habla los mismos
  mensajes (`join`, `input`, `shoot`, `screen`, `zombies`, `shot`…).
- **El gestor de assets web** (`/admin/assets`): sigue siendo la fuente de verdad del
  catálogo. Godot lee el catálogo del servidor y se actualiza en caliente cuando se
  edita un asset desde la web.

Se rehace: el cliente del juego (render, entrada, HUD, audio) como proyecto Godot en
`godot/`. El cliente web actual sigue funcionando hasta que Godot lo iguale.

## Multiplataforma

| Plataforma | Renderizador Godot | Nivel visual |
|---|---|---|
| Windows / Linux / macOS (y Steam Deck) | Forward+ (Vulkan / D3D12 / Metal) | Completo: SSAO, SSIL, niebla volumétrica, sombras, destrucción |
| Android / iOS | Mobile | Reducido (sin SSIL ni niebla volumétrica, menos luces) |
| Web (navegador) | Compatibility (WebGL 2) | Versión ligera: sin SSAO/SSIL/niebla volumétrica, pocas luces dinámicas |
| Consolas | Mediante empresas de port (p. ej. W4 Games) | Completo, requiere licencias de cada consola |

- **Objetivo principal: escritorio.** Móvil y web quedan como versiones ligeras
  opcionales, con los mismos scripts y ajustes de calidad por plataforma.
- **macOS:** distribuirlo requiere firmar y notarizar con una cuenta de Apple.

## Decisiones técnicas

- **Lenguaje:** GDScript. Exporta a todas las plataformas (C# no exporta a web), es
  texto plano y se itera rápido. Si algún bucle caliente lo necesita (p. ej. la
  horda), se pasa a GDExtension (C++) más adelante.
- **Protocolo compartido:** `tools/godot/gen-protocol.mjs` genera
  `godot/scripts/net/protocol.gd` a partir de `shared/src/index.ts` (constantes:
  `SCREEN_WIDTH`, `TILE_SIZE`, `CITY_ROAD_HALF`, `GUN_FIRE_MS`, etc.) para que no se
  desincronicen.
- **Red:** `WebSocketPeer` para el juego y `HTTPRequest` para el catálogo y los
  modelos.
- **Unidades:** las mismas que hoy (1 unidad = 3 m, tile = 0,5, sala de 48×27
  tiles). Cámara `Camera3D` ortográfica con el mismo yaw de 45°, pitch de 21°,
  desplazamiento al 40 % desde abajo, deriva y giro Q/R.
- **Física:** Jolt, integrado en Godot desde la 4.4. Solo es cosmética en el
  cliente (escombros, ruedas, capós). Lo que importa para el juego (colisiones,
  estado de edificios) lo decide el servidor.

## Assets: web como fuente de verdad, Godot como consumidor

1. **Catálogo.**
   - Al arrancar, Godot descarga `/assets.json` (categoría, biomas, texturas,
     sockets, partes primitivas, fuente GLB/procedural/primitivas).
   - Cuando se guarda un asset en la web, el servidor emite por WebSocket
     `assetsChanged { id }` y Godot recarga solo ese asset, sin reiniciar.
2. **Modelos GLB.**
   - Los kits de Kenney se incluyen importados en el proyecto (lo más rápido).
   - Un GLB nuevo subido desde la web se descarga y se carga en tiempo de ejecución
     con `GLTFDocument`, cacheado en `user://assets/`. Así un asset nuevo aparece en
     el juego sin recompilar.
3. **Texturas.** Los parámetros del editor web (repetición, desplazamiento, rotación
   y proyección "box") se traducen a `StandardMaterial3D`: `uv1_scale`, `uv1_offset`
   y triplanar para "box".
4. **Partes primitivas.** Caja, cilindro, cono, esfera, tejado a dos aguas y
   pirámide se reconstruyen en Godot con los mismos parámetros que en la web.
5. **Fidelidad de la vista previa.** El editor web sigue con three.js. Si la vista
   previa difiere demasiado de lo que se ve en el juego, se añade al editor una
   pestaña "Vista Godot": una exportación web pequeña de Godot en un iframe que
   pinta el asset con el mismo código que el juego.
6. **Generación por IA.** Sigue pendiente de la clave (`ANTHROPIC_API_KEY` en
   `server/.env`). Produce JSON de partes primitivas que consumen igual la web y
   Godot.

## Fases

Cada fase termina con una verificación antes de pasar a la siguiente.

- **Cómo se verifica:** Godot se lanza desde la línea de comandos con un script de
  captura que guarda PNG del viewport, y se revisan las capturas.
- **En paralelo:** se prueba con el cliente web conectado al mismo servidor.

### Fase 0: preparación

- Instalar el editor de Godot 4 (versión estable más reciente, edición estándar sin
  .NET) fuera del repo.
- Crear el esqueleto de `godot/`: `project.godot` y la estructura
  `scenes/ scripts/ assets/ shaders/`.
- Crear el generador de protocolo (`tools/godot/gen-protocol.mjs`).
- Cambios en el servidor:
  - CORS para `/assets.json`, `/models/*` y `/textures/*`.
  - Mensaje `assetsChanged`.
  - URL del servidor configurable en el cliente.
- Crear el script de captura (`godot/tools/capture.gd`) para verificar sin mirar la
  pantalla.
- **Verificación:** el proyecto abre y la captura muestra una escena vacía con la
  cámara isométrica.

### Fase 1: conexión y mundo mínimo

- Pantalla de login y `join`, recepción de `screen`/`joined`/`youUpdate`/
  `playerUpdate`.
- Suelo por tiles (MultiMesh) de la sala actual y sus vecinas, con movimiento
  continuo entre salas.
- Personaje provisional moviéndose con teclado y mando, con las direcciones
  remapeadas según el giro de cámara.
- Cámara con Q/R, deriva y encuadre del personaje al 40 %.
- **Verificación:** andar y cruzar salas. El cliente web muestra el mismo jugador en
  la misma posición.

### Fase 2: ciudad

1. **Calles.**
   - Calzadas y bordillos como cintas `ArrayMesh` generadas a partir del `CityData`
     vectorial.
   - Tonos de asfalto por calle y discos de unión.
2. **Marcas viales.**
   - Las texturas procedurales de `roadTextures.ts` se hornean una vez a PNG desde
     el cliente web (página de herramienta) y se incluyen en el proyecto.
   - Se pintan discontinuas por longitud de arco (`s0`), doble amarilla, pasos de
     peatones, STOP y flechas.
3. **Decals.** Godot los trae de serie (`Decal`): aceite, frenadas, parches, charcos
   y zonas gastadas.
4. **Edificios.** Kenney ajustado a la parcela (OBB, orientado a la calle más
   cercana, estirado por plantas), según el catálogo.
5. **Ventanas iluminadas.** Un script de post-importación marca los vidrios (mismo
   criterio de color y agrupación por paño) en un canal de vértice. Un shader los
   enciende según la hora.
6. **Mobiliario.**
   - Farolas cobra de NYC y semáforos con fases de 16 s y señales peatonales.
   - Árboles, bancos y contenedores.
7. **Coches aparcados.** MultiMesh.
- **Verificación:** capturas equivalentes a las del cliente web en el mismo punto de
  la ciudad.

### Fase 3: personajes y horda

- **Personaje estilizado:** escena `.tscn` con `AnimationPlayer` (andar, disparar,
  morir).
- **Zombis:** animación horneada en textura (VAT) y dibujada con
  `MultiMeshInstance3D`. Cada zombi recibe su fotograma y variante por datos de
  instancia. Son zombis 3D reales (no sprites), con miles por llamada de dibujo.
- **Gigantes y cadáveres:** usan el mismo sistema, en un MultiMesh aparte.
- **Siluetas tras edificios:** pase con prueba de profundidad invertida.
- **Verificación:** 180+ zombis y cadáveres acumulados a 60 FPS en el equipo del
  usuario.

### Fase 4: combate

- **Disparo:** con ratón (apuntar al cursor) y mando (gatillo derecho más stick
  derecho en círculo), con la misma cadencia que el servidor.
- **Efectos del arma:**
  - Trazadoras finas y discontinuas.
  - Fogonazo con `SpotLight3D`/`OmniLight3D` real, que ilumina calle y fachadas.
  - Humo (`GPUParticles3D`), rebotes con parábola e impactos.
- **Coches destructibles:** sacudida, ruedas y capó como `RigidBody3D` (Jolt),
  explosión, restos y fuego.
- **Audio:** ametralladora troceada más cola, pasos y risa tras la racha.
- **Verificación:** combate completo contra la horda.

### Fase 5: aspecto y HUD

- **Iluminación y efectos de entorno:**
  - `WorldEnvironment` con SSAO, SSIL, glow y niebla volumétrica.
  - Sol y luna según la hora, noche legible.
- **Efectos de pantalla:**
  - Tilt-shift de maqueta como `CompositorEffect` o pase de pantalla completa.
  - Aberración, calor y viñeta.
- **Visibilidad:** la banda de la pantalla alrededor del personaje (70 % de ancho,
  desde su línea hacia abajo) vuelve translúcidos los edificios, mediante un
  uniform global de shader con el mismo difuminado.
- **Calidad adaptativa:**
  - Escalado 3D (FSR 2), SSAO/SSIL/glow conmutables y tamaño y frecuencia de
    sombras.
  - Objetivo de 30 FPS como mínimo en cualquier escena.
- **HUD:** minimapa, medidor de FPS, interruptor de zombis, control deslizante de
  hora, vida y XP.
- **Verificación:** paridad visual con el cliente web o mejor.

### Fase 6: novedades (lo que motivó el cambio)

1. **Edificios texturizados.** Materiales de fachada por asset, definidos en el
   gestor web.
2. **Destrucción de edificios.**
   - **Servidor:**
     - Vida por edificio y estados de daño.
     - Mensajes `buildingDamaged`/`buildingCollapsed`.
     - Las teselas del edificio pasan a escombro transitable o bloqueado.
     - Persistencia en SQLite.
   - **Cliente:**
     - Edificios modulares por plantas y tramos.
     - Trozos pre-fracturados: fractura Voronoi en importación o generada al
       vuelo y cacheada.
     - Los trozos son `RigidBody3D` de Jolt; los que se quedan quietos pasan a
       estáticos.
     - Polvo y humo.
3. **Rendimiento con mucha carga.** `VisibilityRange` (LOD por distancia),
   `OccluderInstance3D` (descarte por oclusión), MultiMesh para todo lo repetido.
- **Verificación:** derribar un edificio a tiros o con explosiones sin bajar de
  30 FPS. El derrumbe persiste para los demás jugadores.

### Fase 7: gestor de assets conectado a Godot

- Consumo completo del catálogo (sección "Assets" arriba): recarga en caliente, GLB
  en tiempo de ejecución, texturas y primitivas.
- Sockets del catálogo usados para ensamblar piezas: plantas de edificio, carteles,
  etc.
- Opcional: pestaña "Vista Godot" en el editor web.
- Generación por IA conectada (Claude con visión → JSON de primitivas).
- **Verificación:** se edita un asset en `/admin/assets`, se guarda y el cambio
  aparece en el juego Godot en marcha.

### Fase 8: exportación y retirada del cliente web

- **Exportación:**
  - Descargar las plantillas de exportación (≈1 GB, solo hacen falta aquí).
  - Crear los presets de Windows, Linux y macOS; web ligera opcional.
- **Servidor:** URL de producción configurable. Descargas del juego servidas desde
  el backoffice.
- **Retirada del cliente web:** cuando Godot lo iguale, se retira el cliente
  three.js del juego. Se conservan `/admin/assets` y el resto del backoffice.

## Riesgos

- **Volumen de trabajo:** es reescribir el cliente entero. Se mitiga por fases, con
  el cliente web operativo mientras tanto.
- **Shaders:** se pasan de GLSL con `onBeforeCompile` al lenguaje de shaders de
  Godot (difuminado de visibilidad, ventanas, sprites). Es trabajo mecánico pero
  delicado.
- **Vista previa web y juego:** pueden verse distintas por usar motores distintos.
  Se mitiga con materiales PBR equivalentes y, si hace falta, la pestaña "Vista
  Godot".
- **Verificación visual:** depende de poder ejecutar Godot en la máquina de
  desarrollo (script de captura).
