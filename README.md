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

Use Node.js 24 or newer. `npm run dev` starts the frontend and the authoritative
multiplayer server together. The existing Supabase environment variables are
still required for login, account progress and purchases.

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

The multiplayer world now has one authority for food, bot movement, safe spawning
and collisions. See [multiplayer architecture and deployment](docs/MULTIPLAYER.md)
for the server setup, compatibility transport and network tradeoffs.

For a production dedicated server, run `npm run arena` as a separate Node service
and build the frontend with `VITE_ARENA_URL=wss://YOUR-ARENA-HOST/arena`. A frontend
build does not deploy or start that service automatically.

```sh
npm run typecheck
npm run lint
npm test
npm run test:arena
npm run benchmark:arena
npm run build
```
