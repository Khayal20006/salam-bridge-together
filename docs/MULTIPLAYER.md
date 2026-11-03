# Multiplayer architecture

## Authority and collision rules

`src/game/engine.ts` owns snake movement, food, growth, bots, spawning and death.
Clients send an increasing input sequence, target angle and boost flag. They never
send an authoritative position, length, death or food claim.

The simulation advances at 30 fixed steps per second (33.333 ms). Collision checks
cover the head's swept movement against body segments, and relative swept motion
for head-on collisions. Head-on contact kills the smaller snake; equal-length
snakes use a stable ID tie-break so input arrival order cannot choose the winner.
The winner is not killed again by the defeated snake's neck in that tick. All
deaths are collected before they are applied, so iteration order and packet arrival
order cannot decide the winner. A spatial grid limits body and food queries.

New snakes must have clearance along their entire body. If a safe location cannot
be found, spawning is rejected rather than placing a snake inside another one.
Body detail is capped at 240 points. Normal food now adds 0.75 length, following
the updated request for more visible growth. Body radius increases gently from
11 to at most 18 world units as length grows; collision and bot navigation use
that same radius.
Every newborn has 45 simulation steps (1500 ms) of protection against other
snakes. Its body cannot kill another player during protection. The world boundary
still kills, and repeated join messages cannot extend protection. All peers derive
the shield from the replicated spawn tick; a pale ring marks it on the head.
After protection expires, head/body collision radii are 80% of their visible size,
including gradual growth. This forgives light edge grazes while deeper overlap
still kills. The world boundary uses the full visible radius.

## Transports

`server/arena.mjs` is the production authority for the WebSocket transport. One
process owns each room. The server binds identity to the WebSocket connection,
validates commands, limits traffic and checks purchased skins using the player's
Supabase token. It removes disconnected snakes and stops simulating empty rooms.

Set `VITE_ARENA_URL=wss://YOUR-ARENA-HOST/arena` when building the frontend.
`npm run dev` starts both Vite and the arena server; Vite proxies `/arena` locally.

Existing deployments without `VITE_ARENA_URL` use a compatibility Supabase Realtime
transport. There is still a single elected simulator and shared world: other
clients send inputs, not snake positions. The simulator runs in a module Web Worker,
away from canvas rendering. A visible peer takes priority over a hidden peer after
presence settles. Host migration copies the latest world and preserves its ID;
the former host stops its worker before another one starts. Reconnecting clients
stop simulating and request a full frame. Missing packet baselines trigger a
keyframe request, and a watchdog catches a silent stream. Outbound snapshots are
bounded to one send and the latest pending frame. Unchanged steering uses a 5 Hz
heartbeat; changing steering is capped at 20 Hz, and boost changes send immediately.
The host renders the same quantized snapshots as its peers. No spectator creates
an independent set of local bots.

This fallback trusts the host browser and pauses briefly during migration; it is
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
Equal-tick keyframes are accepted because a join or leave can happen between two
simulation steps. Each snake carries its spawn tick so a respawn is never
interpolated as a body moving across the entire map from its previous life.
Nearby food is attracted toward one nearest mouth by the authority. Movement is
included in food deltas and rendered with the same interpolation timeline as snakes.

The renderer interpolates authoritative frames with a 100 ms jitter buffer and
never runs collision or food simulation. Canvas resolution is capped by the
graphics setting. Head rotation follows the shortest arc between snapshots;
body outlines and skin sections share continuous quadratic curves. The authority
eases angular velocity and limits curvature by body thickness to avoid abrupt folds.
Body segments sample the head's travelled path at fixed distances, so a turn
propagates through the entire body and tail. Growth uses newly travelled space.
Glow sprites and name labels are cached, labels have a bounded
cache, and low quality reduces decorative work. Input is coalesced to 30 messages
per second; losing focus releases boost. Slow sockets are disconnected rather
than building unbounded outbound queues.

These choices trade a small, explicit interpolation delay for stable movement.
They cannot eliminate Internet RTT, packet loss or a distant server. The actual
network, room CPU time, frame time and bandwidth must be measured after deployment.

## Bot movement

Bots commit to a nearby food goal ahead of their head instead of switching to food
behind the neck on each update. Every six simulation steps a spatial grid supplies
nearby body segments. The bot scores short curved paths against those segments and
the boundary, so a body behind it cannot repeatedly reverse its direction. A bot
that makes little progress over three seconds temporarily chooses a distant goal.
Bot decisions run only in the authority and use the shared collision engine.

