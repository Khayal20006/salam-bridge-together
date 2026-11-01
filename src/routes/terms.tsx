import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/SiteFooter";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — neon.io by Slither" },
      { name: "description", content: "Terms of Service for neon.io, operated by Slither." },
      { property: "og:title", content: "Terms of Service — neon.io by Slither" },
      { property: "og:description", content: "Terms of Service for neon.io, operated by Slither." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <PageShell title="Terms of Service">
      <p>Last updated: November 1, 2026.</p>
      <p>These Terms govern your use of neon.io (the "Service"), operated by <strong>Slither</strong> ("we", "us"). You are contracting with Slither. By accessing or continuing to use the Service you agree to these Terms.</p>
      <h2>1. The Service</h2>
      <p>neon.io is a free online multiplayer browser game with optional one-time purchases of cosmetic skins. You must be of legal age in your country, or have permission from a parent or guardian, to make purchases.</p>
      <h2>2. Accounts</h2>
      <p>You may sign in with Google. You are responsible for activity under your account and for keeping your credentials secure, and you must provide accurate information.</p>
      <h2>3. Acceptable use</h2>
      <p>You must not misuse the Service, including: using it for unlawful purposes; fraud, spam or impersonation; infringing intellectual property; cheating, exploiting bugs or using bots; or interfering with security (uploading malware, probing, scraping, overloading servers or reverse engineering). Player names must not be offensive or hateful.</p>
      <h2>4. Intellectual property</h2>
      <p>Slither owns the Service and all related intellectual property, including software, graphics, skins and branding. Purchased skins grant you a limited, non-exclusive, non-transferable licence to use them within the game; they have no cash value and cannot be resold.</p>
      <h2>5. Payments</h2>
      <p>Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders. Paddle provides all customer service inquiries and handles returns. Payment, billing, tax and refund terms are governed by the <a href="https://www.paddle.com/legal/checkout-buyer-terms">Paddle Buyer Terms</a>.</p>
      <h2>6. Service level</h2>
      <p>The Service is provided "as is". We do not guarantee uninterrupted, lag-free or error-free operation, and we may change or discontinue features. To the fullest extent permitted by law, we disclaim all implied warranties.</p>
      <h2>7. Suspension and termination</h2>
      <p>We may suspend or terminate access for material breach of these Terms, non-payment or chargebacks, security or fraud risk, or repeated or serious policy violations.</p>
      <h2>8. Liability</h2>
      <p>To the extent permitted by law, our total liability is limited to the amount you paid us in the 12 months before the claim, and we are not liable for indirect or consequential losses. Nothing limits liability for fraud, death or personal injury where the law does not allow it.</p>
      <h2>9. Changes and contact</h2>
      <p>We may update these Terms; continued use means you accept the changes. Questions: contact Slither through the game website at neonworm.app.</p>
    </PageShell>
  );
}
