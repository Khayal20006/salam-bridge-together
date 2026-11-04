import { SKINS, SKIN_BY } from "@/lib/skins";
import { ArenaClient, type ArenaMode } from "./arena-client";
import { ClientWorld, type DrawSnake } from "./client-world";
import { WORLD, snakeWidth, isSpawnProtected, type Snapshot } from "./engine";
export type GameConfig = {
  quality: "low" | "medium" | "high";
  grid: boolean;
  glow: boolean;
  boostFx: boolean;
  names: boolean;
  minimap: boolean;
  showFps: boolean;
};
type Hooks = {
  config: () => GameConfig;
  profile: () => { name: string; skin: string };
  mode: (mode: ArenaMode) => void;
  count: (count: number) => void;
  score: (score: number) => void;
  fps: (fps: number) => void;
  start: () => void;
  death: (length: number) => void;
  error: (reason: string) => void;
};
const CAPS = { low: 0.75, medium: 1, high: 1.5 };
const DARK = Array.from({ length: 360 }, (_, i) => `hsl(${i},90%,42%)`);
const LIGHT = Array.from({ length: 360 }, (_, i) => `hsl(${i},90%,58%)`);
const FOOD_COLORS = Array.from({ length: 24 }, (_, i) => `hsl(${i * 15},100%,65%)`);
const CELL = 120,
  GRID = Math.ceil((WORLD * 2) / CELL) + 2;