## Publishing the frontend

A GitHub push synchronizes source into the Lovable editor. It does not prove that
the custom domain has been republished. On 2026-11-03 the HTML served by
`https://neonworm.app/` still identified source commit
`b9ad74b40c010489b08af0dfa191d7a7fe4d7742`, while GitHub main contained newer code.
Publish the updated project in Lovable and verify the served commit marker after
publication. The graphics panel shows game version `2026.11.03.5`; the HUD shows
the exact room ID to help two players verify their room and version. Reload old
tabs after publishing a protocol update. Source push and live publication are
separate verification steps.

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

`npm run test:realtime` also requires the Vite dev server and working public
Supabase variables. It uses isolated, random test topics on the actual relay and
two real Edge pages. It compares complete world snapshots, joins both players,
backgrounds the host, drops a delta baseline, closes the host and checks continuity
and browser exceptions. It never joins public game topics.

## Allocation control

Snapshots copy mutable snake metadata and retain body paths: movement replaces a
path rather than editing one retained by an older frame. Unchanged food snapshot
objects are reused; moved food gets a new object so old interpolation frames stay
intact. Treat snapshots and their contents as read-only. Restore still copies
incoming state before the authority starts mutating it.

Weakly cached indexes are shared by the renderer, packet decoder and all recipients
of a snapshot. They expire with that snapshot. The renderer no longer builds new
snake maps and ID sets every animation frame. Packet encoding fills a flat number
array directly instead of allocating a temporary pair for every body point.
The browser host also decodes food deltas rather than a full food keyframe on every
local publication. Authority, tick rate and wire protocol are unchanged.

`npm run benchmark:replication` measures 100 publications to 50 recipients, including
allocation sampling and garbage collection. On the same seeded local workload,
sampled allocation fell from 1962.14 MB to 1088.05 MB, publication p95 from 33.49 ms
to 19.89 ms, and maximum observed GC from 8.94 ms to 2.54 ms. Encoded traffic was
identical at 71,847,389 bytes. These are individual local measurements with profiler
overhead, not proof of the cause of every browser freeze or a production FPS guarantee.

## Local steering response

The original version moved the local player immediately on every animation frame.
Pure snapshot interpolation later added network delay and the 100 ms render buffer
to the local player's controls. In a two-peer relay measurement, an input took about
253 ms to appear in the authority, while a separate 10-second single-player browser
sample remained at 60 FPS. This identifies a control-latency problem in that sample,
not proof that every reported freeze has the same cause.

Only the local player's visual motion is now predicted with the shared movement
function. The optional protocol-v2 `motion` field carries input acknowledgements,
target direction and angular velocity. Other players and bots still interpolate
the authoritative world. Predicted motion never claims food, changes score or kills
anyone. Returning authority frames reconcile over 60 ms; prediction stops after
250 ms without authority and clears on death, reconnect identity or a new life.
Older authorities without the optional acknowledgement keep the existing renderer.

This improves local response without extra input traffic. It cannot remove relay
RTT, host-tab suspension, or provide a persistent trusted server. With only Lovable
hosting, the compatibility host is still a browser. Deploy `server/arena.mjs` and
set `VITE_ARENA_URL` for an independently hosted authoritative service.

## Dense bodies and page lifecycle

Drawing resamples each body interval into four Catmull-Rom intervals (two on low
quality), using pooled points. A fresh ten-point body therefore draws 37 spine
points. Authoritative spacing, collision points and packet sizes are unchanged.
Color-band spacing is scaled with render density, and wholly offscreen bodies
are culled before resampling.

Prediction advances to packet arrival before rebasing, preserving time between
the previous paint and the packet. Regression tests reproduce the former zero-
movement frame and the tail kick on a turning head. Corrections are bounded in
speed and tracked per body point, rather than translating the entire tail by
the head error.

Brief visibility changes keep the existing authority alive; sustained changes
use a full checkpoint handoff before the new worker starts. Older peers retain
the compatible election path. Pagehide explicitly leaves the realtime channel.
Returning to a tab requests a full state, rebases frame history and camera, and
releases stale boost. A back/forward-cache restore reloads the closed connection.
The real relay browser test now covers brief switching, sustained backgrounding,
refreshing the host, rejoining the advancing world, and absence of the old peer.

Growth balance for 2026.11.03.5: food still adds 0.75 progress, but the body-point
growth slope is 1.1 rather than 1.4 (about 21% less extension). Width now grows
more noticeably using a logarithmic curve with a 40-point scale and coefficient
3, still capped at radius 18. The collision tolerance is applied to that same
current width. This follows the latest request to put more growth into thickness.

