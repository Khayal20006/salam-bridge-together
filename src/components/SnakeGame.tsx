// @ts-nocheck -- performance-critical canvas loop with array indexing
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SKINS, SKIN_BY, coinsFor } from "@/lib/skins";
import { lovable } from "@/integrations/lovable/index";
import { PAID_SKINS, initializePaddle, getPaddlePriceId, getPaddleEnvironment } from "@/lib/paddle";

const REGIONS = {
  Avropa: [["eu-1", "🇦🇿", "Bakı 1"], ["eu-2", "🇹🇷", "İstanbul 1"], ["eu-3", "🇩🇪", "Frankfurt 1"], ["eu-4", "🇫🇷", "Paris 1"]],
  Asiya: [["as-1", "🇯🇵", "Tokio 1"], ["as-2", "🇸🇬", "Sinqapur 1"]],
  Amerika: [["am-1", "🇺🇸", "Nyu-York 1"], ["am-2", "🇧🇷", "San-Paulu 1"]],
} as const;
const ROOM_MAX = 50;

type P = { x: number; y: number };
type Snake = {
  id: number; name: string; pts: P[]; angle: number; target: number;
  len: number; hue: number; alive: boolean; bot: boolean; boost: boolean; think: number; remote?: boolean; skin?: string; seen?: number; tgt?: P[];
};
type Food = { x: number; y: number; r: number; hue: number; v: number };

const WORLD = 3000, SEG = 8, SPEED = 2.6, BOOST = 7.0, TURN = 0.09;
const NAMES = ["Nağı", "Leyla", "Viper", "Kobra", "Aysel", "Orxan", "Neon", "Zəhra", "Shadow", "Murad", "Toxic", "Elvin", "Rəşad", "Nova", "Fidan", "Blitz", "Kamran", "Ruby"];

// growth goes mostly into thickness; body length (segment count) grows slowly and is capped
const width = (s: Snake) => 7 + Math.min(34, Math.sqrt(s.len) * 1.15);
const segCount = (len: number) => Math.floor(10 + Math.min(140, Math.sqrt(Math.max(0, len - 10)) * 8));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
function randPos(): P { const a = rnd(0, Math.PI * 2), r = Math.sqrt(Math.random()) * (WORLD - 200); return { x: Math.cos(a) * r, y: Math.sin(a) * r }; }

type Cfg = { quality: "low" | "medium" | "high"; grid: boolean; glow: boolean; boostFx: boolean; names: boolean; minimap: boolean; showFps: boolean };
const DEF: Cfg = { quality: "medium", grid: true, glow: true, boostFx: true, names: true, minimap: true, showFps: false };
const QCAP = { low: 0.75, medium: 1, high: 1.5 };
const FOODC = Array.from({ length: 24 }, (_, i) => `hsl(${i * 15},100%,65%)`);

