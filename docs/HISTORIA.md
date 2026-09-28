# Historia del proyecto

Evolución por etapas, a partir del historial de git (`git log`). Cada etapa resume
muchos commits; el detalle está en sus mensajes.

## 1. Prototipo 2D: roguelike por pantallas (21-22 sep 2026)

- **Arranque:** primer esqueleto de servidor y cliente, con un mundo persistente dividido en pantallas y movimiento continuo entre ellas.
- **Mundo y reglas:** tileset raster, rejilla del mundo en 16:9 vista en isométrico y atributos de casilla unificados. Cada sala tiene un análisis de conectividad para que siempre se pueda atravesar.
- **Herramientas:** soporte de mando, despliegue en Railway (Dockerfile) y un backoffice con el mapa de 400 × 400 salas. En él se pintan biomas, hay minimapa y se ajustan la niebla de visión y la aberración cromática.
- **Árboles procedurales 2D:** cacheados pieza a pieza para conservar el viento.

## 2. Salto a 3D con three.js (23-24 sep)

- **Migración por fases:** cámara ortográfica, suelo instanciado, obstáculos, árboles con geometría real, figuras, iluminación, niebla, linterna, zoom dinámico y posproceso.
- **Primera ciudad:** bioma ciudad con calles, aceras, primitivas y mobiliario, y el posproceso de "diorama" (tilt-shift, bloom).

## 3. La ciudad y el combate (25 sep)

- **Salas y calles:** salas de 48 × 27 casillas (1,5 m). La ciudad vectorial sale de MapGenerator (calles curvas por campos tensoriales).
- **Modelos:** los de Kenney (CC0) se ajustan a cada parcela.
- **Combate y horda:** ametralladora con trazadoras, rebotes y sonido; horda de zombis en manadas; cadáveres.
- **Ambiente:** farolas y semáforos de Nueva York con sus fases, ventanas encendidas de noche, charcos y control de la hora.
- **Gestor de assets web** con catálogo autorregistrado y visor 3D.
- **Coches destructibles.**

## 4. Rendimiento y el paso a Godot 4 (26 sep)

- **Rendimiento en three.js:** calidad adaptativa y zombis como sprites horneados.
- **Plan de migración a Godot 4** (`migracion-godot.md`), ejecutado en el día (fases 0-8):
  - protocolo generado desde `shared`;
  - ciudad portada;
  - personas en pixel art procedural;
  - combate, HUD y edificios destructibles con física Jolt;
  - catálogo del gestor web con recarga en caliente;
  - exportación.
- **Mundo vivo:** hordas de cientos; paseantes con pánico, caídas, ayuda y contagio; tráfico real con emergencias.
- **Reglas de la calle** basadas en NYC DOT / MUTCD (`reglas-calle.md`).

## 5. A Coruña real (27 sep)

- **Look realista:** fachadas PBR de ambientCG, asfalto fotográfico y árboles con hojas y cortezas reales.
- **Autovías elevadas** con enlaces en trébol, en las ciudades generadas.
- **Ciudad real** a partir de OpenStreetMap:
  - costa recortada con precisión y coraza del paseo marítimo;
  - playas en desnivel y mar con oleaje;
  - Estadio de Riazor y Palacio de los Deportes.
- **Relieve real** bajo toda la ciudad.
- **Rendimiento:** mar opaco y construcción de la escena de ~1,9 s a ~0,45 s.
- **Assets de calle:** barreras "Detroit" (limpia, con cinta y dañada) y arce de calle.
- **Lugares:** desplegable entre A Coruña y ciudades generadas. Controles, obras y restos en las generadas.
- **Bioma Campo:**
  - carreteras secundarias, pistas y fincas (trigo en 3D, rastrojo, arada, prado);
  - granjas con graneros, silos, molinos, tractores y casas;
  - personajes más rápidos.
- **Generación de assets con IA:** se probó en la web y se retiró (ver DECISIONES).

## 6. Datos oficiales y visión (28 sep)

- **Campo:** postes con tendido eléctrico y telefónico, farolas que se encienden de noche y vallas en las fincas.
- **Volumetría real del Catastro** en A Coruña (48.465 partes de edificio).
- **Árboles** algo más pequeños y que se rompen a balazos.
- **Halo de visión rehecho:** máscara radial en pantalla con degradado y silueta de aristas; solo ocultan los edificios.
- **Documentación del proyecto:** este archivo, ARQUITECTURA, DATOS, ASSETS, PRUEBAS y DECISIONES.

## Pendiente conocido

- **Tejados reales:** con la ortofoto del IGN (PNOA) y alturas exactas con LiDAR.
- **Ejecutables:** falta descargar las plantillas de exportación de Godot (≈1,2 GB).
- **Campo:** sin tráfico ni paseantes; la era de las granjas se dibuja como prado.
- **Colisión:** vallas, barreras y restos son decorativos (se atraviesan).
- **Persistencia:** los árboles rotos y el tráfico son del cliente y se rehacen al recargar la zona.
- **Halo de visión:** las autovías y los árboles se funden sin silueta.

## Cómo mantener este registro

- **Commits:** cada uno describe en su mensaje qué cambia y por qué (en español, con viñetas).
- **Al cerrar una etapa o un cambio grande:**
  - una entrada aquí (fecha y resumen);
  - una decisión en `DECISIONES.md` si hubo que elegir entre alternativas;
  - la documentación del área afectada (`ARQUITECTURA.md`, `DATOS.md`, `ASSETS.md`, `PRUEBAS.md`).
- **Para ver el detalle de un periodo:** `git log --since=2026-09-27 --until=2026-09-28 --format="%ad %s" --date=short`.
