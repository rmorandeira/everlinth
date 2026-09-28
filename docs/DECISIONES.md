# Decisiones de diseño

Registro breve de las decisiones que marcan el proyecto: qué se decidió y por qué. Las
más recientes, arriba.

### Halo de visión: máscara radial en pantalla con silueta (2026-09-28)
- **Qué:** se oculta solo lo que se interpone entre la cámara y el personaje, dentro de un círculo con degradado. Se deja ver el suelo alrededor de sus pies y se dibujan las aristas del edificio oculto. Los objetos pequeños no se tocan.
- **Por qué:** la franja de pantalla anterior volvía translúcido todo lo que caía en ella (farolas y coches incluidos), incluso cuando no tapaba nada.

### Volumetría del Catastro en vez de OpenStreetMap (2026-09-28)
- **Qué:** las 48.465 partes catastrales sustituyen a los edificios de OSM dentro del municipio.
- **Por qué:** en OSM la mayoría de alturas eran estimadas, mientras que el Catastro trae plantas reales y volúmenes escalonados. Es abierto (CC BY 4.0).

### No usar Google Maps 3D (2026-09-28)
- **Qué:** se descarta extraer volumetrías y texturas de Google.
- **Por qué:** sus condiciones de uso lo prohíben. Además, la malla fotogramétrica no separa edificios, trae sombras fijas y pesa demasiado. La alternativa es Catastro, y después LiDAR y ortofoto del IGN.

### Generación de assets con IA fuera de la web (2026-09-27)
- **Qué:** los assets nuevos se crean desde Claude Code con la API del catálogo, no con un botón en la web.
- **Por qué:** la API de Anthropic se factura aparte de la suscripción Claude Pro, y por ahora no se quiere pagar crédito de API.

### Mundo con regiones: A Coruña real, ciudad generada y campo (2026-09-27)
- **Qué:** una región fija del mapa es A Coruña (OSM); otra, el campo; el resto se genera solo. Un desplegable "Lugar" viaja entre ellas.
- **Por qué:** mantener la ciudad real sin perder el mundo infinito generado.

### A Coruña real con OpenStreetMap y relieve (2026-09-27)
- **Qué:** calles, costa, playas y parques de OSM, más el relieve de modelos abiertos.
- **Por qué:** una ciudad reconocible, con costa y cuestas reales.

### Personas como sprites de pixel art procedurales (2026-09-26)
- **Qué:** personaje, horda y paseantes se dibujan como sprites generados en código (8 direcciones y 4 fotogramas).
- **Por qué:** con hordas de cientos, figuras 3D completas no caben en el presupuesto. Los sprites dan un estilo reconocible y variedad infinita.

### Migrar el cliente de three.js a Godot 4 (2026-09-26)
- **Qué:** el cliente del juego pasa a Godot; el servidor Node, el protocolo y el gestor de assets web se mantienen.
- **Por qué:** más carga visual (edificios texturizados, destrucción con física, hordas mayores) y exportación multiplataforma. Plan y estado en `migracion-godot.md`.

### Servidor autoritativo, mundo determinista (2026-09-21)
- **Qué:** el servidor decide todo lo que importa (posiciones, zombis, disparos, daño). La geometría se regenera de forma determinista a partir de la posición.
- **Por qué:** es un mundo persistente y compartido. Solo se guarda el estado (jugadores, daño, salas vistas), no la geometría.
