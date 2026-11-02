# Multiplayer architecture

## Authority and collision rules

`src/game/engine.ts` owns snake movement, food, growth, bots, spawning and death.
Clients send an increasing input sequence, target angle and boost flag. They never
send an authoritative position, length, death or food claim.

The simulation advances at 30 fixed steps per second (33.333 ms). Collision checks
cover the head's swept movement against body segments, and relative swept motion
for head-on collisions. Head-on contact kills both snakes in the same tick. All
deaths are collected before they are applied, so iteration order and packet arrival
order cannot decide the winner. A spatial grid limits body and food queries.

New snakes must have clearance along their entire body. If a safe location cannot
be found, spawning is rejected rather than placing a snake inside another one.
Body detail is capped at 240 points and thickness at 41 world units.

## Transports

`server/arena.mjs` is the production authority for the WebSocket transport. One
process owns each room. The server binds identity to the WebSocket connection,
validates commands, limits traffic and checks purchased skins using the player's
Supabase token. It removes disconnected snakes and stops simulating empty rooms.

Set `VITE_ARENA_URL=wss://YOUR-ARENA-HOST/arena` when building the frontend.
`npm run dev` starts both Vite and the arena server; Vite proxies `/arena` locally.

Existing deployments without `VITE_ARENA_URL` use a compatibility Supabase Realtime
transport. There is still a single elected simulator and shared world: other
clients send inputs, not snake positions. Host migration copies the latest world.
This fallback trusts the host browser and pauses if its connection is lost; it is
not equivalent to a trusted dedicated server. Competitive production should use
the WebSocket server. Pushing the frontend alone does not provision that service.

Do not start multiple independent arena processes behind random load balancing.
All clients in a room must reach the same process. Use a single instance first;
scale by routing room IDs to their owners. For multi-region service, deploy room
owners near players and route each advertised room to its actual region. The
existing region labels alone do not deploy regional infrastructure.

## Replication and rendering

The server publishes 10 snapshots/second. Coordinates are quantized to whole world
units; every body point is retained for visible snakes. Distant snakes send their
head and metadata for the minimap and leaderboard. Food changes are deltas, with a
full recovery keyframe each second. Missing baselines trigger a resync.

The renderer interpolates authoritative frames with a 100 ms jitter buffer and
never runs collision or food simulation. Canvas resolution is capped by the
graphics setting. Head rotation follows the shortest arc between snapshots;
body outlines and skin sections share continuous quadratic curves. The authority
eases angular velocity and limits curvature by body thickness to avoid abrupt folds.
Glow sprites and name labels are cached, labels have a bounded
cache, and low quality reduces decorative work. Input is coalesced to 30 messages
per second; losing focus releases boost. Slow sockets are disconnected rather
than building unbounded outbound queues.

These choices trade a small, explicit interpolation delay for stable movement.
They cannot eliminate Internet RTT, packet loss or a distant server. The actual
network, room CPU time, frame time and bandwidth must be measured after deployment.

## Running the arena service

Use Node.js 24 or newer. The server uses Node's native TypeScript stripping for
the shared engine; its source intentionally avoids parameter properties and enums.

```sh
npm install
npm run arena
```

Configuration:

| Variable                   | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `ARENA_HOST`               | `127.0.0.1` locally; use `0.0.0.0` on a hosted service     |
| `ARENA_PORT` or `PORT`     | Listening port, default `8787`                             |
| `ARENA_ALLOWED_ORIGINS`    | Comma-separated exact frontend origins                     |
| `SUPABASE_URL`             | Backend URL for paid-skin verification                     |
| `SUPABASE_PUBLISHABLE_KEY` | Public backend key; service-role access is not needed      |
| `PADDLE_ENVIRONMENT`       | `live` or `sandbox`, must match the frontend payment token |

Terminate HTTPS/WSS at the host or reverse proxy, allow WebSocket upgrades, and
forward `/arena/*` to this process. `GET /health` reports liveness and room/client
counts. Server restarts start a new round; long-term progress stays in Supabase.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run test:arena
npm run benchmark:arena
npm run build
```

`test:arena` launches an ephemeral real server and checks multiple WebSocket
clients, shared bot positions and food, room isolation, invalid commands and
disconnect cleanup. `benchmark:arena` measures a local simulation with up to 50
human snakes and 18 bots. It is not an Internet, distributed-server or 50-browser
performance guarantee.

The optional Windows `node scripts/test-browser.mjs` smoke test requires Edge and
`npm run dev` already running. It captures the menu and gameplay and checks for
JavaScript exceptions. Set `EDGE_PATH` or `APP_URL` to change those defaults.
