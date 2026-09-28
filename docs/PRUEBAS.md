# Cómo se verifica

Cada cambio visual se comprueba con **capturas automáticas**: el juego arranca, entra
con un personaje, espera unos segundos, guarda un PNG y se cierra. Luego se mira la
captura. Para el rendimiento, `bench=1` imprime los tiempos.

## Servidor para pruebas

```bash
cd server && npm run build && DEBUG_WEAPONS=1 node dist/index.js
```

`DEBUG_WEAPONS=1` habilita la explosión de prueba (tecla G) y el teletransporte (`tp`).

## Opciones del cliente (tras `--`)

| Opción | Efecto |
|---|---|
| `user=Nombre` | Entra directamente (mejor un nombre nuevo cada vez: la muerte es permanente) |
| `server=ws://host:3000` | Servidor |
| `capture=ruta.png capture_after=N` | Guarda una captura a los N segundos y sale |
| `hour=H` | Hora del día fija (0-24) |
| `viaje=coruna\|generada\|nueva\|campo` | Viaja a ese lugar al entrar |
| `tp=gx,gy` | Salta a un tile global (con `DEBUG_WEAPONS=1`) |
| `zoom=U` / `cenital=U` | Media altura visible de la cámara / vista cenital |
| `walk=NE` | Mantiene pulsadas esas direcciones |
| `aim=x,y fire=1` | Apunta en esa dirección y dispara sin parar; `aim=0,9` apunta al árbol más cercano |
| `boom=D` | Explosiones de prueba a D casillas en la dirección de mira |
| `bench=1` | Sin sincronía vertical; imprime ms por parte del fotograma, GPU, dibujos y fases de construcción de la ciudad |
| `off=a,b,…` | Apaga efectos para medir: `tilt`, `ssao`, `msaa`, `glow`, `shadow`, `sea`, `beach`, `trees`, `streets`, `lowres` |

Ejemplo:

```bash
godot --path godot -- user=Prueba1 viaje=campo capture=campo.png capture_after=12 hour=13 bench=1
```

## Puntos de prueba habituales

| Sitio | Coordenadas o lugar | Para qué |
|---|---|---|
| Plaza de María Pita | `tp=24,13` | Centro, rendimiento base |
| Centro (Cantones) | `tp=-60,30` | Edificios del Catastro, halo de visión |
| Orzán / Riazor | `tp=-633.5,110.5` | Playa, mar, coraza |
| Monte Alto | `tp=-589,-479.5` | Zona más pesada, cuestas, árboles |
| Ciudad generada | `viaje=generada` | Controles, autovías, halo con modelos del kit |
| Campo | `viaje=campo`, `tp=-6700,86` | Granja; carretera con tendido y farolas |

## Herramientas auxiliares

- **Vista previa de un modelo:** `godot/tools/preview_model.gd` (ver ASSETS.md).
- **Salas del servidor en texto:** se pueden importar los generadores compilados (`server/dist/citygen/*.js`) desde un script de Node y pintar sus casillas en texto.
- **Aviso:** si hay otra ventana del juego abierta, comparte la gráfica integrada y los ms de GPU salen inflados.
