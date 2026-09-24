export type WeatherType = "clear" | "rain" | "snow" | "wind" | "heat";

// Clima determinista por pantalla (puramente visual, no afecta a la partida ni al servidor).
export function pickWeather(sx: number, sy: number): WeatherType {
  const a = sx * 374761393 + sy * 668265263;
  const h = (a ^ (a >>> 13)) >>> 0;
  const roll = h % 100;
  if (roll < 55) return "clear";
  if (roll < 72) return "wind";
  if (roll < 85) return "rain";
  if (roll < 95) return "snow";
  return "heat";
}

interface Particle {
  x: number;
  y: number;
  speed: number;
  size: number;
  drift: number;
  phase: number;
}

// Capa de partículas en HD (sin pixelar), separada del canvas de juego retro.
export class WeatherSystem {
  private particles: Particle[] = [];
  private type: WeatherType = "clear";
  private width = 0;
  private height = 0;
  private time = 0;

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (this.type !== "clear") this.spawn();
  }

  setWeather(type: WeatherType): void {
    if (type === this.type) return;
    this.type = type;
    this.spawn();
  }

  private spawn(): void {
    const counts: Record<WeatherType, number> = { clear: 0, rain: 140, snow: 90, wind: 40, heat: 0 };
    const count = counts[this.type];
    this.particles = Array.from({ length: count }, () => this.randomParticle());
  }

  private randomParticle(): Particle {
    return {
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      speed: 0.5 + Math.random() * 0.5,
      size: 1 + Math.random() * 2.5,
      drift: Math.random() * 2 - 1,
      phase: Math.random() * Math.PI * 2,
    };
  }

  update(dtSeconds: number): void {
    this.time += dtSeconds;
    if (this.type === "rain") {
      const fallSpeed = 900;
      for (const p of this.particles) {
        p.y += fallSpeed * p.speed * dtSeconds;
        p.x += 60 * dtSeconds; // ligero viento lateral
        if (p.y > this.height) {
          p.y = -10;
          p.x = Math.random() * this.width;
        }
      }
    } else if (this.type === "snow") {
      for (const p of this.particles) {
        p.y += 60 * p.speed * dtSeconds;
        p.x += Math.sin(this.time * 1.5 + p.phase) * 20 * dtSeconds;
        if (p.y > this.height) {
          p.y = -10;
          p.x = Math.random() * this.width;
        }
      }
    } else if (this.type === "wind") {
      for (const p of this.particles) {
        p.x += 180 * p.speed * dtSeconds;
        p.y += Math.sin(this.time * 2 + p.phase) * 12 * dtSeconds;
        if (p.x > this.width) {
          p.x = -10;
          p.y = Math.random() * this.height;
        }
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, this.width, this.height);
    if (this.type === "rain") {
      ctx.strokeStyle = "rgba(190, 210, 255, 0.55)";
      ctx.lineWidth = 1.4;
      for (const p of this.particles) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - 4, p.y - 18);
        ctx.stroke();
      }
    } else if (this.type === "snow") {
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      for (const p of this.particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (this.type === "wind") {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 1;
      for (const p of this.particles) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - 14, p.y + 2);
        ctx.stroke();
      }
    }
  }

  getType(): WeatherType {
    return this.type;
  }
}
