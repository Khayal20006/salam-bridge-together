import { resolvePaddlePrice } from "@/utils/payments.functions";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;

declare global {
  interface Window { Paddle: any }
}

export function getPaddleEnvironment(): "sandbox" | "live" {
  return clientToken?.startsWith("test_") ? "sandbox" : "live";
}

let paddleInitialized = false;

export async function initializePaddle() {
  if (paddleInitialized) return;
  if (!clientToken) throw new Error("VITE_PAYMENTS_CLIENT_TOKEN is not set");
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.onload = () => {
      window.Paddle.Environment.set(getPaddleEnvironment() === "sandbox" ? "sandbox" : "production");
      window.Paddle.Initialize({ token: clientToken });
      paddleInitialized = true;
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export async function getPaddlePriceId(priceId: string): Promise<string> {
  return resolvePaddlePrice({ data: { priceId, environment: getPaddleEnvironment() } });
}

/** Skins sold for real money: skin id -> price id */
export const PAID_SKINS: Record<string, { priceId: string; label: string }> = {
  rgb: { priceId: "skin_rgb_price", label: "$2.99" },
  plasma: { priceId: "skin_plasma_price", label: "$4.99" },
  legend: { priceId: "skin_legend_price", label: "$9.99" },
};
export const SKIN_BY_PRICE: Record<string, string> = Object.fromEntries(
  Object.entries(PAID_SKINS).map(([s, v]) => [v.priceId, s]),
);
