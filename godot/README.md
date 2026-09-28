# Everlinth — cliente Godot 4

Cliente nativo del juego (en migración desde `client/`, ver `docs/migracion-godot.md`).
El servidor Node (`server/`) debe estar en marcha.

## Ejecutar

Abrir la carpeta `godot/` con el editor de Godot 4.7 (edición estándar) y pulsar F5,
o desde la línea de comandos:

```bash
godot --path godot
```

Opciones tras `--` (lista completa en [docs/PRUEBAS.md](../docs/PRUEBAS.md)):

| Opción | Uso |
|---|---|
| `server=ws://host:3000` | Servidor (por defecto `ws://localhost:3000`) |
| `user=Nombre` | Entra directamente con ese personaje |
| `capture=ruta.png capture_after=4` | Guarda una captura tras N segundos de partida y sale |
| `walk=NE` | Mantiene pulsadas esas direcciones de pantalla (pruebas) |

## Controles

- Mover: WASD / flechas / stick izquierdo
- Apuntar: ratón / stick derecho (en círculo alrededor del personaje)
- Disparar: clic izquierdo / gatillo derecho (RT)
- Q / R: girar la cámara 90° · Z: zombis sí/no · F3: FPS · G: explosión de prueba
- Hora del día y Lugar (A Coruña, ciudad generada, campo): arriba a la derecha

## Assets

El catálogo lo manda el gestor web (`/admin/assets`): al guardar un asset el juego
se rehace en caliente (categoría + bioma ciudad deciden qué edificios aparecen; escala,
texturas por ranura y assets de primitivas se aplican tal cual).

## Ejecutables

`tools/godot/exportar.bat [Windows|Linux|macOS|"Web (ligera)"|todo]` → carpeta `build/`.
Necesita las plantillas de exportación de Godot 4.7.2 (≈1,2 GB). La versión web usa
el renderizador Compatibility (sin SSAO ni niebla volumétrica).

## Protocolo

`scripts/net/protocol.gd` se genera a partir de `shared/src/index.ts`:

```bash
npm run build --workspace=shared && node tools/godot/gen-protocol.mjs
```
