import { createFileRoute } from "@tanstack/react-router";
import SnakeGame from "@/components/SnakeGame";
import { SiteFooter } from "@/components/SiteFooter";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "neon.io — Neon ilan oyunu" },
      { name: "description", content: "Slither.io üslubunda sürətli, gecikməsiz neon ilan oyunu." },
      { property: "og:title", content: "neon.io — Neon ilan oyunu" },
      { property: "og:description", content: "Ye, böyü, rəqibləri kəs. Gecikməsiz neon ilan oyunu." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://neonworm.app/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://neonworm.app/" }, { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" }],
  }),
  component: Home,
});

function Home() {
  return (
    <>
      <SnakeGame />
      <p className="sr-only">neon.io by Slither is a free multiplayer snake game. Optional premium skins: RGB Animasiya $2.99, Plazma $4.99, Əfsanə $9.99.</p>
      <SiteFooter overlay />
    </>
  );
}