const cell = (v: number) => Math.max(0, Math.min(GRID - 1, Math.floor((v + WORLD) / CELL)));
function path(ctx: CanvasRenderingContext2D, s: DrawSnake, start = 0, end = s.count - 1): void {
  ctx.beginPath();
  ctx.moveTo(s.x[start]!, s.y[start]!);
  for (let i = start + 1; i < end; i++)
    ctx.quadraticCurveTo(
      s.x[i]!,
      s.y[i]!,
      (s.x[i]! + s.x[i + 1]!) / 2,
      (s.y[i]! + s.y[i + 1]!) / 2,
    );
  ctx.lineTo(s.x[end]!, s.y[end]!);
}
function body(ctx: CanvasRenderingContext2D, s: DrawSnake, now: number, fx: boolean): void {
  const skin = SKIN_BY[s.skin] ?? SKINS[0]!,
    w = snakeWidth(s),
    hue = (((s.hue | 0) % 360) + 360) % 360;
  path(ctx, s);
  if (s.boost && fx) {
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = skin.colors[0]!;
    ctx.lineWidth = w * 2 + 14;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = skin.type === "hue" ? DARK[hue]! : skin.colors[0]!;
  ctx.lineWidth = w * 2;
  ctx.stroke();
  if (skin.type === "hue") {
    ctx.strokeStyle = LIGHT[hue]!;
    ctx.lineWidth = w * 1.1;
    ctx.stroke();
  } else if (skin.type === "bands" || skin.type === "pulse") {
    for (let j = 1; j < skin.colors.length; j++) {
      ctx.strokeStyle = skin.colors[j]!;
      ctx.lineWidth = w * 2 * (1 - j / skin.colors.length);
      ctx.stroke();
    }
  } else {
    const shift = skin.type === "flow" || skin.type === "anim" ? Math.floor(now / 100) : 0;
    for (let i = 0; i < s.count - 1; i += 4) {
      path(ctx, s, i, Math.min(s.count - 1, i + 4));
      ctx.strokeStyle = skin.colors[(Math.floor(i / 4) + shift) % skin.colors.length]!;
      ctx.lineWidth = w * 2;
      ctx.stroke();
    }
    path(ctx, s);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = w * 0.45;
    ctx.stroke();
  }
  if (skin.spark && fx) {
    ctx.fillStyle = skin.spark;
    for (let k = 0; k < 4; k++) {
      const i = Math.floor((now / 40 + (k * s.count) / 4) % s.count);
      ctx.fillRect(s.x[i]! - 1.5, s.y[i]! - 1.5, 3, 3);
    }
  }
  for (let side = -1; side <= 1; side += 2) {
    const x = s.x[0]! + Math.cos(s.angle + side * 0.6) * w * 0.6,
      y = s.y[0]! + Math.sin(s.angle + side * 0.6) * w * 0.6;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y, w * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skin.eye ?? "#111";
    ctx.beginPath();
    ctx.arc(
      x + Math.cos(s.angle) * w * 0.15,
      y + Math.sin(s.angle) * w * 0.15,
      w * 0.2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

/** Owns imperative rendering. React/UI, serialization and simulation never run inside loop. */
export function mountGame(
  canvas: HTMLCanvasElement,
  room: string,
  hooks: Hooks,
): { play: () => void; dispose: () => void } {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D dəstəklənmir.");
  const world = new ClientWorld(),
    labels = new Map<string, HTMLCanvasElement>();
  const labelKeys = new Map<string, string>();
  const foodHeads = new Int32Array(GRID * GRID),
    foodNext = new Int32Array(1800);
  foodHeads.fill(-1);
  const sprites = FOOD_COLORS.map((color) => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!,
      gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "#fff");
    gradient.addColorStop(0.25, color);
    gradient.addColorStop(1, "transparent");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
    return c;
  });
  const board = document.createElement("canvas");
  board.width = 388;
  board.height = 456;
  const bg =
    getComputedStyle(document.documentElement).getPropertyValue("--game-bg").trim() || "#0b0f1a";
  const cam = { x: 0, y: 0, z: 0.8 },
    mouse = { x: innerWidth / 2 + 100, y: innerHeight / 2, boost: false };
  let active = false,
    requested = false,
    disposed = false,
    resetCamera = true,
    lastLength = 10;
  let raf = 0,
    last = performance.now(),
    fpsCount = 0,
    fpsSince = last,
    mode: ArenaMode = "connecting";
  let foods: Snapshot["foods"] = [],
    shownScore = 0;
  function receive(snapshot: Snapshot, id: string): void {
    const now = performance.now();
    world.receive(snapshot, id, now);
    foods = snapshot.foods;
    foodHeads.fill(-1);
    for (let i = 0; i < foods.length && i < foodNext.length; i++) {
      const f = foods[i]!,
        key = cell(f.y) * GRID + cell(f.x);
      foodNext[i] = foodHeads[key]!;
      foodHeads[key] = i;
    }
    let meFound = false;
    for (const s of snapshot.snakes) {
      if (s.id === id) {
        meFound = true;
        lastLength = s.len;
        if (requested && !active) {
          active = true;
          requested = false;
          resetCamera = true;
          hooks.start();
        }
      }
      const key = s.name + (s.bot ? "b" : "p");
      if (labelKeys.get(s.id) !== key) {
        const c = document.createElement("canvas");
        c.width = 240;
        c.height = 40;
        const g = c.getContext("2d")!;
        g.font = "600 24px Space Grotesk, sans-serif";
        g.textAlign = "center";
        g.fillStyle = s.id === id ? "#88ffb0" : s.bot ? "#bac4dd" : "#ffe08a";
        g.fillText((s.bot ? "🤖 " : "👤 ") + s.name, 120, 28, 232);
        labels.set(s.id, c);
        labelKeys.set(s.id, key);
      }
    }
    for (const key of labels.keys()) {
      if (!snapshot.snakes.some((s) => s.id === key)) {
        labels.delete(key);
        labelKeys.delete(key);
      }
    }
    if (active && !meFound) {
      active = false;
      requested = false;
      hooks.death(lastLength);
    }
  }
  const client = new ArenaClient(room, {
    state: receive,
    mode: (next) => {
      mode = next;
      world.reset();
      labels.clear();
      labelKeys.clear();
      foods = [];
      foodHeads.fill(-1);
      resetCamera = true;
      if (active) {
        active = false;
        requested = true;
      }
      hooks.mode(next);
    },
    count: hooks.count,
    rejected: (reason) => {
      requested = false;
      hooks.error(reason);
    },
  });
  function steer(): void {
    const dx = mouse.x - innerWidth / 2,
      dy = mouse.y - innerHeight / 2;
    if (dx * dx + dy * dy > 144) world.angle = Math.atan2(dy, dx);
    world.boost = mouse.boost;
  }
  const move = (e: PointerEvent) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    steer();
  };
  const down = (e: PointerEvent) => {
    if (e.target === canvas) {
      mouse.boost = true;
      steer();
    }
  };
  const up = () => {
    mouse.boost = false;
    steer();
  };
  const key = (e: KeyboardEvent) => {
    if (e.code === "Space" && active && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      mouse.boost = e.type === "keydown";
      steer();
    }
  };
  const visibility = () => {
    up();
    last = performance.now();
  };
  addEventListener("pointermove", move);
  addEventListener("pointerdown", down);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
  addEventListener("blur", up);
  addEventListener("keydown", key);
  addEventListener("keyup", key);
  document.addEventListener("visibilitychange", visibility);
  const inputTimer = setInterval(() => {
    if (active) {
      steer();
      client.input(
        world.angle,
        mouse.boost,
        Math.min(2200, Math.max(1600, Math.hypot(innerWidth, innerHeight) / (2 * cam.z) + 200)),
      );
    }
  }, 50);
  // Text/string creation and React state updates are deliberately outside rAF.
  const hudTimer = setInterval(() => {
    if (active) {
      const score = Math.floor(lastLength * 10);
      if (score !== shownScore) {
        shownScore = score;
        hooks.score(score);
      }
    }
    const now = performance.now();
    if (hooks.config().showFps)
      hooks.fps(Math.round((fpsCount * 1000) / Math.max(1, now - fpsSince)));
    fpsCount = 0;
    fpsSince = now;
    const g = board.getContext("2d")!;
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, 194, 228);
    g.fillStyle = "rgba(10,14,30,0.65)";
    g.fillRect(0, 0, 194, 228);
    g.font = "700 13px Space Grotesk, sans-serif";
    g.fillStyle = "#7cf";
    g.fillText("LİDERLƏR", 12, 20);
    const top =
      world.latest?.snakes
        .slice()
        .sort((a, b) => b.len - a.len)
        .slice(0, 10) ?? [];
    g.font = "500 12px Space Grotesk, sans-serif";
    for (let i = 0; i < top.length; i++) {
      const s = top[i]!;
      g.fillStyle = s.id === world.self ? "#8fa" : s.bot ? "#bac4dd" : "#ffe08a";
      g.textAlign = "left";
      g.fillText(`${i + 1}. ${s.name}`, 12, 42 + i * 20, 130);
      g.textAlign = "right";
      g.fillText(String(Math.floor(s.len * 10)), 184, 42 + i * 20);
    }
    g.textAlign = "left";
  }, 250);
  function loop(now: number): void {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const elapsed = Math.max(0, Math.min(100, now - last));
    last = now;
    fpsCount++;
    world.sample(now);
    const cfg = hooks.config(),
      d = Math.min(CAPS[cfg.quality], devicePixelRatio || 1);
    const width = Math.round(innerWidth * d),
      height = Math.round(innerHeight * d);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    let me: DrawSnake | undefined;
    for (let i = 0; i < world.count; i++)
      if (world.pool[i]!.id === world.self) {
        me = world.pool[i];
        break;
      }
    if (me) {
      if (resetCamera) {
        cam.x = me.x[0]!;
        cam.y = me.y[0]!;
        resetCamera = false;
      }
      const k = 1 - Math.pow(0.85, elapsed / (1000 / 60));
      cam.x += (me.x[0]! - cam.x) * k;
      cam.y += (me.y[0]! - cam.y) * k;
      const zoom = Math.max(0.45, 0.95 - Math.sqrt(me.len) * 0.012);
      cam.z += (zoom - cam.z) * (1 - Math.pow(0.97, elapsed / (1000 / 60)));
    }
    const vw = innerWidth / (2 * cam.z) + 70,
      vh = innerHeight / (2 * cam.z) + 70;
    const left = cam.x - vw,
      right = cam.x + vw,
      top = cam.y - vh,
      bottom = cam.y + vh;
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    ctx!.fillStyle = bg;
    ctx!.fillRect(0, 0, width, height);
    ctx!.setTransform(
      d * cam.z,
      0,
      0,
      d * cam.z,
      (innerWidth * d) / 2 - cam.x * d * cam.z,
      (innerHeight * d) / 2 - cam.y * d * cam.z,
    );
    if (cfg.grid) {
      ctx!.strokeStyle = "rgba(120,150,200,0.06)";
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      for (let x = Math.floor(left / 80) * 80; x < right; x += 80) {
        ctx!.moveTo(x, top);
        ctx!.lineTo(x, bottom);
      }
      for (let y = Math.floor(top / 80) * 80; y < bottom; y += 80) {
        ctx!.moveTo(left, y);
        ctx!.lineTo(right, y);
      }
      ctx!.stroke();
    }
    ctx!.strokeStyle = "#e46";
    ctx!.lineWidth = 5;
    ctx!.beginPath();
    ctx!.arc(0, 0, WORLD, 0, Math.PI * 2);
    ctx!.stroke();
    const gx0 = cell(left),
      gx1 = cell(right),
      gy0 = cell(top),
      gy1 = cell(bottom);
    for (let gy = gy0; gy <= gy1; gy++)
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let i = foodHeads[gy * GRID + gx]!; i >= 0; i = foodNext[i]!) {
          const f = foods[i]!;
          if (f.x < left || f.x > right || f.y < top || f.y > bottom) continue;
          const hue = Math.max(0, Math.min(23, f.hue | 0));
          if (cfg.glow) {
            const size = f.r * 2.5;
            ctx!.drawImage(sprites[hue]!, f.x - size, f.y - size, size * 2, size * 2);
          } else {
            ctx!.fillStyle = FOOD_COLORS[hue]!;
            ctx!.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
          }
        }
      }
    ctx!.lineCap = "round";
    ctx!.lineJoin = "round";
    for (let i = 0; i < world.count; i++) {
      const s = world.pool[i]!,
        radius = snakeWidth(s) + 20;
      if (
        s.count < 2 ||
        s.maxX + radius < left ||
        s.minX - radius > right ||
        s.maxY + radius < top ||
        s.minY - radius > bottom
      )
        continue;
      body(ctx!, s, now, cfg.boostFx);
      if (isSpawnProtected(s, world.latest?.tick ?? 0)) {
        ctx!.strokeStyle = "rgba(160,235,255,0.8)";
        ctx!.lineWidth = 2;
        ctx!.beginPath();
        ctx!.arc(s.x[0]!, s.y[0]!, radius - 12, 0, Math.PI * 2);
        ctx!.stroke();
      }
      if (cfg.names) {
        const label = labels.get(s.id);
        if (label) ctx!.drawImage(label, s.x[0]! - 60, s.y[0]! - radius - 10, 120, 20);
      }
    }
    ctx!.setTransform(d, 0, 0, d, 0, 0);
    ctx!.drawImage(board, innerWidth - 210, 16, 194, 228);
    if (cfg.minimap) {
      const x = innerWidth - 80,
        y = innerHeight - 80;
      ctx!.fillStyle = "rgba(10,14,30,0.65)";
      ctx!.beginPath();
      ctx!.arc(x, y, 60, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.strokeStyle = "#e46";
      ctx!.lineWidth = 1;
      ctx!.stroke();
      for (let i = 0; i < world.count; i++) {
        const s = world.pool[i]!;
        ctx!.fillStyle = s.id === world.self ? "#8fa" : "#8ad";
        ctx!.beginPath();
        ctx!.arc(
          x + (s.x[0]! / WORLD) * 60,
          y + (s.y[0]! / WORLD) * 60,
          s.id === world.self ? 3 : 1.5,
          0,
          Math.PI * 2,
        );
        ctx!.fill();
      }
    }
  }
  raf = requestAnimationFrame(loop);
  return {
    play: () => {
      if (active || requested) return;
      const profile = hooks.profile();
      requested = true;
      client.play(profile.name, profile.skin);
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearInterval(inputTimer);
      clearInterval(hudTimer);
      client.close();
      removeEventListener("pointermove", move);
      removeEventListener("pointerdown", down);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      removeEventListener("blur", up);
      removeEventListener("keydown", key);
      removeEventListener("keyup", key);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