A five-second local browser sample after the packet-time fix recorded 300 frames,
zero stationary movement frames, and a 16.7 ms p95 frame interval. This is a local
measurement, not a guarantee about Internet packet delivery or all devices.

Version 2026.11.03.6 removes the hard radius-18 stop from the same logarithmic
width curve. Early growth is identical to .5; thickness continues gradually at
larger scores. A regression checks continued growth beyond the old limit and a
small width change for a normal meal. Physical body detail remains capped at
240 points to bound simulation and packet cost.

The rendered first interval now uses a Hermite tangent aligned with the head's
heading, joining the existing Catmull-Rom body at the same end tangent. Eyes
follow that rendered neck direction. The pointer dead zone scales with the
visible head radius. Neither change changes bot authority or packet size.
70 unit tests, typecheck, lint, production build, the real WebSocket integration
test and a native browser smoke test passed. The 600-tick local benchmark with
49.1 average humans and 18 bots measured p95 3.58 ms and maximum 6.39 ms against
the 33.33 ms simulation budget; this is not a production network load test.

Version 2026.11.03.7 plays remote bodies against simulation ticks, with a 100–200 ms
adaptive jitter buffer and playback-rate corrections limited to 10%. Packet
arrival jitter no longer directly changes interpolation speed. This does not
change local prediction, authority, food ownership, collision decisions or bot
simulation. Playback stops at the newest authority during an actual outage.

Skins share a continuous base surface and use fractional quadratic-curve ranges
for smooth color flow instead of a 90 ms stepping pattern. Interior bands meet
without overlapping round caps. Shared highlight strokes provide volume without
per-segment gradients. Long bodies and crowded views reduce drawing subdivision
and highlights; the first neck interval retains its curve at every detail level.

The optional `SURFACE_DIAGNOSTICS=1 node scripts/test-browser.mjs` diagnostic saves
a nine-skin preview outside Git and records 300 browser frames. A local headless
Edge sample (GPU disabled) measured p95/max 16.7/16.8 ms and zero long tasks.
A separate synthetic drawing-only scene with 18 overlapping maximum-detail
240-point bodies measured p95 88.8 ms before adaptive detail; later samples with
adaptive detail measured 30.9 ms and 22.4 ms (the final neck-preserving body has
247 visual points). These are separate local samples, with normal run-to-run
variation. This deliberately expensive software
rendering sample is not a guarantee of 60 FPS for that scene or production play.
77 unit tests, typecheck, lint, the production build and the real browser check passed.

## Shared encoding and bounded remains: 2026.11.03.8

Rounded body tuples, far-view head tuples, death records and motion metadata are
prepared once per immutable snapshot. Food deltas are shared only for the exact
previous snapshot object; equal tick numbers alone cannot identify a baseline.
View filtering and motion acknowledgements remain specific to each peer. A
bounding box rejects distant bodies before checking points. Caches use weak keys
and follow the lifetime of the existing bounded snapshot history. Callers must
treat packed data as immutable.

Local prediction reuses its owned body points and resets its travelled-path
buffer on authority reconciliation. The authority still produces immutable
bodies, so retained network/render snapshots cannot be overwritten by pooling.
Tests cover scratch-buffer route equivalence, retained authority state, growth,
different peer views, distinct delta baselines with the same tick, and nearby tails.

The final comparison used the same current simulation and the original versus
cached encoder for 100 publications to 50 recipients, including allocation
sampling and packet hashing:

| Measurement | Original encoder | Cached encoder |
| --- | ---: | ---: |
| Sampled cumulative allocation | 1188.89 MB | 656.61 MB |
| Publication p50 | 19.95 ms | 13.21 ms |
| Publication p95 | 26.95 ms | 17.74 ms |
| Observed GC count | 107 | 60 |
| Observed maximum GC | 5.61 ms | 4.29 ms |
| Encoded bytes | 71,341,968 | 71,341,968 |

Both packet streams had SHA-256
`36d5d87248b57f8874e4035867e5412f0f5237650383ea5cdacff3536e763ada`.
This is about 45% less sampled allocation and 34% lower p95 preparation time in
one local workload. Allocation is cumulative work, not the browser's resident
RAM usage; this is not a production network or 50-browser load test. Reproduce
the encoder comparison with `BENCHMARK_PROTOCOL` pointing to a preserved original
protocol module; the default benchmark uses the current encoder.

