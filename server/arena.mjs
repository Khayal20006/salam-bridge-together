import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { createClient } from "@supabase/supabase-js";
import { Arena, STEP_MS } from "../src/game/engine.ts";
import { packSnapshot } from "../src/game/protocol.ts";
import { snapshotForView } from "../src/game/view-snapshot.ts";
import { SKIN_BY } from "../src/lib/skins.ts";

try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const port = Number(process.env.ARENA_PORT || process.env.PORT || 8787);
const host = process.env.ARENA_HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
// Browser origins allowed to open arena sockets: local dev hosts plus the
// project's own hosted domains (Lovable preview/published and the custom domain).
const extraOrigins = new Set(
  (process.env.ARENA_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const allowedHosts = ["localhost", "127.0.0.1", "lovable.app", "neonworm.app"];

function allowedOrigin(origin) {
  if (!origin) return true;
  if (extraOrigins.has(origin)) return true;
  let host;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.some((base) => host === base || host.endsWith(`.${base}`));
}

const rooms = new Map();
const paid = new Set(["rgb", "plasma", "legend"]);

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        rooms: rooms.size,
        players: [...rooms.values()].reduce((n, r) => n + r.peers.size, 0),
      }),
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 4096,
  perMessageDeflate: {
    threshold: 2048,
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    zlibDeflateOptions: { level: 1 },
    concurrencyLimit: 4,
  },
});

function send(peer, msg) {
  if (peer.ws.readyState !== WebSocket.OPEN) return;
  // Slow consumers are reconnected instead of retaining an unbounded send queue.
  if (peer.ws.bufferedAmount > 256_000) {
    peer.ws.close(1013, "Connection too slow");
    return;
  }
  peer.ws.send(JSON.stringify(msg));
}
function state(room, peer, snapshot = room.arena.snapshot(), full = false) {
  // Keep a per-peer food baseline so crossing the view boundary sends additions
  // and removals without changing the authoritative world.
  snapshot = snapshotForView(snapshot, peer.id, peer.radius);
  send(peer, {
    type: "state",
    count: room.peers.size,
    state: packSnapshot(snapshot, full ? undefined : peer.last, {
      id: peer.id,
      radius: peer.radius,
    }),
  });
  peer.last = snapshot;
}
async function canUseSkin(skin, token) {
  if (!paid.has(skin)) return true;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || typeof token !== "string" || token.length > 8192) return false;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: user, error } = await client.auth.getUser(token);
  if (error || !user.user) return false;
  const { data, error: purchaseError } = await client
    .from("skin_purchases")
    .select("skin_id")
    .eq("user_id", user.user.id)
    .eq("skin_id", skin)
    .eq(
      "environment",
      process.env.PADDLE_ENVIRONMENT ||
        (process.env.VITE_PAYMENTS_CLIENT_TOKEN?.startsWith("test_") ? "sandbox" : "live"),
    )
    .limit(1);
  return !purchaseError && !!data?.length;
}

