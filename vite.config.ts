// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import httpProxy from "http-proxy";
import { defineConfig, type Plugin } from "vite";

// The sandbox config wrapper drops `server.proxy`, so the arena socket is bridged
// by a plugin instead: upgrades on /arena/<room> are handed to the arena process.
const ARENA_TARGET = process.env.ARENA_URL || "ws://127.0.0.1:8787";
const arenaRoom = /^\/arena\/(eu-[1-4]|as-[1-2]|am-[1-2])$/;

function arenaSocketBridge(): Plugin {
  const proxy = httpProxy.createProxyServer({ ws: true, target: ARENA_TARGET });
  proxy.on("error", (_error, _req, socket) => {
    if (socket && !socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  });
  return {
    name: "arena-socket-bridge",
    configureServer(server) {
      server.httpServer?.on("upgrade", (req, socket, head) => {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        if (arenaRoom.test(pathname)) proxy.ws(req, socket, head);
      });
    },
  };
}

export default defineConfig({
  vite: {
    plugins: [arenaSocketBridge()],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