Death pellets now visibly scale with the dead snake's width, from radius 3 up
to 16. Their nutritional value is independent of their visible radius: recovered
growth targets 55% of progress above the initial length, with a normal-food
minimum and a maximum of 20 progress per pellet. Existing food-count and
body-point limits still bound scene/server cost. Both clients receive the same
pellet radius and value from authority. Normal food and live width growth use
the existing formulas. This requested balance change is separate from the
encoder equivalence comparison above, which uses that same balance on both sides.

83 unit tests, TypeScript, ESLint, the production build, real WebSocket clients
and a native browser smoke check passed. The two-browser Supabase suite also
passed shared bots, host handoff, resync, refresh and disconnect recovery checks.
The last live bundle check still reported 2026.11.03.3: pushing GitHub does not
publish a new Lovable snapshot or deploy the standalone arena service.

## Boost camera and simulation scratch storage: 2026.11.03.9

Normal movement remains 156 units/second. Boost is now 320 rather than 420
(23.8% slower). Both mouse buttons and Space send the same boost intent;
the active canvas suppresses the right-button context menu, and release/blur
still clear boost. A real CDP browser test checks sent boost/release commands
and context-menu cancellation.

The camera now follows position and zoom with critically damped axes. Camera
velocity carries between frames rather than reacting directly to each position
step; spawn/world/resume resets clear that velocity. A 300-frame synthetic
320-unit/second replay with alternating 3-unit network corrections reduced the
maximum frame-to-frame camera velocity change from 56.61 to 23.53 units/second
(58.4%). This is a controlled regression measurement, not proof that all reported
production shaking has the same cause. Tests also cover 60/120 Hz following and
respawn without residual drift.

Profiling the prior seeded simulation attributed about 22% of samples to spatial
insert/query and 6% to garbage collection. Food, navigation and collision grids
now retain their buckets, use numeric row/column keys, and fill caller-owned
query sets. Collision/navigation records and relative head vectors are reused;
unchanged tick-local radii are calculated once. The authority retains immutable
body paths. Neither draw detail nor collision rules changed in this optimization.

`npm run benchmark:simulation` measures simulation allocation separately from
rendering and replication. With boost set to 320 in both the original and new
engine, a local 600-tick allocation-profiled sample recorded:

| Measurement | Original storage | Reused storage |
| --- | ---: | ---: |
| Average human players / bots | 49.2 / 18 | 49.2 / 18 |
| Sampled cumulative allocation | 968.66 MB | 574.81 MB |
| Observed GC count | 115 | 67 |
| Maximum observed GC | 3.47 ms | 2.86 ms |
| Simulation tick p95 | 5.11 ms | 5.47 ms |

Allocation fell about 41%; this sample does not demonstrate a lower p95 CPU time.
The final simulation SHA-256 was identical on both engines:
`0cbf8936a906c6a508c8a77e3c4c025b5748d60240544ccd833fbf17fcbc42fd`.
A separate 400-tick comparison also matched every full state and encoded view
stream, using the same boost setting. `BENCHMARK_ENGINE` can select a preserved
reference module. Pooled capacity is retained for reuse; allocation totals are
not resident RAM and these local samples are not Internet latency guarantees.

90 unit tests, TypeScript, ESLint, production build, real WebSocket integration,
right-button browser controls, and the two-browser Supabase lifecycle suite passed.

Version 2026.11.03.10 makes ongoing thickening more visible: the same logarithmic
curve now uses a progress scale of 24 and coefficient 3.6, instead of 40 and 3.
Initial radius stays 11; 15 normal meals bring it to about 13, score 500 to 16.09,
and score 1000 to 19.09. A single normal meal increases radius by less than 0.2
at spawn, and thickness keeps increasing at larger lengths. The shared width
function drives drawing, collision radii, safe spawn clearance and prediction;
growth is not a client-only cosmetic effect. Body point counts and normal food
values are unchanged. The edge-graze regression uses current visible radii rather
than a distance that only matched the old, thinner body.
Collision core scale is now 0.72 rather than 0.8, increasing edge forgiveness as
visible thickness grows. Parameterized cases check clear separation, shallow
grazes and deep crossings for short and large snakes; swept collision checks
still run every tick. This does not rewind remote bodies or eliminate the
100–200 ms interpolation buffer, so visual contact under network delay remains
a separate limitation rather than a proven zero-latency guarantee.
93 unit tests, TypeScript, ESLint, production build, native browser controls,
real WebSocket clients and the two-browser Supabase lifecycle suite passed.
