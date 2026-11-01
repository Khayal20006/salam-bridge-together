import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/SiteFooter";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About neon.io — neon.io by Slither" },
      { name: "description", content: "neon.io is a free multiplayer neon snake browser game by Slither." },
      { property: "og:title", content: "About neon.io — neon.io by Slither" },
      { property: "og:description", content: "neon.io is a free multiplayer neon snake browser game by Slither." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <PageShell title="About neon.io">
      <p>neon.io is a free, browser-based multiplayer snake game made by <strong>Slither</strong>. Steer your neon snake with the mouse, eat glowing food to grow longer and thicker, boost to outrun rivals, and cut other snakes off to collect their remains.</p>
      <h2>Features</h2>
      <ul>
        <li>Real-time multiplayer rooms in Europe, Asia and the Americas, with live player counts.</li>
        <li>AI bots (clearly labelled) so there is always someone to play against.</li>
        <li>Over 25 skins: classic, country flags and premium designs, unlocked with in-game coins.</li>
        <li>Three animated premium skins available as optional one-time purchases.</li>
        <li>Graphics settings for smooth play on any computer, plus Google sign-in to save purchases.</li>
      </ul>
      <p>Playing is completely free. See <a href="/pricing">Pricing</a> for optional purchases.</p>
    </PageShell>
  );
}
