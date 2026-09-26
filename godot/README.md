# Everlinth — cliente Godot 4

Cliente nativo del juego (en migración desde `client/`, ver `docs/migracion-godot.md`).
El servidor Node (`server/`) debe estar en marcha.

## Ejecutar

Abrir la carpeta `godot/` con el editor de Godot 4.7 (edición estándar) y pulsar F5,
o desde la línea de comandos:

```bash
godot --path godot
```

Opciones tras `--`:

| Opción | Uso |
|---|---|
| `server=ws://host:3000` | Servidor (por defecto `ws://localhost:3000`) |
| `user=Nombre` | Entra directamente con ese personaje |
| `capture=ruta.png capture_after=4` | Guarda una captura tras N segundos de partida y sale |
| `walk=NE` | Mantiene pulsadas esas direcciones de pantalla (pruebas) |

## Controles

WASD / flechas / stick izquierdo: mover · Q / R: girar la cámara 90° · F3: FPS.

## Protocolo

`scripts/net/protocol.gd` se genera a partir de `shared/src/index.ts`:

```bash
npm run build --workspace=shared && node tools/godot/gen-protocol.mjs
```
