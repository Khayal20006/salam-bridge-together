import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import GameCanvas from "./GameCanvas";
import { GAME_VERSION } from "@/game/version";
import { supabase } from "@/integrations/supabase/client";
import { SKINS, SKIN_BY, coinsFor } from "@/lib/skins";
import { lovable } from "@/integrations/lovable/index";
import { PAID_SKINS, initializePaddle, getPaddlePriceId, getPaddleEnvironment } from "@/lib/paddle";
import {
  DEFAULT_CONFIG,
  loadConfig,
  loadProgress,
  saveProgress,
  normalizeProgress,
  readStorage,
  writeStorage,
  type GameConfig,
} from "@/lib/game-state";

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
const DEF = DEFAULT_CONFIG;

export default function SnakeGame() {
  const [state, setState] = useState<"menu" | "play" | "dead">("menu");
  const [name, setName] = useState("");
  const [score, setScore] = useState(0);
  const [online, setOnline] = useState(1);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "online" | "reconnecting" | "offline"
  >("connecting");
  const roundAccount = useRef<string | null>(null);
  const startRef = useRef<() => void>(() => {});
  const [cfg, setCfg] = useState<Cfg>(DEF);
  const [showCfg, setShowCfg] = useState(false);
  const [fps, setFps] = useState(0);
  useEffect(() => {
    setCfg(loadConfig());
  }, []);
  const [coins, setCoins] = useState(0);
  const [owned, setOwned] = useState<string[]>(["hue"]);
  const [skin, setSkin] = useState("hue");
  const skinRef = useRef(skin);
  skinRef.current = skin;
  // progress (coins, coin-unlocked skins, selected skin) is saved locally AND to the signed-in account
  const userRef = useRef<string | null>(null);
  const coinsRef = useRef(coins);
  coinsRef.current = coins;
  const ownedRef = useRef(owned);
  ownedRef.current = owned;
  const progressReady = useRef(false);
  const authGeneration = useRef(0);
  const saveQueue = useRef(Promise.resolve());
  const [progressLoading, setProgressLoading] = useState(true);
  const applyProgress = (value: unknown) => {
    const p = normalizeProgress(value);
    coinsRef.current = p.coins;
    ownedRef.current = p.owned;
    skinRef.current = p.skin;
    setCoins(p.coins);
    setOwned(p.owned);
    setSkin(p.skin);
    return p;
  };
  const persist = (c: number, o: string[], s: string) => {
    const p = applyProgress({ coins: c, owned: o, skin: s });
    const uid = userRef.current;
    saveProgress(p, uid);
    if (uid && progressReady.current) {
      const generation = authGeneration.current;
      saveQueue.current = saveQueue.current.catch(console.error).then(async () => {
        if (userRef.current !== uid || authGeneration.current !== generation) return;
        const { error } = await supabase
          .from("player_progress")
          .upsert({ user_id: uid, ...p, updated_at: new Date().toISOString() });
        if (error) console.error(error);
      });
    }
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const syncProgress = async (uid: string, generation: number) => {
    try {
      const { data, error } = await supabase
        .from("player_progress")
        .select("coins,owned,skin")
        .eq("user_id", uid)
        .maybeSingle();
      if (userRef.current !== uid || authGeneration.current !== generation) return;
      if (error) throw error;
      // Existing accounts are authoritative. Guest progress is imported once, into a new account only.
      let p = data ? normalizeProgress(data) : loadProgress(uid);
      if (
        !data &&
        !readStorage(`neon-progress:${uid}`) &&
        !readStorage("neon-guest-claimed") &&
        !readStorage("neon-synced")
      ) {
        p = loadProgress(null);
        writeStorage("neon-guest-claimed", uid);
        saveProgress(normalizeProgress(null), null);
      }
      progressReady.current = true;
      applyProgress(p);
      saveProgress(p, uid);
      if (!data) persistRef.current(p.coins, p.owned, p.skin);
    } catch (error) {
      if (userRef.current !== uid || authGeneration.current !== generation) return;
      console.error(error);
      setAuthMsg(
        "İrəliləyiş yüklənmədi. Yerli oyun mümkündür; hesabı sinxronlaşdırmaq üçün yenidən daxil ol.",
      );
    } finally {
      if (userRef.current === uid && authGeneration.current === generation)
        setProgressLoading(false);
    }
  };
  const pick = (id: string) => {
    const k = SKIN_BY[id];
    if (!k || progressLoading) return;
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
      writeStorage("neon-cfg", JSON.stringify(n));
      return n;
    });
  const [preview, setPreview] = useState("hue");
  const [authMsg, setAuthMsg] = useState("");
  useEffect(() => {
    setPreview(skin);
  }, [skin]);
  const [region, setRegion] = useState<keyof typeof REGIONS>("Avropa");
  const [room, setRoom] = useState("eu-1");
  const [origin, setOrigin] = useState("https://neonworm.app");
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    setOrigin(window.location.origin);
    const r = new URLSearchParams(window.location.search).get("room");
    if (!r) return;
    for (const reg of Object.keys(REGIONS) as (keyof typeof REGIONS)[])
      if (REGIONS[reg].some(([id]) => id === r)) {
        setRegion(reg);
        setRoom(r);
      }
  }, []);
  const [user, setUser] = useState<{
    id: string;
    email: string | undefined;
    name: string;
    avatar: string | undefined;
  } | null>(null);
  const [paid, setPaid] = useState<string[]>([]);
  const syncProgressRef = useRef(syncProgress);
  syncProgressRef.current = syncProgress;
  const loadPaid = async (uid: string, generation = authGeneration.current) => {
    try {
      const { data, error } = await supabase
        .from("skin_purchases")
        .select("skin_id")
        .eq("user_id", uid)
        .eq("environment", getPaddleEnvironment());
      if (error) throw error;
      if (userRef.current === uid && authGeneration.current === generation)
        setPaid((data || []).map((d) => d.skin_id));
    } catch (error) {
      console.error(error);
    }
  };
  useEffect(() => {
    const generationCounter = authGeneration;
    let active = true,
      eventReceived = false;
    const apply = (u: User | null | undefined) => {
      if (!active) return;
      if (!u) {
        authGeneration.current++;
        userRef.current = null;
        progressReady.current = false;
        setUser(null);
        setPaid([]);
        applyProgress(loadProgress(null));
        setProgressLoading(false);
        return;
      }
      const fullName: unknown = u.user_metadata["full_name"],
        avatar: unknown = u.user_metadata["avatar_url"];
      const n = ((typeof fullName === "string" ? fullName : u.email) || "Oyunçu")
        .split(" ")[0]!
        .slice(0, 14);
      setUser({
        id: u.id,
        email: u.email,
        name: n,
        avatar: typeof avatar === "string" ? avatar : undefined,
      });
      setName((o) => o || n);
      if (userRef.current !== u.id) {
        const generation = ++authGeneration.current;
        userRef.current = u.id;
        progressReady.current = false;
        setProgressLoading(true);
        setPaid([]);
        applyProgress(loadProgress(u.id));
        // Supabase auth callbacks run under the auth lock. Start further requests after it is released.
        queueMicrotask(() => {
          if (active) {
            void loadPaid(u.id, generation);
            void syncProgressRef.current(u.id, generation);
          }
        });
      }
    };
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      eventReceived = true;
      apply(s?.user);
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) console.error(error);
        if (!eventReceived) apply(data.session?.user);
      })
      .catch((error) => {
        console.error(error);
        if (!eventReceived) apply(null);
      });
    return () => {
      active = false;
      generationCounter.current++;
      userRef.current = null;
      progressReady.current = false;
      sub.subscription.unsubscribe();
    };
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

  // The canvas only renders authoritative snapshots; simulation lives in src/game.
  useEffect(() => {
    setState("menu");
  }, [room]);
  const has = (id: string) => owned.includes(id) || paid.includes(id);
  const [buying, setBuying] = useState(false);
  const checkoutBusy = useRef(false);
  const purchasePoll = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(
    () => () => {
      clearInterval(purchasePoll.current);
      window.Paddle?.Update({ eventCallback: null });
    },
    [user?.id],
  );
  const buyReal = async (id: string) => {
    if (!user) {
      setAuthMsg("Pulla almaq üçün əvvəlcə Google ilə gir.");
      setTimeout(() => setAuthMsg(""), 4000);
      return;
    }
    const offer = PAID_SKINS[id];
    if (!offer || checkoutBusy.current) return;
    checkoutBusy.current = true;
    setBuying(true);
    const generation = authGeneration.current;
    try {
      await initializePaddle();
      const pid = await getPaddlePriceId(offer.priceId);
      const paddle = window.Paddle;
      if (!paddle || userRef.current !== user.id || authGeneration.current !== generation) return;
      paddle.Update({
        eventCallback: (e) => {
          if (e.name !== "checkout.completed" || userRef.current !== user.id) return;
          clearInterval(purchasePoll.current);
          let n = 0;
          void loadPaid(user.id, generation);
          purchasePoll.current = setInterval(() => {
            void loadPaid(user.id, generation);
            if (++n >= 10) clearInterval(purchasePoll.current);
          }, 2000);
        },
      });
      paddle.Checkout.open({
        items: [{ priceId: pid, quantity: 1 }],
        ...(user.email ? { customer: { email: user.email } } : {}),
        customData: { userId: user.id },
        settings: {
          displayMode: "overlay",
          successUrl: `${window.location.origin}/?bought=${id}`,
          allowLogout: false,
          variant: "one-page",
        },
      });
    } catch (e) {
      console.error(e);
      setAuthMsg("Ödəniş açılmadı, yenidən yoxla.");
    } finally {
      checkoutBusy.current = false;
      setBuying(false);
    }
  };
  const ownedSkins = SKINS.filter((k) => has(k.id));
  const cycle = (d: number) => {
    const i = SKINS.findIndex((k) => k.id === preview);
    const n = SKINS[(i + d + SKINS.length) % SKINS.length]!;
    setPreview(n.id);
    if (has(n.id) && !progressLoading) persist(coins, owned, n.id);
  };
  const cur = SKIN_BY[preview] ?? SKINS[0]!;
  const curPaid = PAID_SKINS[cur.id];
  const curBg =
    cur.type === "bands" || cur.type === "pulse"
      ? `linear-gradient(${cur.colors.join(",")})`
      : cur.type !== "hue"
        ? `repeating-linear-gradient(90deg,${cur.colors.map((c, i) => `${c} ${i * 14}px ${(i + 1) * 14}px`).join(",")})`
        : cur.colors[0];
  const google = async () => {
    try {
      const r = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.href,
      });
      if (r.error) throw r.error;
    } catch (error) {
      console.error(error);
      setAuthMsg("Google ilə giriş alınmadı — bir az sonra yenidən yoxla.");
    }
  };
  const fs = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen?.();
    } catch {
      setAuthMsg("Bu brauzerdə tam ekran açılmadı.");
    }
  };
  void ownedSkins;

  return (
    <div className="fixed inset-0 overflow-hidden bg-background select-none">
      <GameCanvas
        room={room}
        config={cfg}
        startRef={startRef}
        profile={() => {
          roundAccount.current = userRef.current;
          return { name, skin: has(skin) ? skin : "hue" };
        }}
        onStart={() => {
          setScore(100);
          setState("play");
        }}
        onDeath={(len) => {
          setScore(Math.floor(len * 10));
          setState("dead");
          if (roundAccount.current === userRef.current)
            persistRef.current(coinsRef.current + coinsFor(len), ownedRef.current, skinRef.current);
        }}
        onScore={setScore}
        onInterrupted={() => setState("menu")}
        onCount={setOnline}
        onFps={setFps}
        onStatus={setConnectionStatus}
        onError={setAuthMsg}
      />
      {getPaddleEnvironment() === "sandbox" && state !== "play" && (
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-30 bg-accent/80 py-1 text-center text-xs text-accent-foreground">
          Önizləmədə ödənişlər test rejimindədir (real pul çəkilmir)
        </div>
      )}
      <div className="pointer-events-none absolute bottom-4 left-4 rounded-xl bg-card/80 px-3 py-2 text-xs text-foreground">
        {connectionStatus === "online" ? "🟢" : "🟡"} Onlayn oyunçu:{" "}
        <b className="text-primary">{online}</b> · 👤 insan · 🤖 bot
        <span className="ml-2 text-muted-foreground">Otaq: {room.toUpperCase()}</span>
        {connectionStatus !== "online" && (
          <span className="ml-2">
            {connectionStatus === "connecting" ? "Qoşulur..." : "Bağlantı bərpa olunur..."}
          </span>
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
          <p className="mt-2 text-xs text-muted-foreground">Versiya: {GAME_VERSION}</p>
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
              if (has(preview) && !progressLoading && connectionStatus === "online")
                startRef.current();
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
                    : curPaid
                      ? `Premium · ${curPaid.label}`
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
                disabled={progressLoading || connectionStatus !== "online"}
                className="mt-3 w-full rounded-2xl bg-accent py-4 font-display text-2xl font-bold uppercase tracking-wide text-accent-foreground shadow-glow transition hover:scale-[1.02] disabled:opacity-50"
              >
                {progressLoading
                  ? "Yüklənir..."
                  : connectionStatus !== "online"
                    ? "Qoşulur..."
                    : state === "dead"
                      ? "Yenidən oyna"
                      : "Oyna"}
              </button>
            ) : curPaid ? (
              <button
                type="button"
                onClick={() => buyReal(cur.id)}
                disabled={buying}
                className="mt-3 w-full rounded-2xl bg-primary py-4 font-display text-xl font-bold text-primary-foreground disabled:opacity-50"
              >
                {buying ? "Açılır..." : `💳 Al ${curPaid.label}`}
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
              const link = `${origin}/?room=${room}`;
              const txt = encodeURIComponent(`Mənimlə oyna! 🐍 ${link}`);
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
                } catch (error) {
                  if (!(error instanceof DOMException && error.name === "AbortError"))
                    setAuthMsg("Linki paylaşmaq alınmadı.");
                }
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