export default function SnakeGame() {
  const cvs = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"menu" | "play" | "dead">("menu");
  const [name, setName] = useState("");
  const [score, setScore] = useState(0);
  const [online, setOnline] = useState(1);
  const startRef = useRef<() => void>(() => {});
  const [cfg, setCfg] = useState<Cfg>(DEF);
  const [showCfg, setShowCfg] = useState(false);
  const [fps, setFps] = useState(0);
  const cfgRef = useRef<Cfg>(DEF); cfgRef.current = cfg;
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem("neon-cfg") || "null"); if (v) setCfg({ ...DEF, ...v }); } catch { /* ignore */ } }, []);
  const [coins, setCoins] = useState(0);
  const [owned, setOwned] = useState<string[]>(["hue"]);
  const [skin, setSkin] = useState("hue");
  const skinRef = useRef(skin); skinRef.current = skin;
  useEffect(() => { try { setCoins(+(localStorage.getItem("neon-coins") || 0)); setOwned(JSON.parse(localStorage.getItem("neon-owned") || '["hue"]')); setSkin(localStorage.getItem("neon-skin") || "hue"); } catch { /* ignore */ } }, []);
  const pick = (id: string) => {
    const k = SKIN_BY[id];
    if (owned.includes(id) || paid.includes(id)) { setSkin(id); localStorage.setItem("neon-skin", id); return; }
    if (PAID_SKINS[id]) return;
    if (coins < k.price) return;
    const c = coins - k.price, o = [...owned, id];
    setCoins(c); setOwned(o); setSkin(id);
    localStorage.setItem("neon-coins", String(c)); localStorage.setItem("neon-owned", JSON.stringify(o)); localStorage.setItem("neon-skin", id);
  };
  const upd = (p: Partial<Cfg>) => setCfg((o) => { const n = { ...o, ...p }; localStorage.setItem("neon-cfg", JSON.stringify(n)); return n; });
  const [preview, setPreview] = useState("hue");
  const [authMsg, setAuthMsg] = useState("");
  useEffect(() => { setPreview(skin); }, [skin]);
  const [region, setRegion] = useState<keyof typeof REGIONS>("Avropa");
  const [room, setRoom] = useState("eu-1");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [user, setUser] = useState<{ id: string; email?: string; name: string; avatar?: string } | null>(null);
  const [paid, setPaid] = useState<string[]>([]);
  const loadPaid = async (uid: string) => { const { data } = await supabase.from("skin_purchases").select("skin_id").eq("user_id", uid).eq("environment", getPaddleEnvironment()); setPaid((data || []).map((d) => d.skin_id)); };
  useEffect(() => {
    const apply = (u: any) => { if (!u) { setUser(null); setPaid([]); return; } const n = (u.user_metadata?.full_name || u.email || "").split(" ")[0].slice(0, 14); setUser({ id: u.id, email: u.email, name: n, avatar: u.user_metadata?.avatar_url }); loadPaid(u.id); setName((o) => o || n); };
    supabase.auth.getUser().then(({ data }) => apply(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => apply(s?.user));
    return () => sub.subscription.unsubscribe();
  }, []);
  // lobby: live player count per room (cheap presence-only channel)
  useEffect(() => {
    const k = Math.random().toString(36).slice(2, 10);
    const lb = supabase.channel("neon-lobby", { config: { presence: { key: k } } });
    lb.on("presence", { event: "sync" }, () => {
      const c: Record<string, number> = {};
      Object.values(lb.presenceState()).forEach((arr: any) => { const r = arr[0]?.room; if (r) c[r] = (c[r] || 0) + 1; });
      setCounts(c);
    });
    lb.subscribe((st) => { if (st === "SUBSCRIBED") lb.track({ room }); });
    return () => { supabase.removeChannel(lb); };
  }, [room]);

  useEffect(() => {
    const c = cvs.current!; const ctx = c.getContext("2d")!;
    let raf = 0, idc = 1, playing = false, fpsN = 0, fpsT = 0;
    let snakes: Snake[] = []; let foods: Food[] = []; let me: Snake | null = null;
    const mouse = { x: 0, y: 0, down: false };
    const cam = { x: 0, y: 0, z: 1 };
    const css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue("--game-bg").trim() || "#0b0f1a";

    const dpr = () => Math.min(QCAP[cfgRef.current.quality], devicePixelRatio || 1);
    const resize = () => { const d = dpr(); c.width = innerWidth * d; c.height = innerHeight * d; c.style.width = innerWidth + "px"; c.style.height = innerHeight + "px"; };
    resize(); addEventListener("resize", resize);

    const mk = (nm: string, bot: boolean): Snake => {
      const p = randPos(), a = rnd(0, 6.28);
      const pts = Array.from({ length: 12 }, (_, i) => ({ x: p.x - Math.cos(a) * i * SEG, y: p.y - Math.sin(a) * i * SEG }));
      return { id: idc++, name: nm, pts, angle: a, target: a, len: bot ? rnd(10, 120) : 10, hue: rnd(0, 360), alive: true, bot, boost: false, think: 0, skin: bot && Math.random() < 0.5 ? SKINS[1 + Math.floor(Math.random() * (SKINS.length - 1))].id : "hue" };
    };
    // pre-rendered glowing food sprites (one per hue bucket) -> drawImage is far cheaper than arcs + string colors
    const SPR = Array.from({ length: 24 }, (_, i) => {
      const s = document.createElement("canvas"); s.width = s.height = 64; const g = s.getContext("2d")!;
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, `hsla(${i * 15},100%,85%,1)`); gr.addColorStop(0.32, `hsla(${i * 15},100%,65%,1)`);
      gr.addColorStop(0.42, `hsla(${i * 15},100%,60%,0.35)`); gr.addColorStop(1, `hsla(${i * 15},100%,60%,0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return s;
    });
    // cached name labels (emoji text rendering is slow)
    const labels = new Map<string, HTMLCanvasElement>();
    const label = (txt: string, color: string) => {
      const key = color + txt; let l = labels.get(key);
      if (!l) {
        l = document.createElement("canvas"); const g = l.getContext("2d")!; g.font = "600 13px Space Grotesk, sans-serif";
        const w = Math.ceil(g.measureText(txt).width) + 8; l.width = w * 2; l.height = 40;
        const g2 = l.getContext("2d")!; g2.scale(2, 2); g2.font = "600 13px Space Grotesk, sans-serif"; g2.fillStyle = color; g2.textBaseline = "middle"; g2.fillText(txt, 4, 10);
        labels.set(key, l); if (labels.size > 200) labels.delete(labels.keys().next().value);
      }
      return l;
    };
    const MAX_FOOD = 1300;
    const addFood = (x?: number, y?: number, v = 1) => {
      const p = x === undefined ? randPos() : { x: x + rnd(-10, 10), y: y! + rnd(-10, 10) };
      const f = { ...p, r: 3 + v * 2, hue: Math.floor(rnd(0, 24)), v };
      if (foods.length >= MAX_FOOD) foods[Math.floor(Math.random() * foods.length)] = f; else foods.push(f);
    };
    const init = () => {
      snakes = []; foods = [];
      for (let i = 0; i < 900; i++) addFood();
      for (let i = 0; i < 18; i++) snakes.push(mk(NAMES[i % NAMES.length], true));
    };
    init();

    // --- multiplayer (realtime broadcast) ---
    const myKey = Math.random().toString(36).slice(2, 10);
    const remotes = new Map<string, Snake>();
    const ch = supabase.channel("neon-arena-" + room, { config: { broadcast: { self: false }, presence: { key: myKey } } });
    ch.on("broadcast", { event: "s" }, ({ payload: m }) => {
      let r = remotes.get(m.k);
      const pts: P[] = []; for (let i = 0; i < m.p.length; i += 2) pts.push({ x: m.p[i], y: m.p[i + 1] });
      if (!r) { r = { id: -1, name: m.n, pts, angle: m.a, target: m.a, len: m.l, hue: m.h, alive: true, bot: false, boost: m.b, think: 0, remote: true }; remotes.set(m.k, r); }
      r.name = m.n;
      if (!r.tgt || Math.abs(r.pts.length - pts.length) > 4) r.pts = pts.map((q) => ({ ...q }));
      else { while (r.pts.length < pts.length) r.pts.push({ ...r.pts[r.pts.length - 1] }); r.pts.length = pts.length; }
      r.tgt = pts; r.angle = m.a; r.len = m.l; r.hue = m.h; r.boost = m.b; r.skin = m.sk; r.seen = performance.now();
    });
    ch.on("broadcast", { event: "d" }, ({ payload: m }) => {
      const r = remotes.get(m.k); if (!r) return;
      for (let i = 0; i < r.pts.length; i++) addFood(r.pts[i].x, r.pts[i].y, 1 + Math.min(3, r.len / 80));
      remotes.delete(m.k);
    });
    ch.on("presence", { event: "sync" }, () => setOnline(Object.keys(ch.presenceState()).length || 1));
    ch.subscribe((st) => { if (st === "SUBSCRIBED") ch.track({ at: Date.now() }); });
    let sendT = 0;

    startRef.current = () => {
      me = mk(nameRef.current.trim() || "Sən", false); me.hue = 150; me.skin = skinRef.current; snakes.push(me); playing = true; setScore(10); setState("play");
    };

    const kill = (s: Snake) => {
      s.alive = false;
      const fv = Math.min(4, Math.max(1, (s.len * 0.6) / Math.max(1, s.pts.length / 2)));
      for (let i = 0; i < s.pts.length; i += 2) addFood(s.pts[i].x, s.pts[i].y, fv);
      if (s === me) { const add = coinsFor(s.len); setCoins((c) => { const n = c + add; localStorage.setItem("neon-coins", String(n)); return n; }); playing = false; setState("dead"); ch.send({ type: "broadcast", event: "d", payload: { k: myKey } }); }
    };

    const onMove = (e: PointerEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    const onDown = () => (mouse.down = true), onUp = () => (mouse.down = false);
    const onKey = (e: KeyboardEvent) => { if (e.code === "Space") mouse.down = e.type === "keydown"; };
    addEventListener("pointermove", onMove); addEventListener("pointerdown", onDown); addEventListener("pointerup", onUp);
    addEventListener("keydown", onKey); addEventListener("keyup", onKey);

    let last = performance.now(), hudT = 0, lbT = 0;
    const lb = document.createElement("canvas");
    const loop = (now: number) => {
      const dt = Math.min(3, (now - last) / 16.67); last = now;
      for (const [k, r] of remotes) if (now - (r.seen || 0) > 2500) remotes.delete(k);
      // smooth remote players: predict forward + interpolate
      for (const r of remotes.values()) {
        if (!r.tgt) continue;
        const age = Math.min(0.2, (now - (r.seen || now)) / 1000);
        const sp = (r.boost ? BOOST : SPEED) * 60 * age;
        const ox = Math.cos(r.angle) * sp, oy = Math.sin(r.angle) * sp;
        const k = 1 - Math.pow(0.6, dt);
        for (let i = 0; i < r.pts.length; i++) {
          const t = r.tgt[i] || r.tgt[r.tgt.length - 1], f = 1 - i / r.pts.length;
          r.pts[i].x += (t.x + ox * f - r.pts[i].x) * k; r.pts[i].y += (t.y + oy * f - r.pts[i].y) * k;
        }
      }
      let all = [...snakes, ...remotes.values()];
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
          for (const o of all) {
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
        const want = segCount(s.len);
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
        for (const o of all) {
          if (o === s || !o.alive) continue; const ow = width(o);
          const oh = o.pts[0]; if ((oh.x - h.x) ** 2 + (oh.y - h.y) ** 2 > (o.pts.length * SEG + 100) ** 2) continue;
          for (let i = 1; i < o.pts.length; i++) {
            const p = o.pts[i]; if ((p.x - h.x) ** 2 + (p.y - h.y) ** 2 < (w * 0.6 + ow) ** 2) { kill(s); break; }
          }
          if (!s.alive) break;
        }
      }
      snakes = snakes.filter((s) => s.alive);
      all = [...snakes, ...remotes.values()];
      if (me && me.alive && (sendT += dt) > 3) {
        sendT = 0; const p: number[] = [];
        for (let i = 0; i < me.pts.length; i += 2) p.push(Math.round(me.pts[i].x), Math.round(me.pts[i].y));
        ch.send({ type: "broadcast", event: "s", payload: { k: myKey, n: me.name, h: me.hue, l: me.len, a: +me.angle.toFixed(2), b: me.boost, sk: me.skin, p } });
      }
      while (snakes.filter((s) => s.bot).length < 18) snakes.push(mk(NAMES[Math.floor(rnd(0, NAMES.length))], true));
      while (foods.length < 900) addFood();

      // camera
      const focus = me && me.alive ? me.pts[0] : cam;
      cam.x += (focus.x - cam.x) * 0.15; cam.y += (focus.y - cam.y) * 0.15;
      const tz = me && me.alive ? Math.max(0.5, 1.15 - width(me) / 70) : 0.7; cam.z += (tz - cam.z) * 0.03;

      // draw
      const C = cfgRef.current; const d = dpr();
      if (c.width !== Math.round(innerWidth * d)) resize();
      fpsN++; fpsT += dt; if (fpsT >= 30) { if (C.showFps) setFps(Math.round(fpsN * 60 / fpsT)); fpsN = 0; fpsT = 0; }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
      ctx.setTransform(d * cam.z, 0, 0, d * cam.z, (innerWidth / 2) * d - cam.x * cam.z * d, (innerHeight / 2) * d - cam.y * cam.z * d);
      const vw = innerWidth / cam.z / 2 + 60, vh = innerHeight / cam.z / 2 + 60;
      // hex grid
      ctx.strokeStyle = "rgba(120,160,255,0.06)"; ctx.lineWidth = 2; const g = 60;
      if (C.grid) { ctx.beginPath();
      for (let x = Math.floor((cam.x - vw) / g) * g; x < cam.x + vw; x += g) { ctx.moveTo(x, cam.y - vh); ctx.lineTo(x, cam.y + vh); }
      for (let y = Math.floor((cam.y - vh) / g) * g; y < cam.y + vh; y += g) { ctx.moveTo(cam.x - vw, y); ctx.lineTo(cam.x + vw, y); }
      ctx.stroke(); }
      ctx.strokeStyle = "rgba(255,60,100,0.6)"; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0, 0, WORLD, 0, 7); ctx.stroke();
      // food (sprites)
      const ps = now / 300;
      for (const f of foods) {
        if (Math.abs(f.x - cam.x) > vw || Math.abs(f.y - cam.y) > vh) continue;
        if (!C.glow) { ctx.fillStyle = FOODC[f.hue]; ctx.fillRect(f.x - f.r * 0.8, f.y - f.r * 0.8, f.r * 1.6, f.r * 1.6); continue; }
        const sz = f.r * 2.5 * (1 + Math.sin(ps + f.x) * 0.15);
        ctx.drawImage(SPR[f.hue], f.x - sz, f.y - sz, sz * 2, sz * 2);
      }
      // snakes
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const s of all) {
        const w = width(s), h = s.pts[0];
        if (Math.abs(h.x - cam.x) > vw + s.pts.length * SEG || Math.abs(h.y - cam.y) > vh + s.pts.length * SEG) continue;
        // one path, two cheap strokes (no dashes, no shadowBlur)
        const sk = SKIN_BY[s.skin || "hue"] || SKIN_BY.hue, n = s.pts.length;
        ctx.beginPath(); ctx.moveTo(s.pts[n - 1].x, s.pts[n - 1].y);
        for (let i = n - 2; i >= 0; i--) ctx.lineTo(s.pts[i].x, s.pts[i].y);
        if (s.boost && C.boostFx) { ctx.strokeStyle = sk.type === "hue" ? `hsla(${s.hue | 0},100%,60%,0.25)` : sk.colors[0] + "44"; ctx.lineWidth = w * 2 + 16; ctx.stroke(); }
        if (sk.type === "hue") {
          ctx.strokeStyle = `hsl(${s.hue | 0},90%,42%)`; ctx.lineWidth = w * 2; ctx.stroke();
          ctx.strokeStyle = `hsl(${s.hue | 0},90%,58%)`; ctx.lineWidth = w * 1.1; ctx.stroke();
        } else if (sk.type === "bands") {
          const m = sk.colors.length;
          for (let j = 0; j < m; j++) { ctx.strokeStyle = sk.colors[j]; ctx.lineWidth = w * 2 * (1 - j / m); ctx.stroke(); }
        } else {
          const m = sk.colors.length, K = 4, an = sk.type === "anim", sh = an ? Math.floor(now / 60) % (K * m) : 0;
          for (let j = 0; j < m; j++) {
            ctx.beginPath();
            for (let i = (j * K + sh) % (K * m) - K * m; i < n - 1; i += K * m) { const i0 = Math.max(0, i); ctx.moveTo(s.pts[i0].x, s.pts[i0].y); for (let q = i0 + 1; q <= Math.min(i + K, n - 1); q++) ctx.lineTo(s.pts[q].x, s.pts[q].y); }
            ctx.strokeStyle = an ? `hsl(${(now / 8 + j * (360 / m)) % 360 | 0},100%,60%)` : sk.colors[j]; ctx.lineWidth = w * 2; ctx.stroke();
          }
        }
        // eyes
        for (const side of [-1, 1]) {
          const ex = h.x + Math.cos(s.angle + side * 0.6) * w * 0.6, ey = h.y + Math.sin(s.angle + side * 0.6) * w * 0.6;
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, ey, w * 0.38, 0, 7); ctx.fill();
          ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(ex + Math.cos(s.angle) * w * 0.15, ey + Math.sin(s.angle) * w * 0.15, w * 0.2, 0, 7); ctx.fill();
        }
        if (!C.names) continue;
        const L = label(s.bot ? `🤖 ${s.name} (bot)` : s.remote ? `👤 ${s.name}` : s.name, s.bot ? "rgba(180,190,210,0.75)" : s === me ? "#5f8" : "#ffd84a");
        ctx.drawImage(L, h.x - L.width / 4, h.y - w - 22, L.width / 2, L.height / 2);
      }
      // HUD: leaderboard (redrawn ~4x/sec into a cached canvas) + minimap
      ctx.setTransform(d, 0, 0, d, 0, 0);
      if ((lbT -= dt) <= 0) {
        lbT = 15;
        const top = [...all].sort((a, b) => b.len - a.len).slice(0, 10);
        lb.width = 194 * d; lb.height = (28 + top.length * 20) * d; const g = lb.getContext("2d")!; g.scale(d, d);
        g.fillStyle = "rgba(10,14,30,0.55)"; g.fillRect(0, 0, 194, 28 + top.length * 20);
        g.font = "700 13px Space Grotesk, sans-serif"; g.fillStyle = "#7cf"; g.fillText("LİDERLƏR", 14, 20);
        g.font = "500 12px Space Grotesk, sans-serif";
        top.forEach((s, i) => {
          g.fillStyle = s === me ? "#5f8" : s.bot ? "rgba(180,190,210,0.7)" : "#ffd84a"; g.textAlign = "left";
          g.fillText(`${i + 1}. ${s.bot ? "🤖 " : "👤 "}${s.name}`, 14, 42 + i * 20);
          g.textAlign = "right"; g.fillText(String(Math.floor(s.len * 10)), 184, 42 + i * 20);
        });
      }
      ctx.drawImage(lb, innerWidth - 210, 16, lb.width / d, lb.height / d);
      if (C.minimap) {
      const mr = 60, mx = innerWidth - 80, my = innerHeight - 80;
      ctx.fillStyle = "rgba(10,14,30,0.6)"; ctx.beginPath(); ctx.arc(mx, my, mr, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(255,60,100,0.6)"; ctx.lineWidth = 2; ctx.stroke();
      for (const s of all) { ctx.fillStyle = s === me ? "#5f8" : `hsla(${s.hue},90%,60%,0.7)`; ctx.beginPath(); ctx.arc(mx + (s.pts[0].x / WORLD) * mr, my + (s.pts[0].y / WORLD) * mr, s === me ? 3.5 : 2, 0, 7); ctx.fill(); }
      }

      if (me && playing && (hudT += dt) > 10) { hudT = 0; setScore(Math.floor(me.len * 10)); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf); supabase.removeChannel(ch); removeEventListener("resize", resize); removeEventListener("pointermove", onMove);
      removeEventListener("pointerdown", onDown); removeEventListener("pointerup", onUp); removeEventListener("keydown", onKey); removeEventListener("keyup", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  const nameRef = useRef(name); nameRef.current = name;
  const has = (id: string) => owned.includes(id) || paid.includes(id);
  const [buying, setBuying] = useState(false);
  const buyReal = async (id: string) => {
    if (!user) { setAuthMsg("Pulla almaq üçün əvvəlcə Google ilə gir."); setTimeout(() => setAuthMsg(""), 4000); return; }
    setBuying(true);
    try {
      await initializePaddle();
      const pid = await getPaddlePriceId(PAID_SKINS[id].priceId);
      window.Paddle.Checkout.open({ items: [{ priceId: pid, quantity: 1 }], customer: user.email ? { email: user.email } : undefined, customData: { userId: user.id },
        settings: { displayMode: "overlay", successUrl: `${window.location.origin}/?bought=${id}`, allowLogout: false, variant: "one-page" } });
      window.Paddle.Update?.({ eventCallback: (e: any) => { if (e?.name === "checkout.completed") { let n = 0; const t = setInterval(() => { loadPaid(user.id); if (++n > 10) clearInterval(t); }, 2000); } } });
    } catch (e) { console.error(e); setAuthMsg("Ödəniş açılmadı, yenidən yoxla."); }
    finally { setBuying(false); }
  };
  const ownedSkins = SKINS.filter((k) => has(k.id));
  const cycle = (d: number) => { const i = SKINS.findIndex((k) => k.id === preview); const n = SKINS[(i + d + SKINS.length) % SKINS.length]; setPreview(n.id); if (has(n.id)) { setSkin(n.id); localStorage.setItem("neon-skin", n.id); } };
  const cur = SKIN_BY[preview] || SKIN_BY.hue;
  const curBg = cur.type === "bands" ? `linear-gradient(${cur.colors.join(",")})` : cur.type !== "hue" ? `repeating-linear-gradient(90deg,${cur.colors.map((c, i) => `${c} ${i * 14}px ${(i + 1) * 14}px`).join(",")})` : cur.colors[0];
  const google = async () => { const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin }); if (r.error) { console.error(r.error); setAuthMsg("Google ilə giriş alınmadı — bir az sonra yenidən yoxla."); setTimeout(() => setAuthMsg(""), 4000); } };
  void 0;
  const fs = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); };
  void ownedSkins;

  return (
    <div className="fixed inset-0 overflow-hidden bg-background select-none">
      <canvas ref={cvs} className="block touch-none" />
      {getPaddleEnvironment() === "sandbox" && state !== "play" && <div className="pointer-events-none absolute left-0 right-0 top-0 z-30 bg-accent/80 py-1 text-center text-xs text-accent-foreground">Önizləmədə ödənişlər test rejimindədir (real pul çəkilmir)</div>}
      <div className="pointer-events-none absolute bottom-4 left-4 rounded-xl bg-card/60 px-3 py-2 text-xs text-foreground backdrop-blur">
        🟢 Onlayn oyunçu: <b className="text-primary">{online}</b> · 👤 insan · 🤖 bot
      </div>
      {cfg.showFps && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-card/60 px-2 py-1 text-xs text-foreground">FPS: <b className="text-primary">{fps}</b></div>
      )}
      <button type="button" onClick={() => setShowCfg((v) => !v)} aria-label="Parametrlər"
        className="absolute bottom-16 left-4 z-20 rounded-xl border border-border bg-card/70 px-3 py-2 text-sm text-foreground backdrop-blur hover:border-primary">⚙️ Qrafika</button>
      {state !== "play" && (
        <Link to="/setup"
          className="absolute bottom-16 left-36 z-20 rounded-xl border border-border bg-card/70 px-3 py-2 text-sm text-foreground backdrop-blur hover:border-primary">📋 Quraşdırma</Link>
      )}
      {showCfg && (
        <div className="absolute bottom-28 left-4 z-20 w-64 rounded-2xl border border-border bg-card/90 p-4 text-sm text-foreground backdrop-blur">
          <div className="mb-2 font-display font-bold">Qrafika keyfiyyəti</div>
          <div className="mb-3 grid grid-cols-3 gap-1">
            {(["low", "medium", "high"] as const).map((q) => (
              <button key={q} type="button" onClick={() => upd({ quality: q })}
                className={`rounded-lg py-1.5 text-xs ${cfg.quality === q ? "bg-primary text-primary-foreground" : "bg-background/60"}`}>
                {q === "low" ? "Aşağı" : q === "medium" ? "Orta" : "Yüksək"}
              </button>
            ))}
          </div>
          {([["grid", "Arxa fon şəbəkəsi"], ["glow", "Yem parıltısı"], ["boostFx", "Sürət effekti"], ["names", "Adlar"], ["minimap", "Kiçik xəritə"], ["showFps", "FPS göstər"]] as const).map(([k, t]) => (
            <label key={k} className="flex cursor-pointer items-center justify-between py-1">
              <span>{t}</span>
              <input type="checkbox" checked={cfg[k]} onChange={(e) => upd({ [k]: e.target.checked } as Partial<Cfg>)} className="h-4 w-4 accent-primary" />
            </label>
          ))}
          <p className="mt-2 text-xs text-muted-foreground">Donursa: keyfiyyəti "Aşağı" et və effektləri söndür.</p>
        </div>
      )}
      {state === "play" && (
        <div className="pointer-events-none absolute left-4 top-4 rounded-xl bg-card/60 px-4 py-2 font-display text-foreground backdrop-blur">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Uzunluq</div>
          <div className="text-2xl font-bold text-primary">{score}</div>
        </div>
      )}
      {state !== "play" && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <form
            onSubmit={(e) => { e.preventDefault(); if (has(preview)) startRef.current(); }}
            className="max-h-[96vh] w-[min(94vw,460px)] overflow-y-auto rounded-3xl border border-border bg-card/85 p-5 text-center shadow-glow"
          >
            <div className="flex items-center justify-between">
              <h1 className="font-display text-3xl font-bold tracking-tight text-gradient">neon.io<span className="sr-only"> — onlayn neon ilan oyunu</span></h1>
              {user ? (
                <button type="button" onClick={() => supabase.auth.signOut()} className="flex items-center gap-2 rounded-full border border-border bg-background/60 px-2 py-1 text-xs text-foreground" title="Çıxış">
                  {user.avatar && <img src={user.avatar} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />}{user.name} ✕
                </button>
              ) : (
                <button type="button" onClick={google} className="rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary">G Google ilə gir</button>
              )}
            </div>
            {authMsg && <p className="mt-2 rounded-lg bg-destructive/20 px-2 py-1 text-xs text-foreground">{authMsg}</p>}
            <p className="mt-1 text-left text-sm font-semibold text-foreground">Neon ilan oyunu</p>
            <p className="text-left text-xs text-muted-foreground">{state === "dead" ? `Öldün! Son uzunluq: ${score}` : "Ye, böyü, rəqibləri kəs."}</p>

            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border bg-background/60 p-3">
              <button type="button" onClick={() => cycle(-1)} aria-label="Əvvəlki skin" className="font-display text-4xl font-bold text-primary">‹</button>
              <div className="flex-1">
                <div className="relative mx-auto h-10 w-48 rounded-full" style={{ background: curBg }}>
                  <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-foreground" /><span className="absolute right-2 bottom-2 h-2.5 w-2.5 rounded-full bg-foreground" />
                </div>
                <div className="mt-2 text-sm font-semibold text-foreground">{cur.name}</div>
                <div className="text-xs text-muted-foreground">🪙 <b className="text-primary">{coins}</b> · {has(cur.id) ? "Səndədir ✓" : PAID_SKINS[cur.id] ? `Premium · ${PAID_SKINS[cur.id].label}` : `Qiymət: 🪙${cur.price}`}</div>
              </div>
              <button type="button" onClick={() => cycle(1)} aria-label="Növbəti skin" className="font-display text-4xl font-bold text-primary">›</button>
            </div>

            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={14} placeholder="Adın"
              className="mt-3 w-full rounded-xl border border-input bg-background/60 px-4 py-2.5 text-center text-foreground outline-none focus:border-primary" />

            {has(cur.id) ? (
              <button type="submit" className="mt-3 w-full rounded-2xl bg-accent py-4 font-display text-2xl font-bold uppercase tracking-wide text-accent-foreground shadow-glow transition hover:scale-[1.02]">
                {state === "dead" ? "Yenidən oyna" : "Oyna"}
              </button>
            ) : PAID_SKINS[cur.id] ? (
              <button type="button" onClick={() => buyReal(cur.id)} disabled={buying}
                className="mt-3 w-full rounded-2xl bg-primary py-4 font-display text-xl font-bold text-primary-foreground disabled:opacity-50">
                {buying ? "Açılır..." : `💳 Al ${PAID_SKINS[cur.id].label}`}
              </button>
            ) : (
              <button type="button" onClick={() => pick(cur.id)} disabled={coins < cur.price}
                className="mt-3 w-full rounded-2xl bg-primary py-4 font-display text-xl font-bold text-primary-foreground disabled:opacity-50">
                {coins < cur.price ? `Sikkə çatmır (🪙${cur.price})` : `Al 🪙${cur.price}`}
              </button>
            )}
            <button type="button" onClick={fs} className="mt-2 w-full rounded-xl border border-border bg-background/60 py-2 text-sm font-semibold text-foreground hover:border-primary">⛶ Tam ekran</button>

            <div className="mt-4 flex justify-end gap-1">
              {(Object.keys(REGIONS) as (keyof typeof REGIONS)[]).map((r) => (
                <button key={r} type="button" onClick={() => setRegion(r)}
                  className={`rounded-full border px-3 py-1 text-xs ${region === r ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground"}`}>{r}</button>
              ))}
            </div>
            <div className="mt-2 space-y-1.5">
              {REGIONS[region].map(([id, flag, label]) => {
                const n = counts[id] || 0, pct = Math.min(100, (n / ROOM_MAX) * 100);
                return (
                  <button key={id} type="button" onClick={() => setRoom(id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left ${room === id ? "border-primary bg-primary/10" : "border-border bg-background/50"}`}>
                    <span className="text-sm font-semibold text-foreground">{flag} {label}</span>
                    <span className="w-28">
                      <span className="block text-right text-[10px] text-muted-foreground">OYUNÇU <b className="text-foreground">{n} / {ROOM_MAX}</b></span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${Math.max(4, pct)}%` }} /></span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground">Siçanla idarə et · Klik / Space = sürətlən · 🤖 botlar hər serverdə var</p>
          </form>
        </div>
      )}
    </div>
  );
}
