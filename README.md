# Salam Bridge Together

salam

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://salam-bridge-together.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/92656ffd-5fa6-47aa-8ee5-4f6046baf72c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Shared arena and Canvas renderer

Use Node.js 24 or newer. Run `npm run arena` for the authoritative WebSocket server and `npm run dev` for the frontend. For local multiplayer set `VITE_ARENA_URL=ws://127.0.0.1:8787/arena/{room}` in `.env.local` before starting Vite. The default endpoint is `wss://salam-bridge-together.onrender.com/arena/{room}`. A base `/arena` URL and a concrete room URL are also accepted.

Render: install dependencies, run `npm run arena`, and set Node 24+. The server reads Render's `PORT` and binds to `0.0.0.0`. Supabase public configuration is needed on the server to verify paid skin ownership; never put a service-role credential in a VITE variable. Deploy the frontend separately through Lovable Publish.

`SnakeGame.tsx` preserves the account/shop/menu and mounts `src/game/canvas-runtime.ts`. Copy the accompanying `src/game` modules and `server/arena.mjs` when moving the implementation to another project. The server runs shared bots, food, collision and spawn protection. Snapshots publish at 20 Hz; view filtering reduces food/body data while distant heads remain for the minimap and leaderboard. Packet size depends on nearby population and snake lengths; it is not a fixed 2 KB.

The rendering loop reuses 70 snake slots with 240 points each. It does not create arrays/objects, serialize messages, create color strings or update React. Input serialization runs at 20 Hz, text/HUD refresh at 4 Hz, and snapshots are decoded on arrival. Browser internals, React, networking, and the authoritative simulation still allocate memory; this is not a claim that the whole application can never trigger GC. Rendering uses every animation frame, including 120/144 Hz displays.

If the arena fails or stops sending valid snapshots for six seconds, the current session switches to a clearly labelled **local offline game** in an embedded Web Worker. That world is separate from online rooms. It does not silently switch back during a run; select a room or reload to retry online. The embedded worker remains available after network loss, without downloading another script. Local prediction immediately responds to input, bounds reconciliation speed, and adapts its speculation limit to packet cadence (250–750 ms) and stops during a sustained outage. Death and food ownership always come from the active authority.

Validation: `npm test`, `npm run test:arena`, `npx tsc --noEmit`, `npm run build`.

A reproducible optional browser check is in `scripts/test-browser.mjs`. It launches headless Edge, opens two independent windows, compares shared snapshots, measures frame intervals, then disables network and closes one socket to verify the embedded offline worker. Set `TEST_APP_URL` to a running production preview (default `http://127.0.0.1:8101`) and `TEST_ARENA_URL` to a running local test arena (default `ws://127.0.0.1:8798`). The harness intercepts the hosted arena URL only inside its test browser. Run `node scripts/test-browser.mjs`; override `EDGE_PATH` if needed. Reports are written to the OS temporary directory. These measurements do not guarantee identical FPS on other devices or over the public internet.

Collision checks compare moving heads and moving body segments at the same tick time. Earlier impacts are resolved before later impacts; a snake already killed cannot subsequently kill its cutter. Each snake has a small forward nose contact sensor; the head sides and neck are part of the opponent's body. Overlapping head circles alone never kill both. First nose contact determines the victim, independent of size, bot/player status, or insertion order. Exactly simultaneous symmetric nose contacts have no unique winner and kill both. `/health` exposes the deployed commit, simulation rate, and publication target so a stale Render deployment can be identified.
