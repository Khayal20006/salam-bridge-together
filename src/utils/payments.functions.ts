import { createServerFn } from "@tanstack/react-start";
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";
import { z } from "zod";

export const resolvePaddlePrice = createServerFn({ method: "GET" })
  .validator(
    z.object({
      priceId: z.enum(["skin_rgb_price", "skin_plasma_price", "skin_legend_price"]),
      environment: z.enum(["sandbox", "live"]),
    }),
  )
  .handler(async ({ data }) => {
    const response = await gatewayFetch(
      data.environment,
      `/prices?external_id=${encodeURIComponent(data.priceId)}`,
    );
    if (!response.ok) {
      console.error(`Price lookup failed [${response.status}]`);
      throw new Error("Checkout price is currently unavailable");
    }
    const result = await response.json();
    if (!result.data?.length) throw new Error("Price not found");
    return result.data[0].id as string;
  });
