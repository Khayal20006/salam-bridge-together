// @ts-nocheck -- performance-critical canvas loop with array indexing
import { useEffect, useRef, useState } from "react";

type P = { x: number; y: number };
type Snake = {
  id: number; name: string; pts: P[]; angle: number; target: number;
  len: number; hue: number; alive: boolean; bot: boolean; boost: boolean; think: number;
};
type Food = { x: number; y: number; r: number; hue: number; v: number };

const WORLD = 3000, SEG = 8, SPEED = 2.6, BOOST = 5.2, TURN = 0.09;
const NAMES = ["Nağı", "Leyla", "Viper", "Kobra", "Aysel", "Orxan", "Neon", "Zəhra", "Shadow", "Murad", "Toxic", "Elvin", "Rəşad", "Nova", "Fidan", "Blitz", "Kamran", "Ruby"];

const width = (s: Snake) => 7 + Math.min(18, Math.sqrt(s.len) * 0.9);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
function randPos(): P { const a = rnd(0, Math.PI * 2), r = Math.sqrt(Math.random()) * (WORLD - 200); return { x: Math.cos(a) * r, y: Math.sin(a) * r }; }

export default function SnakeGame() {
  const cvs = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"menu" | "play" | "dead">("menu");
  const [name, setName] = useState("");
  const [score, setScore] = useState(0);
  const startRef = useRef<() => void>(() => {});

  useEffect(() => {
    const c = cvs.current!; const ctx = c.getContext("2d")!;
    let raf = 0, idc = 1, playing = false;
    let snakes: Snake[] = []; let foods: Food[] = []; let me: Snake | null = null;
    const mouse = { x: 0, y: 0, down: false };
    const cam = { x: 0, y: 0, z: 1 };
    const css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue("--game-bg").trim() || "#0b0f1a";

    const resize = () => { const d = devicePixelRatio || 1; c.width = innerWidth * d; c.height = innerHeight * d; c.style.width = innerWidth + "px"; c.style.height = innerHeight + "px"; };
    resize(); addEventListener("resize", resize);

    const mk = (nm: string, bot: boolean): Snake => {
      const p = randPos(), a = rnd(0, 6.28);
      const pts = Array.from({ length: 12 }, (_, i) => ({ x: p.x - Math.cos(a) * i * SEG, y: p.y - Math.sin(a) * i * SEG }));
      return { id: idc++, name: nm, pts, angle: a, target: a, len: bot ? rnd(10, 120) : 10, hue: rnd(0, 360), alive: true, bot, boost: false, think: 0 };
    };
    const addFood = (x?: number, y?: number, v = 1) => {
      const p = x === undefined ? randPos() : { x: x + rnd(-10, 10), y: y! + rnd(-10, 10) };
      foods.push({ ...p, r: 3 + v * 2, hue: rnd(0, 360), v });
    };
    const init = () => {
      snakes = []; foods = [];
      for (let i = 0; i < 900; i++) addFood();
      for (let i = 0; i < 18; i++) snakes.push(mk(NAMES[i % NAMES.length], true));
    };
    init();

    startRef.current = () => {
      me = mk(nameRef.current.trim() || "Sən", false); me.hue = 150; snakes.push(me); playing = true; setScore(10); setState("play");
    };

    const kill = (s: Snake) => {
      s.alive = false;
      for (let i = 0; i < s.pts.length; i += 2) addFood(s.pts[i].x, s.pts[i].y, 1 + Math.min(3, s.len / 80));
      if (s === me) { playing = false; setState("dead"); }
    };

    const onMove = (e: PointerEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    const onDown = () => (mouse.down = true), onUp = () => (mouse.down = false);
    const onKey = (e: KeyboardEvent) => { if (e.code === "Space") mouse.down = e.type === "keydown"; };
    addEventListener("pointermove", onMove); addEventListener("pointerdown", onDown); addEventListener("pointerup", onUp);
    addEventListener("keydown", onKey); addEventListener("keyup", onKey);

    let last = performance.now(), hudT = 0;
    const loop = (now: number) => {
      const dt = Math.min(3, (now - last) / 16.67); last = now;
      // control
      for (const s of snakes) {
        if (!s.alive) continue;
        const h = s.pts[0];
        if (s === me) {
          s.target = Math.atan2(mouse.y - innerHeight / 2, mouse.x - innerWidth / 2);
          s.boost = mouse.down && s.len > 12;
        } else if ((s.think -= dt) <= 0) {
          s.think = rnd(8, 20);
          let best: Food | null = null, bd = 1e9;
          for (const f of foods) { const d = (f.x - h.x) ** 2 + (f.y - h.y) ** 2; if (d < bd && d < 160000) { bd = d; best = f; } }
          s.target = best ? Math.atan2(best.y - h.y, best.x - h.x) : s.target + rnd(-1, 1);
          // avoid others
          for (const o of snakes) {
            if (o === s || !o.alive) continue;
            for (let i = 0; i < o.pts.length; i += 3) {
              const p = o.pts[i]; const d = (p.x - h.x) ** 2 + (p.y - h.y) ** 2;
              if (d < 6400) { s.target = Math.atan2(h.y - p.y, h.x - p.x); break; }
            }
          }
          if (Math.hypot(h.x, h.y) > WORLD - 250) s.target = Math.atan2(-h.y, -h.x);
          s.boost = Math.random() < 0.08 && s.len > 40;
        }
        let d = s.target - s.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
        s.angle += Math.max(-TURN, Math.min(TURN, d)) * dt;
        const sp = (s.boost ? BOOST : SPEED) * dt;
        if (s.boost) { s.len -= 0.08 * dt; if (Math.random() < 0.15) { const t = s.pts[s.pts.length - 1]; addFood(t.x, t.y, 0.5); } }
        const nh = { x: h.x + Math.cos(s.angle) * sp, y: h.y + Math.sin(s.angle) * sp };
        s.pts[0] = nh;
        for (let i = 1; i < s.pts.length; i++) {
          const a = s.pts[i - 1], b = s.pts[i]; const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
          if (l > SEG) { b.x = a.x + (dx / l) * SEG; b.y = a.y + (dy / l) * SEG; }
        }
        const want = Math.floor(s.len);
        while (s.pts.length < want) s.pts.push({ ...s.pts[s.pts.length - 1] });
        while (s.pts.length > want && s.pts.length > 10) s.pts.pop();
        if (Math.hypot(nh.x, nh.y) > WORLD) kill(s);
      }
      // eat
      for (const s of snakes) {
        if (!s.alive) continue; const h = s.pts[0], r = width(s) + 14;
        for (let i = foods.length - 1; i >= 0; i--) {
          const f = foods[i]; const dx = f.x - h.x, dy = f.y - h.y; const d = dx * dx + dy * dy;
          if (d < r * r) { s.len += f.v; foods[i] = foods[foods.length - 1]; foods.pop(); }
          else if (d < (r * 3) ** 2) { f.x -= dx * 0.12; f.y -= dy * 0.12; }
        }
      }
      // collide
      for (const s of snakes) {
        if (!s.alive) continue; const h = s.pts[0], w = width(s);
        for (const o of snakes) {
          if (o === s || !o.alive) continue; const ow = width(o);
          const oh = o.pts[0]; if ((oh.x - h.x) ** 2 + (oh.y - h.y) ** 2 > (o.pts.length * SEG + 100) ** 2) continue;
          for (let i = 1; i < o.pts.length; i++) {
            const p = o.pts[i]; if ((p.x - h.x) ** 2 + (p.y - h.y) ** 2 < (w * 0.6 + ow) ** 2) { kill(s); break; }
          }
          if (!s.alive) break;
        }
      }
      snakes = snakes.filter((s) => s.alive);
      while (snakes.filter((s) => s.bot).length < 18) snakes.push(mk(NAMES[Math.floor(rnd(0, NAMES.length))], true));
      while (foods.length < 900) addFood();

      // camera
      const focus = me && me.alive ? me.pts[0] : cam;
      cam.x += (focus.x - cam.x) * 0.15; cam.y += (focus.y - cam.y) * 0.15;
      const tz = me && me.alive ? Math.max(0.55, 1.1 - me.len / 1500) : 0.7; cam.z += (tz - cam.z) * 0.03;

      // draw
      const d = devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
      ctx.setTransform(d * cam.z, 0, 0, d * cam.z, (innerWidth / 2) * d - cam.x * cam.z * d, (innerHeight / 2) * d - cam.y * cam.z * d);
      const vw = innerWidth / cam.z / 2 + 60, vh = innerHeight / cam.z / 2 + 60;
      // hex grid
      ctx.strokeStyle = "rgba(120,160,255,0.06)"; ctx.lineWidth = 2; const g = 60;
      ctx.beginPath();
      for (let x = Math.floor((cam.x - vw) / g) * g; x < cam.x + vw; x += g) { ctx.moveTo(x, cam.y - vh); ctx.lineTo(x, cam.y + vh); }
      for (let y = Math.floor((cam.y - vh) / g) * g; y < cam.y + vh; y += g) { ctx.moveTo(cam.x - vw, y); ctx.lineTo(cam.x + vw, y); }
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,60,100,0.6)"; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0, 0, WORLD, 0, 7); ctx.stroke();
      // food
      ctx.globalCompositeOperation = "lighter";
      for (const f of foods) {
        if (Math.abs(f.x - cam.x) > vw || Math.abs(f.y - cam.y) > vh) continue;
        const pulse = 1 + Math.sin(now / 300 + f.x) * 0.2;
        ctx.fillStyle = `hsla(${f.hue},100%,60%,0.25)`; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 2.4 * pulse, 0, 7); ctx.fill();
        ctx.fillStyle = `hsl(${f.hue},100%,70%)`; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      // snakes
      for (const s of snakes) {
        const w = width(s), h = s.pts[0];
        if (Math.abs(h.x - cam.x) > vw + s.pts.length * SEG || Math.abs(h.y - cam.y) > vh + s.pts.length * SEG) continue;
        if (s.boost) { ctx.shadowColor = `hsl(${s.hue},100%,60%)`; ctx.shadowBlur = 25; }
        for (let i = s.pts.length - 1; i >= 0; i--) {
          const p = s.pts[i]; const l = 45 + ((i % 6) < 3 ? 10 : 0);
          ctx.fillStyle = `hsl(${s.hue},90%,${l}%)`; ctx.beginPath(); ctx.arc(p.x, p.y, w, 0, 7); ctx.fill();
        }
        ctx.shadowBlur = 0;
        // eyes
        for (const side of [-1, 1]) {
          const ex = h.x + Math.cos(s.angle + side * 0.6) * w * 0.6, ey = h.y + Math.sin(s.angle + side * 0.6) * w * 0.6;
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, ey, w * 0.38, 0, 7); ctx.fill();
          ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(ex + Math.cos(s.angle) * w * 0.15, ey + Math.sin(s.angle) * w * 0.15, w * 0.2, 0, 7); ctx.fill();
        }
        ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = "600 13px Space Grotesk, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(s.name, h.x, h.y - w - 12);
      }
      // HUD: leaderboard + minimap
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const top = [...snakes].sort((a, b) => b.len - a.len).slice(0, 10);
      ctx.fillStyle = "rgba(10,14,30,0.55)"; ctx.fillRect(innerWidth - 210, 16, 194, 28 + top.length * 20);
      ctx.font = "700 13px Space Grotesk, sans-serif"; ctx.textAlign = "left"; ctx.fillStyle = "#7cf";
      ctx.fillText("LİDERLƏR", innerWidth - 196, 36);
      top.forEach((s, i) => {
        ctx.fillStyle = s === me ? "#5f8" : "rgba(255,255,255,0.8)"; ctx.font = "500 12px Space Grotesk, sans-serif";
        ctx.fillText(`${i + 1}. ${s.name}`, innerWidth - 196, 58 + i * 20);
        ctx.textAlign = "right"; ctx.fillText(String(Math.floor(s.len * 10)), innerWidth - 26, 58 + i * 20); ctx.textAlign = "left";
      });
      const mr = 60, mx = innerWidth - 80, my = innerHeight - 80;
      ctx.fillStyle = "rgba(10,14,30,0.6)"; ctx.beginPath(); ctx.arc(mx, my, mr, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(255,60,100,0.6)"; ctx.lineWidth = 2; ctx.stroke();
      for (const s of snakes) { ctx.fillStyle = s === me ? "#5f8" : `hsla(${s.hue},90%,60%,0.7)`; ctx.beginPath(); ctx.arc(mx + (s.pts[0].x / WORLD) * mr, my + (s.pts[0].y / WORLD) * mr, s === me ? 3.5 : 2, 0, 7); ctx.fill(); }

      if (me && playing && (hudT += dt) > 10) { hudT = 0; setScore(Math.floor(me.len * 10)); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf); removeEventListener("resize", resize); removeEventListener("pointermove", onMove);
      removeEventListener("pointerdown", onDown); removeEventListener("pointerup", onUp); removeEventListener("keydown", onKey); removeEventListener("keyup", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameRef = useRef(name); nameRef.current = name;

  return (
    <div className="fixed inset-0 overflow-hidden bg-background select-none">
      <canvas ref={cvs} className="block touch-none" />
      {state === "play" && (
        <div className="pointer-events-none absolute left-4 top-4 rounded-xl bg-card/60 px-4 py-2 font-display text-foreground backdrop-blur">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Uzunluq</div>
          <div className="text-2xl font-bold text-primary">{score}</div>
        </div>
      )}
      {state !== "play" && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <form
            onSubmit={(e) => { e.preventDefault(); startRef.current(); }}
            className="w-[min(92vw,420px)] rounded-3xl border border-border bg-card/80 p-8 text-center shadow-glow"
          >
            <h1 className="font-display text-5xl font-bold tracking-tight text-gradient">neon.io</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {state === "dead" ? `Öldün! Son uzunluq: ${score}` : "Ye, böyü, rəqibləri kəs."}
            </p>
            <input
              value={name} onChange={(e) => setName(e.target.value)} maxLength={14} placeholder="Adın"
              className="mt-6 w-full rounded-xl border border-input bg-background/60 px-4 py-3 text-center text-foreground outline-none focus:border-primary"
            />
            <button type="submit" className="mt-4 w-full rounded-xl bg-primary py-3 font-display text-lg font-bold text-primary-foreground transition hover:scale-[1.02]">
              {state === "dead" ? "Yenidən oyna" : "Oyna"}
            </button>
            <p className="mt-4 text-xs text-muted-foreground">Siçanla idarə et · Klik / Space = sürətlən</p>
          </form>
        </div>
      )}
    </div>
  );
}
