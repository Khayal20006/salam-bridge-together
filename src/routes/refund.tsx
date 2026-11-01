import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/SiteFooter";

export const Route = createFileRoute("/refund")({
  head: () => ({
    meta: [
      { title: "Refund Policy — neon.io by Slither" },
      { name: "description", content: "30-day money-back guarantee for neon.io purchases." },
      { property: "og:title", content: "Refund Policy — neon.io by Slither" },
      { property: "og:description", content: "30-day money-back guarantee for neon.io purchases." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <PageShell title="Refund Policy">
      <p>Last updated: November 1, 2026.</p>
      <p>We offer a <strong>30-day money-back guarantee</strong>. If you are not satisfied with a purchase from Slither, you can request a full refund within 30 days of your order date — no questions asked.</p>
      <h2>How to request a refund</h2>
      <p>Refunds are processed by our payment provider and Merchant of Record, Paddle. To request a refund, visit <a href="https://paddle.net">paddle.net</a> and look up your order using the email from your receipt, or reply to your Paddle receipt email. Refunds are returned to your original payment method.</p>
      <p>After a refund, the purchased skin is removed from your account. See also the <a href="https://www.paddle.com/legal/refund-policy">Paddle Refund Policy</a>.</p>
    </PageShell>
  );
}
