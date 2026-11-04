import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { mountGame, type GameConfig } from "@/game/canvas-runtime";
import type { ArenaMode } from "@/game/arena-client";
import { supabase } from "@/integrations/supabase/client";
import { SKINS, SKIN_BY, coinsFor } from "@/lib/skins";
import { lovable } from "@/integrations/lovable/index";
import { PAID_SKINS, initializePaddle, getPaddlePriceId, getPaddleEnvironment } from "@/lib/paddle";

const REGIONS = {
  Avropa: [
    ["eu-1", "🇦🇿", "Bakı 1"],
    ["eu-2", "🇹🇷", "İstanbul 1"],
    ["eu-3", "🇩🇪", "Frankfurt 1"],
    ["eu-4", "🇫🇷", "Paris 1"],
  ],
  Asiya: [
    ["as-1", "🇯🇵", "Tokio 1"],
    ["as-2", "🇸🇬", "Sinqapur 1"],
  ],
  Amerika: [
    ["am-1", "🇺🇸", "Nyu-York 1"],
    ["am-2", "🇧🇷", "San-Paulu 1"],
  ],
} as const;
const ROOM_MAX = 50;

type Cfg = GameConfig;
const DEF: Cfg = {
  quality: "medium",
  grid: true,
  glow: true,
  boostFx: true,
  names: true,
  minimap: true,
  showFps: false,
};
export default function SnakeGame() {
  const cvs = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"menu" | "play" | "dead">("menu");
  const [name, setName] = useState("");
  const [score, setScore] = useState(0);
  const [online, setOnline] = useState(1);
  const [mode, setMode] = useState<ArenaMode>("connecting");
  const startRef = useRef<() => void>(() => {});
  const [cfg, setCfg] = useState<Cfg>(DEF);
  const [showCfg, setShowCfg] = useState(false);
  const [fps, setFps] = useState(0);
  const cfgRef = useRef<Cfg>(DEF);
  cfgRef.current = cfg;
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem("neon-cfg") || "null");
      if (v) setCfg({ ...DEF, ...v });
    } catch {
      /* ignore */
    }
  }, []);
  const [coins, setCoins] = useState(0);
  const [owned, setOwned] = useState<string[]>(["hue"]);
  const [skin, setSkin] = useState("hue");
  const skinRef = useRef(skin);
  skinRef.current = skin;
  useEffect(() => {
    try {
      setCoins(+(localStorage.getItem("neon-coins") || 0));
      setOwned(JSON.parse(localStorage.getItem("neon-owned") || '["hue"]'));
      setSkin(localStorage.getItem("neon-skin") || "hue");
    } catch {
      /* ignore */
    }
  }, []);
  // progress (coins, coin-unlocked skins, selected skin) is saved locally AND to the signed-in account
  const userRef = useRef<string | null>(null);
  const coinsRef = useRef(coins);
  coinsRef.current = coins;
  const ownedRef = useRef(owned);
  ownedRef.current = owned;
  const persist = (c: number, o: string[], s: string) => {
    try {
      localStorage.setItem("neon-coins", String(c));
      localStorage.setItem("neon-owned", JSON.stringify(o));
      localStorage.setItem("neon-skin", s);
    } catch {
      /* ignore */
    }
    const uid = userRef.current;
    if (uid)
      supabase
        .from("player_progress")
        .upsert({
          user_id: uid,
          coins: Math.max(0, Math.floor(c)),
          owned: o,
          skin: s,
          updated_at: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (error) console.error(error);
        });
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const syncProgress = async (uid: string) => {
    const { data, error } = await supabase
      .from("player_progress")
      .select("coins,owned,skin")
      .eq("user_id", uid)
      .maybeSingle();
    if (error) {
      console.error(error);
      return;
    }
    let lc = 0,
      lo: string[] = ["hue"],
      ls = "hue",
      synced = false;
    try {
      lc = +(localStorage.getItem("neon-coins") || 0);
      lo = JSON.parse(localStorage.getItem("neon-owned") || '["hue"]');
      ls = localStorage.getItem("neon-skin") || "hue";
      synced = localStorage.getItem("neon-synced") === uid;
    } catch {
      /* ignore */
    }
    // first time on this device: merge local progress in; afterwards the account is the source of truth
    const c = data ? (synced ? data.coins : Math.max(data.coins, lc)) : lc;
    const o = [...new Set(["hue", ...(data?.owned || []), ...(synced && data ? [] : lo)])];
    const s = data?.skin || ls;
    try {
      localStorage.setItem("neon-synced", uid);
    } catch {
      /* ignore */
    }
    setCoins(c);
    setOwned(o);
    setSkin(s);
    persistRef.current(c, o, s);
  };
  const pick = (id: string) => {
    const k = SKIN_BY[id];
    if (!k) return;
    if (owned.includes(id) || paid.includes(id)) {
      setSkin(id);
      persist(coins, owned, id);
      return;
    }
    if (PAID_SKINS[id]) return;
    if (coins < k.price) return;
    const c = coins - k.price,
      o = [...owned, id];
    setCoins(c);
    setOwned(o);
    setSkin(id);
    persist(c, o, id);
  };
  const upd = (p: Partial<Cfg>) =>
    setCfg((o) => {
      const n = { ...o, ...p };
      localStorage.setItem("neon-cfg", JSON.stringify(n));
      return n;
    });
  const [preview, setPreview] = useState("hue");
  const [authMsg, setAuthMsg] = useState("");
  useEffect(() => {
    setPreview(skin);
  }, [skin]);
  const [region, setRegion] = useState<keyof typeof REGIONS>("Avropa");
  const [room, setRoom] = useState("eu-1");
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("room");
    if (!r) return;
    for (const reg of Object.keys(REGIONS) as (keyof typeof REGIONS)[])
      if (REGIONS[reg].some((s) => s[0] === r)) {
        setRegion(reg);
        setRoom(r);
      }
  }, []);
  const [user, setUser] = useState<{
    id: string;
    email?: string;
    name: string;
    avatar?: string;
  } | null>(null);
  const [paid, setPaid] = useState<string[]>([]);
  const loadPaid = async (uid: string) => {
    const { data } = await supabase
      .from("skin_purchases")
      .select("skin_id")
      .eq("user_id", uid)
      .eq("environment", getPaddleEnvironment());
    setPaid((data || []).map((d) => d.skin_id));
  };
  useEffect(() => {
    const apply = (u: User | null | undefined) => {
      if (!u) {
        userRef.current = null;
        setUser(null);
        setPaid([]);
        return;
      }
      const n = String(u.user_metadata["full_name"] || u.email || "")
        .split(" ")[0]!
        .slice(0, 14);
      setUser({
        id: u.id,
        ...(u.email ? { email: u.email } : {}),
        name: n,
        ...(typeof u.user_metadata["avatar_url"] === "string"
          ? { avatar: u.user_metadata["avatar_url"] }
          : {}),
      });
      setName((o) => o || n);
      if (userRef.current !== u.id) {
        userRef.current = u.id;
        loadPaid(u.id);
        syncProgress(u.id);
      }
    };
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
      Object.values(lb.presenceState<{ room: string }>()).forEach((arr) => {
        const r = arr[0]?.room;
        if (r) c[r] = (c[r] || 0) + 1;
      });
      setCounts(c);
    });
    lb.subscribe((st) => {
      if (st === "SUBSCRIBED") lb.track({ room });
    });
    return () => {
      supabase.removeChannel(lb);
    };
  }, [room]);

  useEffect(() => {
    if (!cvs.current) return;
    setState("menu");
    const game = mountGame(cvs.current, room, {
      config: () => cfgRef.current,
      profile: () => ({ name: nameRef.current.trim() || "Sən", skin: skinRef.current }),
      mode: setMode,
      count: setOnline,
      score: setScore,
      fps: setFps,
      start: () => {
        setScore(100);
        setState("play");
      },
      death: (length) => {
        const next = coinsRef.current + coinsFor(length);
        coinsRef.current = next;
        setScore(Math.floor(length * 10));
        setCoins(next);
        setState("dead");
        persistRef.current(next, ownedRef.current, skinRef.current);
      },
      error: (reason) => {
        setAuthMsg(reason);
        setState("menu");
      },
    });
    startRef.current = game.play;
    return () => {
      startRef.current = () => {};
      game.dispose();
    };
  }, [room]);

  const nameRef = useRef(name);
  nameRef.current = name;
  const has = (id: string) => owned.includes(id) || paid.includes(id);
  const [buying, setBuying] = useState(false);
  const buyReal = async (id: string) => {
    if (!user) {
      setAuthMsg("Pulla almaq üçün əvvəlcə Google ilə gir.");
      setTimeout(() => setAuthMsg(""), 4000);
      return;
    }
    setBuying(true);
    try {
      await initializePaddle();
      const pid = await getPaddlePriceId(PAID_SKINS[id]!.priceId);
      window.Paddle.Checkout.open({
        items: [{ priceId: pid, quantity: 1 }],
        customer: user.email ? { email: user.email } : undefined,
        customData: { userId: user.id },
        settings: {
          displayMode: "overlay",
          successUrl: `${window.location.origin}/?bought=${id}`,
          allowLogout: false,
          variant: "one-page",
        },
      });
      window.Paddle.Update?.({
        eventCallback: (e: any) => {
          if (e?.name === "checkout.completed") {
            let n = 0;
            const t = setInterval(() => {
              loadPaid(user.id);
              if (++n > 10) clearInterval(t);
            }, 2000);
          }
        },
      });
    } catch (e) {
      console.error(e);
      setAuthMsg("Ödəniş açılmadı, yenidən yoxla.");
    } finally {
      setBuying(false);
    }
  };
  const ownedSkins = SKINS.filter((k) => has(k.id));
  const cycle = (d: number) => {
    const i = SKINS.findIndex((k) => k.id === preview);
    const n = SKINS[(i + d + SKINS.length) % SKINS.length]!;
    setPreview(n.id);
    if (has(n.id)) {
      setSkin(n.id);
      persist(coins, owned, n.id);
    }
  };
  const cur = SKIN_BY[preview] || SKINS[0]!;
  const curBg =
    cur.type === "bands" || cur.type === "pulse"
      ? `linear-gradient(${cur.colors.join(",")})`
      : cur.type !== "hue"
        ? `repeating-linear-gradient(90deg,${cur.colors.map((c, i) => `${c} ${i * 14}px ${(i + 1) * 14}px`).join(",")})`
        : cur.colors[0];
  const google = async () => {
    const r = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (r.error) {
      console.error(r.error);
      setAuthMsg("Google ilə giriş alınmadı — bir az sonra yenidən yoxla.");
      setTimeout(() => setAuthMsg(""), 4000);
    }
  };
  void 0;
  const fs = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };
  void ownedSkins;

  return (
    <div className="fixed inset-0 overflow-hidden bg-background select-none">
      <canvas ref={cvs} className="block h-full w-full touch-none" aria-label="Neon ilan oyunu" />
      {getPaddleEnvironment() === "sandbox" && state !== "play" && (
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-30 bg-accent/80 py-1 text-center text-xs text-accent-foreground">
          Önizləmədə ödənişlər test rejimindədir (real pul çəkilmir)
        </div>
      )}
      <div className="pointer-events-none absolute bottom-4 left-4 rounded-xl bg-card/80 px-3 py-2 text-xs text-foreground">
        {mode === "offline" ? (
          "🟡 Lokal oflayn oyun"
        ) : mode === "connecting" ? (
          "⏳ Serverə qoşulur..."
        ) : (
          <>
            🟢 Onlayn oyunçu: <b className="text-primary">{online}</b> · 🤖 ortaq botlar
          </>
        )}
      </div>
      {cfg.showFps && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-card/60 px-2 py-1 text-xs text-foreground">
          FPS: <b className="text-primary">{fps}</b>
        </div>
      )}
      <button
        type="button"
        onClick={() => setShowCfg((v) => !v)}
        aria-label="Parametrlər"
        className="absolute bottom-16 left-4 z-20 rounded-xl border border-border bg-card/70 px-3 py-2 text-sm text-foreground hover:border-primary"
      >
        ⚙️ Qrafika
      </button>
      {showCfg && (
        <div className="absolute bottom-28 left-4 z-20 w-64 rounded-2xl border border-border bg-card/90 p-4 text-sm text-foreground">
          <div className="mb-2 font-display font-bold">Qrafika keyfiyyəti</div>
          <div className="mb-3 grid grid-cols-3 gap-1">
            {(["low", "medium", "high"] as const).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => upd({ quality: q })}
                className={`rounded-lg py-1.5 text-xs ${cfg.quality === q ? "bg-primary text-primary-foreground" : "bg-background/60"}`}
              >
                {q === "low" ? "Aşağı" : q === "medium" ? "Orta" : "Yüksək"}
              </button>
            ))}
          </div>
          {(
            [
              ["grid", "Arxa fon şəbəkəsi"],
              ["glow", "Yem parıltısı"],
              ["boostFx", "Sürət effekti"],
              ["names", "Adlar"],
              ["minimap", "Kiçik xəritə"],
              ["showFps", "FPS göstər"],
            ] as const
          ).map(([k, t]) => (
            <label key={k} className="flex cursor-pointer items-center justify-between py-1">
              <span>{t}</span>
              <input
                type="checkbox"
                checked={cfg[k]}
                onChange={(e) => upd({ [k]: e.target.checked } as Partial<Cfg>)}
                className="h-4 w-4 accent-primary"
              />
            </label>
          ))}
          <p className="mt-2 text-xs text-muted-foreground">
            Donursa: keyfiyyəti "Aşağı" et və effektləri söndür.
          </p>
        </div>
      )}
      {state === "play" && (
        <div className="pointer-events-none absolute left-4 top-4 rounded-xl bg-card/80 px-4 py-2 font-display text-foreground">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Uzunluq</div>
          <div className="text-2xl font-bold text-primary">{score}</div>
        </div>
      )}
      {state !== "play" && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (has(preview)) startRef.current();
            }}
            className="max-h-[96vh] w-[min(94vw,460px)] overflow-y-auto rounded-3xl border border-border bg-card/85 p-5 text-center shadow-glow"
          >
            <div className="flex items-center justify-between">
              <h1 className="font-display text-3xl font-bold tracking-tight text-gradient">
                neon.io<span className="sr-only"> — onlayn neon ilan oyunu</span>
              </h1>
              {user ? (
                <button
                  type="button"
                  onClick={() => supabase.auth.signOut()}
                  className="flex items-center gap-2 rounded-full border border-border bg-background/60 px-2 py-1 text-xs text-foreground"
                  title="Çıxış"
                >
                  {user.avatar && (
                    <img
                      src={user.avatar}
                      alt=""
                      className="h-6 w-6 rounded-full"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  {user.name} ✕
                </button>
              ) : (
                <button
                  type="button"
                  onClick={google}
                  className="rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary"
                >
                  G Google ilə gir
                </button>
              )}
            </div>
            {authMsg && (
              <p className="mt-2 rounded-lg bg-destructive/20 px-2 py-1 text-xs text-foreground">
                {authMsg}
              </p>
            )}
            <p className="mt-1 text-left text-sm font-semibold text-foreground">Neon ilan oyunu</p>
            <p className="text-left text-xs text-muted-foreground">
              {state === "dead" ? `Öldün! Son uzunluq: ${score}` : "Ye, böyü, rəqibləri kəs."}
            </p>

            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border bg-background/60 p-3">
              <button
                type="button"
                onClick={() => cycle(-1)}
                aria-label="Əvvəlki skin"
                className="font-display text-4xl font-bold text-primary"
              >
                ‹
              </button>
              <div className="flex-1">
                <div
                  className="relative mx-auto h-10 w-48 rounded-full"
                  style={{ background: curBg }}
                >
                  <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-foreground" />
                  <span className="absolute right-2 bottom-2 h-2.5 w-2.5 rounded-full bg-foreground" />
                </div>
                <div className="mt-2 text-sm font-semibold text-foreground">{cur.name}</div>
                <div className="text-xs text-muted-foreground">
                  🪙 <b className="text-primary">{coins}</b> ·{" "}
                  {has(cur.id)
                    ? "Səndədir ✓"
                    : PAID_SKINS[cur.id]
                      ? `Premium · ${PAID_SKINS[cur.id]!.label}`
                      : `Qiymət: 🪙${cur.price}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => cycle(1)}
                aria-label="Növbəti skin"
                className="font-display text-4xl font-bold text-primary"
              >
                ›
              </button>
            </div>

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={14}
              placeholder="Adın"
              className="mt-3 w-full rounded-xl border border-input bg-background/60 px-4 py-2.5 text-center text-foreground outline-none focus:border-primary"
            />

            {has(cur.id) ? (
              <button
                type="submit"
                className="mt-3 w-full rounded-2xl bg-accent py-4 font-display text-2xl font-bold uppercase tracking-wide text-accent-foreground shadow-glow transition hover:scale-[1.02]"
              >
                {state === "dead" ? "Yenidən oyna" : "Oyna"}
              </button>
            ) : PAID_SKINS[cur.id] ? (
              <button
                type="button"
                onClick={() => buyReal(cur.id)}
                disabled={buying}
                className="mt-3 w-full rounded-2xl bg-primary py-4 font-display text-xl font-bold text-primary-foreground disabled:opacity-50"
              >
                {buying ? "Açılır..." : `💳 Al ${PAID_SKINS[cur.id]!.label}`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => pick(cur.id)}
                disabled={coins < cur.price}
                className="mt-3 w-full rounded-2xl bg-primary py-4 font-display text-xl font-bold text-primary-foreground disabled:opacity-50"
              >
                {coins < cur.price ? `Sikkə çatmır (🪙${cur.price})` : `Al 🪙${cur.price}`}
              </button>
            )}
            <button
              type="button"
              onClick={fs}
              className="mt-2 w-full rounded-xl border border-border bg-background/60 py-2 text-sm font-semibold text-foreground hover:border-primary"
            >
              ⛶ Tam ekran
            </button>
            {(() => {
              const link = `https://neonworm.app/?room=${room}`;
              const txt = encodeURIComponent(`Mənimlə neonworm.app-da oyna! 🐍 ${link}`);
              const share = async () => {
                try {
                  if (navigator.share)
                    await navigator.share({
                      title: "neon.io",
                      text: "Mənimlə oyna! 🐍",
                      url: link,
                    });
                  else {
                    await navigator.clipboard.writeText(link);
                    setAuthMsg("Link kopyalandı ✅");
                    setTimeout(() => setAuthMsg(""), 2500);
                  }
                } catch {}
              };
              return (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={share}
                    className="rounded-xl border border-border bg-background/60 py-2 text-xs font-semibold text-foreground hover:border-primary"
                  >
                    🔗 Dəvət et
                  </button>
                  <a
                    href={`https://wa.me/?text=${txt}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-border bg-background/60 py-2 text-center text-xs font-semibold text-foreground hover:border-primary"
                  >
                    WhatsApp
                  </a>
                  <a
                    href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Mənimlə oyna! 🐍")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-border bg-background/60 py-2 text-center text-xs font-semibold text-foreground hover:border-primary"
                  >
                    Telegram
                  </a>
                </div>
              );
            })()}

            <div className="mt-4 flex justify-end gap-1">
              {(Object.keys(REGIONS) as (keyof typeof REGIONS)[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRegion(r)}
                  className={`rounded-full border px-3 py-1 text-xs ${region === r ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground"}`}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="mt-2 space-y-1.5">
              {REGIONS[region].map(([id, flag, label]) => {
                const n = counts[id] || 0,
                  pct = Math.min(100, (n / ROOM_MAX) * 100);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setRoom(id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left ${room === id ? "border-primary bg-primary/10" : "border-border bg-background/70"}`}
                  >
                    <span className="text-sm font-semibold text-foreground">
                      {flag} {label}
                    </span>
                    <span className="w-28">
                      <span className="block text-right text-[10px] text-muted-foreground">
                        OYUNÇU{" "}
                        <b className="text-foreground">
                          {n} / {ROOM_MAX}
                        </b>
                      </span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full bg-primary"
                          style={{ width: `${Math.max(4, pct)}%` }}
                        />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground">
              Siçanla idarə et · Klik / Space = sürətlən · 🤖 botlar hər serverdə var
            </p>
          </form>
        </div>
      )}
    </div>
  );
}
