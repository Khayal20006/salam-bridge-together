import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/SiteFooter";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — neon.io by Slither" },
      { name: "description", content: "neon.io is free to play. Optional premium skins from US$2.99." },
      { property: "og:title", content: "Pricing — neon.io by Slither" },
      { property: "og:description", content: "neon.io is free to play. Optional premium skins from US$2.99." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <PageShell title="Pricing">
      <p>neon.io is <strong>free to play</strong>. All gameplay and most skins are free and unlocked with coins earned by playing. The following optional cosmetic skins can be purchased once and are saved to your Google account forever:</p>
      <ul>
        <li><strong>RGB Animasiya</strong> — animated rainbow skin — <strong>US$2.99</strong> (one-time)</li>
        <li><strong>Plazma</strong> — animated plasma skin — <strong>US$4.99</strong> (one-time)</li>
        <li><strong>Əfsanə ⚡ (Legend)</strong> — animated legendary skin — <strong>US$9.99</strong> (one-time)</li>
      </ul>
      <p>Prices are in US dollars; applicable taxes are calculated at checkout. There are no subscriptions. Purchases are cosmetic only and give no gameplay advantage. A 30-day money-back guarantee applies — see our <a href="/refund">Refund Policy</a>.</p>
    </PageShell>
  );
}