server.on("upgrade", (req, socket, head) => {
  const match = /^\/arena\/(eu-[1-4]|as-[1-2]|am-[1-2])$/.exec(
    new URL(req.url || "/", "http://arena.local").pathname,
  );
  if (!match || !allowedOrigin(req.headers.origin)) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }
  const key = match[1];
  let room = rooms.get(key);
  if (!room) {
    room = { arena: new Arena(), peers: new Map() };
    rooms.set(key, room);
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (room.peers.size >= 50) {
      ws.send(
        JSON.stringify({ type: "rejected", reason: "Otaq doludur (50 oyunçu). Başqa otaq seç." }),
      );
      ws.close(1008, "Room full");
      return;
    }
    const peer = {
      ws,
      id: randomUUID(),
      last: undefined,
      radius: 1600,
      alive: true,
      window: performance.now(),
      messages: 0,
      lastInput: performance.now(),
      lastJoin: -Infinity,
      joining: false,
      lastSync: -Infinity,
    };
    room.peers.set(peer.id, peer);
    send(peer, { type: "hello", id: peer.id });
    state(room, peer, undefined, true);
    ws.on("pong", () => {
      peer.alive = true;
    });
    ws.on("error", () => ws.close());
    ws.on("message", async (raw, binary) => {
      const now = performance.now();
      if (binary || raw.byteLength > 4096) return;
      if (now - peer.window >= 1000) {
        peer.window = now;
        peer.messages = 0;
      }
      if (++peer.messages > 50) return;
      try {
        const m = JSON.parse(raw.toString());
        if (!m || typeof m !== "object") return;
        if (m.type === "input") {
          room.arena.input(peer.id, m);
          peer.lastInput = now;
          if (Number.isFinite(m.radius)) peer.radius = Math.max(800, Math.min(2200, m.radius));
        } else if (m.type === "join") {
          if (peer.joining || now - peer.lastJoin < 750 || room.arena.snakes.has(peer.id)) return;
          peer.lastJoin = now;
          if (
            typeof m.name !== "string" ||
            typeof m.skin !== "string" ||
            !Object.hasOwn(SKIN_BY, m.skin)
          )
            return;
          peer.joining = true;
          try {
            if (!(await canUseSkin(m.skin, m.token))) {
              send(peer, { type: "rejected", reason: "Bu premium skin hesabında tapılmadı." });
              return;
            }
            if (ws.readyState !== WebSocket.OPEN || !room.peers.has(peer.id)) return;
            if (!room.arena.join(peer.id, m.name, m.skin))
              send(peer, {
                type: "rejected",
                reason: "Təhlükəsiz başlanğıc yeri tapılmadı. Yenidən yoxla.",
              });
            else {
              peer.lastInput = now;
              state(room, peer, undefined, true);
            }
          } finally {
            peer.joining = false;
          }
        } else if (m.type === "sync" && now - peer.lastSync > 500) {
          peer.lastSync = now;
          state(room, peer, undefined, true);
        }
      } catch {
        /* Invalid commands cannot alter the simulation. */
      }
    });
    ws.on("close", () => {
      room.peers.delete(peer.id);
      room.arena.leave(peer.id);
      if (!room.peers.size) rooms.delete(key);
    });
  });
});

let last = performance.now(),
  accumulator = 0;
const tick = setInterval(() => {
  const now = performance.now();
  accumulator += Math.min(170, now - last);
  last = now;
  let steps = 0;
  while (accumulator >= STEP_MS && steps++ < 5) {
    for (const room of rooms.values()) {
      for (const peer of room.peers.values()) {
        const s = room.arena.snakes.get(peer.id);
        if (s && now - peer.lastInput > 500) s.boost = false;
      }
      room.arena.step();
    }
    accumulator -= STEP_MS;
  }
}, 10);
// Network publication is independent of the fixed simulation clock (20 Hz).
let nextPublication = performance.now() + 50;
const publication = setInterval(() => {
  const now = performance.now();
  if (now < nextPublication) return;
  nextPublication += 50;
  if (nextPublication < now - 100) nextPublication = now + 50;
  for (const room of rooms.values()) {
    const snapshot = room.arena.snapshot();
    for (const peer of room.peers.values()) state(room, peer, snapshot);
  }
}, 10);
const heartbeat = setInterval(() => {
  for (const room of rooms.values())
    for (const peer of room.peers.values()) {
      if (!peer.alive) {
        peer.ws.terminate();
        continue;
      }
      peer.alive = false;
      peer.ws.ping();
    }
}, 15_000);

server.listen(port, host, () =>
  console.log(`Authoritative arena listening on http://${host}:${server.address().port}`),
);
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(tick);
  clearInterval(publication);
  clearInterval(heartbeat);
  for (const client of wss.clients) client.close(1001, "Server restarting");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
