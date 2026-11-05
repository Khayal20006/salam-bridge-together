# syntax=docker/dockerfile:1
# Node 24 executes the arena's TypeScript modules directly.
FROM node:24-bookworm-slim

WORKDIR /app

# Install only the WebSocket server's dependencies, with a reproducible lockfile.
COPY deploy/arena/package.json deploy/arena/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

COPY server/arena.mjs ./server/arena.mjs
COPY src/game/engine.ts src/game/collision.ts src/game/classic-body.ts \
     src/game/bot-navigation.ts src/game/spatial-grid.ts src/game/movement.ts \
     src/game/protocol.ts src/game/snapshot-index.ts src/game/view-snapshot.ts ./src/game/
COPY src/lib/skins.ts ./src/lib/skins.ts

ENV NODE_ENV=production \
    PORT=8080 \
    ARENA_HOST=0.0.0.0

USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.ARENA_PORT||process.env.PORT||8080)+'/health',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/arena.mjs"]
