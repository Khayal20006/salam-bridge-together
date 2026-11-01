import { createFileRoute } from "@tanstack/react-router";
import SnakeGame from "@/components/SnakeGame";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "neon.io — Neon ilan oyunu" },
      { name: "description", content: "Slither.io üslubunda sürətli, gecikməsiz neon ilan oyunu." },
      { property: "og:title", content: "neon.io — Neon ilan oyunu" },
      { property: "og:description", content: "Ye, böyü, rəqibləri kəs. Gecikməsiz neon ilan oyunu." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://salam-bridge-together.lovable.app/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://salam-bridge-together.lovable.app/" }, { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" }],
  }),
  component: SnakeGame,
});
