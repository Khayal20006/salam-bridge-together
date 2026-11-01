import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/SiteFooter";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — neon.io by Slither" },
      { name: "description", content: "How Slither collects and uses personal data in neon.io." },
      { property: "og:title", content: "Privacy Policy — neon.io by Slither" },
      { property: "og:description", content: "How Slither collects and uses personal data in neon.io." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <PageShell title="Privacy Policy">
      <p>Last updated: November 1, 2026.</p>
      <p><strong>Slither</strong> operates neon.io and is the data controller for personal data processed through the Service.</p>
      <h2>Data we collect and why</h2>
      <ul>
        <li><strong>Account data</strong> (name, email, profile picture from Google sign-in) — to create your account and save purchases (contract performance).</li>
        <li><strong>Gameplay data</strong> (player name, snake position, chosen skin, room) — shared in real time with other players to provide the multiplayer game (contract performance).</li>
        <li><strong>Purchase records</strong> (which skins you bought, transaction ID) — to unlock items and handle refunds (contract performance, legal obligation).</li>
        <li><strong>Technical data</strong> (IP address, device and browser info, logs) — for security, fraud prevention and fixing problems (legitimate interests).</li>
        <li><strong>Local settings</strong> (coins, graphics settings) stored in your browser's local storage.</li>
      </ul>
      <h2>Sharing</h2>
      <ul>
        <li>Hosting and infrastructure service providers who process data on our behalf.</li>
        <li>Paddle.com, our Merchant of Record, for sales, payments, tax compliance and invoicing. Paddle processes payment details under its own privacy policy.</li>
        <li>Google, for sign-in.</li>
        <li>Professional advisers, and authorities where required by law.</li>
      </ul>
      <h2>Retention</h2>
      <p>We keep account and purchase data while your account is active and as required for tax and legal purposes, then delete or anonymise it. Gameplay data is transient and not stored.</p>
      <h2>Your rights</h2>
      <p>Depending on where you live, you may access, correct, delete, restrict or export your data, object to processing, withdraw consent, and complain to a data protection authority. We respond within one month. Data may be processed outside your country with appropriate safeguards such as standard contractual clauses.</p>
      <h2>Security and cookies</h2>
      <p>We use encryption in transit and access controls. We use only essential storage (sign-in session and game settings); no advertising cookies. You can clear them in your browser settings.</p>
      <h2>Contact</h2>
      <p>To exercise your rights, contact Slither through neonworm.app.</p>
    </PageShell>
  );
}
