import { useEffect, useRef, type MutableRefObject } from "react";
import { SKIN_BY, SKINS } from "@/lib/skins";
import type { GameConfig } from "@/lib/game-state";
import { connectArena } from "@/game/connection";
import {
  WORLD,
  SEG,
  snakeWidth,
  isSpawnProtected,
  cloneSnake,
  type Snake,
  type Snapshot,
} from "@/game/engine";
import { interpolateAngle, traceBodyCurve } from "@/game/movement";
import { snapshotIndex } from "@/game/snapshot-index";
import { LocalPrediction } from "@/game/prediction";

type Props = {
  room: string;
  config: GameConfig;
  startRef: MutableRefObject<() => void>;
  profile: () => { name: string; skin: string };
  onStart: () => void;
  onDeath: (length: number) => void;
  onInterrupted: () => void;
  onScore: (score: number) => void;
  onCount: (count: number) => void;
  onFps: (fps: number) => void;
  onStatus: (status: "connecting" | "online" | "reconnecting" | "offline") => void;
  onError: (message: string) => void;
};
const CAPS = { low: 0.75, medium: 1, high: 1.5 };
const FOOD_COLORS = Array.from({ length: 24 }, (_, i) => `hsl(${i * 15},100%,65%)`);

export default function GameCanvas(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latestProps = useRef(props);
  latestProps.current = props;
  useEffect(() => {
    const c = canvas.current,
      ctx = c?.getContext("2d", { alpha: false });
    if (!c || !ctx) {
      latestProps.current.onError("Brauzer Canvas 2D-ni dəstəkləmir.");
      return;
    }
    let raf = 0,
      disposed = false,
      self = "",
      world = "",
      active = false,
      requested = false;
    let latest: Snapshot | undefined,
      wasAlive = false,
      fpsCount = 0,
      fpsClock = performance.now(),
      lastHud = 0,
      lastInput = 0;
    let lastFrame = performance.now();
    const history: {
      state: Snapshot;
      at: number;
      foods: Map<number, Snapshot["foods"][number]>;
      snakes: Map<string, Snake>;
    }[] = [];
    const rendered = new Map<string, Snake>();
    const all: Snake[] = [];
    const prediction = new LocalPrediction();
    const mouse = { x: innerWidth / 2 + 100, y: innerHeight / 2, down: false };
    const cam = { x: 0, y: 0, z: 0.8 };
    const steeringAngle = () => {
      const snake = rendered.get(self),
        head = snake?.pts[0];
      const x = innerWidth / 2 + ((head?.x ?? cam.x) - cam.x) * cam.z;
      const y = innerHeight / 2 + ((head?.y ?? cam.y) - cam.y) * cam.z;
      const dx = mouse.x - x,
        dy = mouse.y - y;
      return dx * dx + dy * dy < 64 ? (snake?.angle ?? 0) : Math.atan2(dy, dx);
    };
    const labels = new Map<string, HTMLCanvasElement>();
    const bg =
      getComputedStyle(document.documentElement).getPropertyValue("--game-bg").trim() || "#0b0f1a";
    const sprites = FOOD_COLORS.map((_, hue) => {
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = 64;
      const g = sprite.getContext("2d")!;
      const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, `hsla(${hue * 15},100%,85%,1)`);
      gradient.addColorStop(0.32, `hsla(${hue * 15},100%,65%,1)`);
      gradient.addColorStop(0.42, `hsla(${hue * 15},100%,60%,0.35)`);
      gradient.addColorStop(1, `hsla(${hue * 15},100%,60%,0)`);
      g.fillStyle = gradient;
      g.fillRect(0, 0, 64, 64);
      return sprite;
    });
    const connection = connectArena(props.room, {
      snapshot(state, id, nextWorld = "") {
        if (disposed) return;
        if (self !== id || world !== nextWorld) {
          self = id;
          world = nextWorld;
          wasAlive = false;
          history.length = 0;
          rendered.clear();
          prediction.clear();
        }
        latest = state;
        if (history.at(-1)?.state.tick === state.tick) history.pop();
        history.push({
          state,
          at: performance.now(),
          foods: snapshotIndex(state).foods,
          snakes: snapshotIndex(state).snakes,
        });
        if (history.length > 8) history.shift();
        const me = state.snakes.find((s) => s.id === self);
        if (me) prediction.reconcile(me, performance.now());
        else prediction.clear();
        if (me) {
          if (requested && !wasAlive) {
            active = true;
            requested = false;
            latestProps.current.onStart();
          }
          wasAlive = true;
        } else if (wasAlive) {
          wasAlive = false;
          active = false;
          mouse.down = false;
          const death = [...state.deaths].reverse().find((d) => d.id === self);
          if (death) latestProps.current.onDeath(death.len);
          else latestProps.current.onInterrupted();
        }
      },
      status(status) {
        if (!disposed) {
          if (status === "offline") requested = false;
          latestProps.current.onStatus(status);
        }
      },
      rejected(message) {
        requested = false;
        latestProps.current.onError(message);
      },
      count(count) {
        if (!disposed) latestProps.current.onCount(count);
      },
    });
    props.startRef.current = () => {
      if (active || requested) return;
      requested = true;
      mouse.down = false;
      const profile = latestProps.current.profile();
      connection.play(profile.name.trim() || "Sən", profile.skin);
    };
    const sendInput = (force = false) => {
      const now = performance.now();
      if (!active || (!force && now - lastInput < 1000 / 30)) return;
      const angle = steeringAngle();
      prediction.steer(angle, mouse.down);
      const seq = connection.input(angle, mouse.down);
      if (seq !== undefined) prediction.command(seq, now);
      lastInput = now;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.target !== c) return;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      sendInput();
      if (active) prediction.steer(steeringAngle(), mouse.down);
    };
    const down = (e: PointerEvent) => {
      if (e.target !== c || e.button !== 0) return;
      move(e);
      mouse.down = true;
      sendInput(true);
    };
    const up = () => {
      mouse.down = false;
      sendInput(true);
    };
    const keyboard = (e: KeyboardEvent) => {
      if (
        !active ||
        e.code !== "Space" ||
        (e.target instanceof Element &&
          e.target.closest("input,textarea,button,select,[contenteditable]"))
      )
        return;
      e.preventDefault();
      const boost = e.type === "keydown";
      if (mouse.down !== boost) {
        mouse.down = boost;
        sendInput(true);
      }
    };
    const visibility = () => {
      if (document.hidden) up();
    };
    addEventListener("pointermove", move);
    addEventListener("pointerdown", down);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
    addEventListener("blur", up);
    addEventListener("keydown", keyboard);
    addEventListener("keyup", keyboard);
    document.addEventListener("visibilitychange", visibility);

    const path = (snake: Snake) => {
      ctx.beginPath();
      traceBodyCurve(ctx, snake.pts);
    };
    const frame = (now: number) => {
      const cfg = latestProps.current.config,
        d = Math.min(CAPS[cfg.quality], devicePixelRatio || 1);
      const dt = Math.min(3, (now - lastFrame) / 16.667);
      lastFrame = now;
      const w = Math.round(innerWidth * d),
        h = Math.round(innerHeight * d);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      sendInput();
      // A short interpolation buffer absorbs jitter. Deaths and food ownership always come from authority.
      const renderAt = now - 100;
      let a = history[0],
        b = history.at(-1);
      for (let i = 1; i < history.length; i++) {
        if (history[i]!.at >= renderAt) {
          a = history[i - 1];
          b = history[i];
          break;
        }
        a = history[i];
      }
      const alpha =
        a && b && b.at > a.at ? Math.max(0, Math.min(1, (renderAt - a.at) / (b.at - a.at))) : 1;
      const old = a?.snakes;
      const currentIds = latest ? snapshotIndex(latest).snakes : undefined;
      let visibleCount = 0;
      for (const target of b?.state.snakes ?? []) {
        if (!currentIds?.has(target.id)) continue; // Do not render an already dead body from the buffer.
        const previous = old?.get(target.id);
        const source = previous && previous.spawnTick === target.spawnTick ? previous : target;
        let shown = rendered.get(target.id);
        if (!shown) {
          shown = cloneSnake(target);
          rendered.set(target.id, shown);
        }
        shown.len = target.len;
        shown.spawnTick = target.spawnTick ?? 0;
        shown.boost = target.boost;
        shown.skin = target.skin;
        shown.name = target.name;
        shown.angle = interpolateAngle(source.angle, target.angle, alpha);
        shown.hue = target.hue;
        while (shown.pts.length < target.pts.length)
          shown.pts.push({ ...target.pts[shown.pts.length]! });
        shown.pts.length = target.pts.length;
        for (let i = 0; i < target.pts.length; i++) {
          const t = target.pts[i]!,
            p = source.pts[i] ?? t,
            r = shown.pts[i]!;
          r.x = p.x + (t.x - p.x) * alpha;
          r.y = p.y + (t.y - p.y) * alpha;
        }
        all[visibleCount++] = shown;
      }
      all.length = visibleCount;
      for (const key of rendered.keys()) if (!currentIds?.has(key)) rendered.delete(key);
      const me = all.find((s) => s.id === self);
      if (me) {
        if (active) prediction.renderInto(me, now);
        const head = me.pts[0]!,
          k = 1 - Math.pow(0.85, dt);
        cam.x += (head.x - cam.x) * k;
        cam.y += (head.y - cam.y) * k;
        cam.z += (Math.max(0.5, 1.15 - snakeWidth(me) / 70) - cam.z) * (1 - Math.pow(0.97, dt));
      }
      const vw = innerWidth / cam.z / 2 + 70,
        vh = innerHeight / cam.z / 2 + 70;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(
        d * cam.z,
        0,
        0,
        d * cam.z,
        (innerWidth / 2) * d - cam.x * cam.z * d,
        (innerHeight / 2) * d - cam.y * cam.z * d,
      );
      if (cfg.grid) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(120,160,255,0.06)";
        ctx.lineWidth = 1;
        for (let x = Math.floor((cam.x - vw) / 60) * 60; x < cam.x + vw; x += 60) {
          ctx.moveTo(x, cam.y - vh);
          ctx.lineTo(x, cam.y + vh);
        }
        for (let y = Math.floor((cam.y - vh) / 60) * 60; y < cam.y + vh; y += 60) {
          ctx.moveTo(cam.x - vw, y);
          ctx.lineTo(cam.x + vw, y);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,60,100,0.7)";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(0, 0, WORLD, 0, Math.PI * 2);
      ctx.stroke();
      for (const f of b?.state.foods ?? latest?.foods ?? []) {
        const previousFood = a?.foods.get(f.id);
        const x = previousFood ? previousFood.x + (f.x - previousFood.x) * alpha : f.x;
        const y = previousFood ? previousFood.y + (f.y - previousFood.y) * alpha : f.y;
        if (Math.abs(x - cam.x) > vw || Math.abs(y - cam.y) > vh) continue;
        if (!cfg.glow) {
          ctx.fillStyle = FOOD_COLORS[f.hue]!;
          ctx.fillRect(x - f.r, y - f.r, f.r * 2, f.r * 2);
        } else {
          const size = f.r * 2.5;
          ctx.drawImage(sprites[f.hue]!, x - size, y - size, size * 2, size * 2);
        }
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const s of all) {
        const head = s.pts[0]!,
          radius = snakeWidth(s);
        if (
          s.pts.length < 2 ||
          Math.abs(head.x - cam.x) > vw + s.pts.length * SEG ||
          Math.abs(head.y - cam.y) > vh + s.pts.length * SEG
        )
          continue;
        const skin = SKIN_BY[s.skin] ?? SKINS[0]!,
          colors = skin.colors,
          first = colors[0]!;
        path(s);
        if (s.boost && cfg.boostFx) {
          ctx.strokeStyle = `${first}44`;
          ctx.lineWidth = radius * 2 + 14;
          ctx.stroke();
        }
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = radius * 2 + 4;
        ctx.stroke();
        if (skin.type === "hue") {
          ctx.strokeStyle = `hsl(${s.hue | 0},90%,42%)`;
          ctx.lineWidth = radius * 2;
          ctx.stroke();
          ctx.strokeStyle = `hsl(${s.hue | 0},90%,64%)`;
          ctx.lineWidth = radius;
          ctx.stroke();
        } else if (skin.type === "bands" || skin.type === "pulse") {
          for (let i = 0; i < colors.length; i++) {
            ctx.strokeStyle = colors[i]!;
            ctx.lineWidth = radius * 2 * (1 - i / colors.length);
            ctx.stroke();
          }
        } else {
          const stride = cfg.quality === "low" ? 6 : 4,
            period = stride * colors.length;
          const shift =
            skin.type === "stripes" || cfg.quality === "low" ? 0 : Math.floor(now / 90) % period;
          for (let j = 0; j < colors.length; j++) {
            ctx.beginPath();
            for (let i = ((j * stride + shift) % period) - period; i < s.pts.length; i += period) {
              const start = Math.max(0, i),
                end = Math.min(i + stride - 1, s.pts.length - 1);
              if (end >= start) traceBodyCurve(ctx, s.pts, start, end);
            }
            ctx.strokeStyle =
              skin.type === "anim"
                ? `hsl(${((now / 12 + (j * 360) / colors.length) % 360) | 0},100%,64%)`
                : colors[j]!;
            ctx.lineWidth = radius * 2;
            ctx.stroke();
          }
        }
        // A single highlight follows the body; expensive shadows and per-segment gradients are avoided.
        path(s);
        ctx.strokeStyle = "rgba(255,255,255,0.24)";
        ctx.lineWidth = radius * 0.38;
        ctx.stroke();
        if (isSpawnProtected(s, latest?.tick ?? 0)) {
          ctx.strokeStyle = "rgba(160,235,255,0.85)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(head.x, head.y, radius + 7, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (skin.spark && cfg.boostFx && cfg.quality !== "low") {
          ctx.fillStyle = skin.spark;
          for (let i = 0; i < 4; i++) {
            const p = s.pts[Math.floor((now / 45 + (i * s.pts.length) / 4) % s.pts.length)]!;
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius * 0.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        for (const side of [-1, 1]) {
          const x = head.x + Math.cos(s.angle + side * 0.6) * radius * 0.65,
            y = head.y + Math.sin(s.angle + side * 0.6) * radius * 0.65;
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(x, y, radius * 0.38, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = skin.eye ?? "#111";
          ctx.beginPath();
          ctx.arc(
            x + Math.cos(s.angle) * radius * 0.14,
            y + Math.sin(s.angle) * radius * 0.14,
            radius * 0.2,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        if (cfg.names) {
          const key = `${s.id}:${s.name}`;
          let label = labels.get(key);
          if (!label) {
            if (labels.size >= 128) labels.clear();
            label = document.createElement("canvas");
            label.width = 240;
            label.height = 40;
            const g = label.getContext("2d")!;
            g.font = "600 24px Space Grotesk, sans-serif";
            g.textAlign = "center";
            g.fillStyle = s.id === self ? "#88ffb0" : s.bot ? "#bac4dd" : "#ffe08a";
            g.fillText(`${s.bot ? "🤖" : "👤"} ${s.name}`, 120, 28, 232);
            labels.set(key, label);
          }
          ctx.drawImage(label, head.x - 60, head.y - radius - 24, 120, 20);
        }
      }
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const leaders = [...all].sort((x, y) => y.len - x.len).slice(0, 10);
      ctx.fillStyle = "rgba(10,14,30,0.65)";
      ctx.fillRect(innerWidth - 200, 14, 186, 30 + leaders.length * 20);
      ctx.font = "700 13px Space Grotesk, sans-serif";
      ctx.fillStyle = "#7cf";
      ctx.fillText("LİDERLƏR", innerWidth - 188, 35);
      ctx.font = "500 12px Space Grotesk, sans-serif";
      for (let i = 0; i < leaders.length; i++) {
        const s = leaders[i]!;
        ctx.fillStyle = s.id === self ? "#8fa" : s.bot ? "#bac4dd" : "#ffe08a";
        ctx.fillText(
          `${i + 1}. ${s.bot ? "🤖" : "👤"} ${s.name}`,
          innerWidth - 188,
          56 + i * 20,
          122,
        );
        ctx.textAlign = "right";
        ctx.fillText(String(Math.floor(s.len * 10)), innerWidth - 24, 56 + i * 20);
        ctx.textAlign = "left";
      }
      if (cfg.minimap) {
        const x = innerWidth - 76,
          y = innerHeight - 80;
        ctx.fillStyle = "rgba(10,14,30,0.65)";
        ctx.beginPath();
        ctx.arc(x, y, 56, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#e46";
        ctx.lineWidth = 1;
        ctx.stroke();
        for (const s of all) {
          const p = s.pts[0]!;
          ctx.fillStyle = s.id === self ? "#8fa" : "#8ad";
          ctx.beginPath();
          ctx.arc(
            x + (p.x / WORLD) * 56,
            y + (p.y / WORLD) * 56,
            s.id === self ? 3 : 1.5,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
      if (now - lastHud > 150 && me && active) {
        latestProps.current.onScore(Math.floor(me.len * 10));
        lastHud = now;
      }
      fpsCount++;
      if (now - fpsClock >= 500) {
        if (cfg.showFps)
          latestProps.current.onFps(Math.round((fpsCount * 1000) / (now - fpsClock)));
        fpsCount = 0;
        fpsClock = now;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      connection.close();
      latestProps.current.startRef.current = () => {};
      removeEventListener("pointermove", move);
      removeEventListener("pointerdown", down);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      removeEventListener("blur", up);
      removeEventListener("keydown", keyboard);
      removeEventListener("keyup", keyboard);
      document.removeEventListener("visibilitychange", visibility);
    };
    // Props are read through latestProps; reconnect only when changing rooms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.room]);
  return (
    <canvas ref={canvas} className="block h-full w-full touch-none" aria-label="Neon ilan oyunu" />
  );
}
