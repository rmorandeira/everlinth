import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { GameServer } from "./game.js";
import { listScreenCoords } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = express();

// Mapa de administración: qué pantallas del mundo ya han sido exploradas/generadas.
// Nota MVP: sin autenticación todavía; pensado solo para uso local del admin.
app.get("/admin/screens.json", (_req, res) => {
  res.json(listScreenCoords());
});

app.get("/admin", (_req, res) => {
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Mapa del mundo (admin)</title>
<style>
  body { margin:0; background:#111; display:flex; align-items:center; justify-content:center; height:100vh; }
  canvas { background:#fff; }
</style>
</head>
<body>
<canvas id="c" width="2000" height="1000"></canvas>
<script>
  const CELL = 20;
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const originX = canvas.width / 2;
  const originY = canvas.height / 2;

  function draw(cells) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#333';
    for (let x = 0; x <= canvas.width; x += CELL) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
    for (let y = 0; y <= canvas.height; y += CELL) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
    ctx.fillStyle = '#4caf6d';
    for (const { sx, sy } of cells) {
      ctx.fillRect(originX + sx * CELL, originY + sy * CELL, CELL, CELL);
    }
  }

  async function refresh() {
    const res = await fetch('/admin/screens.json');
    draw(await res.json());
  }
  refresh();
  setInterval(refresh, 3000);
</script>
</body></html>`);
});

const clientDist = path.join(__dirname, "..", "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const game = new GameServer();

wss.on("connection", (socket) => game.handleConnection(socket));

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  console.log(`Mapa admin en http://localhost:${PORT}/admin`);
});
