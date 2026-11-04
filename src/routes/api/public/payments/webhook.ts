import { createFileRoute } from "@tanstack/react-router";
import { verifyWebhook, EventName, type PaddleEnv } from "@/lib/paddle.server";
import type { TransactionCompletedEvent } from "@paddle/paddle-node-sdk";
import { z } from "zod";

const SKIN_BY_PRICE: Record<string, string> = {
  skin_rgb_price: "rgb",
  skin_plasma_price: "plasma",
  skin_legend_price: "legend",
};

async function handleTransactionCompleted(data: TransactionCompletedEvent["data"], env: PaddleEnv) {
  const userId = z.string().uuid().parse(data.customData?.["userId"]);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  for (const item of data.items ?? []) {
    const price = item.price?.importMeta?.externalId;
    const skin = price ? SKIN_BY_PRICE[price] : undefined;
    if (!skin) continue;
    const { error } = await supabaseAdmin
      .from("skin_purchases")
      .upsert(
        {
          user_id: userId,
          skin_id: skin,
          environment: env,
          transaction_id: `${env}:${data.id}:${skin}`,
        },
        { onConflict: "transaction_id" },
      );
    if (error) throw error;
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestedEnv = new URL(request.url).searchParams.get("env") ?? "sandbox";
        if (requestedEnv !== "live" && requestedEnv !== "sandbox")
          return new Response("Invalid environment", { status: 400 });
        const env: PaddleEnv = requestedEnv;
        let event: Awaited<ReturnType<typeof verifyWebhook>>;
        try {
          event = await verifyWebhook(request, env);
        } catch (error) {
          console.error("Webhook verification failed:", error);
          return new Response("Invalid webhook", { status: 400 });
        }
        try {
          if (event.eventType === EventName.TransactionCompleted)
            await handleTransactionCompleted(event.data, env);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook processing failed", { status: 500 });
        }
      },
    },
  },
});
