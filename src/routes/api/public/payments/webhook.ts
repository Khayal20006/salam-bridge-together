import { createFileRoute } from "@tanstack/react-router";
import { verifyWebhook, EventName, type PaddleEnv } from "@/lib/paddle.server";

const SKIN_BY_PRICE: Record<string, string> = {
  skin_rgb_price: "rgb",
  skin_plasma_price: "plasma",
  skin_legend_price: "legend",
};

async function handleTransactionCompleted(data: any, env: PaddleEnv) {
  const userId = data.customData?.userId;
  if (!userId) { console.error("No userId in customData"); return; }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  for (const item of data.items ?? []) {
    const skin = SKIN_BY_PRICE[item.price?.importMeta?.externalId];
    if (!skin) continue;
    const { error } = await supabaseAdmin.from("skin_purchases").upsert(
      { user_id: userId, skin_id: skin, environment: env, transaction_id: `${data.id}:${skin}` },
      { onConflict: "transaction_id" },
    );
    if (error) throw error;
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = (new URL(request.url).searchParams.get("env") === "live" ? "live" : "sandbox") as PaddleEnv;
        try {
          const event = await verifyWebhook(request, env);
          if (event.eventType === EventName.TransactionCompleted) await handleTransactionCompleted(event.data, env);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
