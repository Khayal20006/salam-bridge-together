# Fly.io shared arena

This Dockerfile runs `server/arena.mjs`, the shared WebSocket game server.
The React frontend continues to be published through Lovable.

## First deployment

From `C:\salam-bridge-together-main`, choose a unique app name:

```powershell
fly auth login
fly launch --no-deploy --name YOUR-UNIQUE-APP --region fra --ha=false
fly deploy --ha=false
fly scale count 1
fly status
```

Keep the supplied Dockerfile and `fly.toml` settings when launching. If the Fly
app already exists, set `app` in `fly.toml` to that name and start with
`fly deploy --ha=false`. Remote builds work without a local Docker daemon.

**Use exactly one Machine.** Rooms live in this process's memory. Independent
Machines do not share bots or food, so do not enable HA replicas or add regions
until room routing/shared state is implemented. `--ha=false` prevents Fly's
default spare Machine on a first deployment; `fly scale count 1` corrects the
count for an existing app. Autostop is disabled to avoid suspending active worlds.
The running Machine is billable even when nobody is playing. Deployment/restart
resets active rounds; clients reconnect to the new world.

Verify `https://YOUR-UNIQUE-APP.fly.dev/health` returns `ok: true`.
The socket endpoint is `wss://YOUR-UNIQUE-APP.fly.dev/arena/eu-1` (and other rooms).
The container listens on `0.0.0.0:8080`; Fly handles external TLS/HTTPS/WSS.

## Connect the frontend

In the frontend build environment, set:

```dotenv
VITE_ARENA_URL=wss://YOUR-UNIQUE-APP.fly.dev/arena/{room}
```

Rebuild/publish in Lovable after changing this value. Setting `VITE_ARENA_URL`
only on Fly does **not** change the browser bundle. Without this frontend change,
the browser still tries the old Render endpoint.

## Paid skins and allowed browser origins

For server-side verification of paid skins, configure runtime values using
`fly secrets set` or Fly's dashboard:

- `SUPABASE_URL`: the project's Supabase URL.
- `SUPABASE_PUBLISHABLE_KEY`: the public/publishable key, not the service-role key.
- `PADDLE_ENVIRONMENT`: `live` for production or `sandbox` for test purchases.
- `ARENA_ALLOWED_ORIGINS` (optional): comma-separated additional frontend origins.

`neonworm.app`, its subdomains, Lovable app previews, localhost and 127.0.0.1 are
already allowed. Local `.env` files are excluded from the image build context.

## Local container smoke check

With Docker Desktop running:

```powershell
docker build -t neonworm-arena .
docker run --rm -p 8787:8080 --name neonworm-arena-test neonworm-arena
# In another terminal:
Invoke-RestMethod http://127.0.0.1:8787/health
docker stop neonworm-arena-test
```

References: [Fly app configuration](https://fly.io/docs/reference/configuration/)
and [Machine counts](https://fly.io/docs/launch/scale-count/).
