import { resolvePaddlePrice } from "@/utils/payments.functions";

const clientToken = import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"];

declare global {
  interface Window {
    Paddle?: PaddleBrowser;
  }
}

type CheckoutOptions = {
  items: { priceId: string; quantity: number }[];
  customer?: { email: string };
  customData: { userId: string };
  settings: { displayMode: string; successUrl: string; allowLogout: boolean; variant: string };
};
type PaddleBrowser = {
  Initialized?: boolean;
  Environment: { set(environment: "sandbox" | "production"): void };
  Initialize(options: { token: string }): void;
  Update(options: { eventCallback: ((event: { name?: string }) => void) | null }): void;
  Checkout: { open(options: CheckoutOptions): void };
};

export function getPaddleEnvironment(): "sandbox" | "live" {
  return clientToken?.startsWith("test_") ? "sandbox" : "live";
}

let paddleInitialized = false;
let initialization: Promise<void> | undefined;

export async function initializePaddle() {
  if (paddleInitialized) return;
  if (initialization) return initialization;
  if (typeof window === "undefined") throw new Error("Checkout requires a browser");
  if (!clientToken) throw new Error("VITE_PAYMENTS_CLIENT_TOKEN is not set");
  const initialize = () => {
    const paddle = window.Paddle;
    if (!paddle) throw new Error("Paddle.js did not load");
    if (!paddle.Initialized) {
      paddle.Environment.set(getPaddleEnvironment() === "sandbox" ? "sandbox" : "production");
      paddle.Initialize({ token: clientToken });
    }
    paddleInitialized = true;
  };
  initialization = new Promise<void>((resolve, reject) => {
    if (window.Paddle) {
      try {
        initialize();
        resolve();
      } catch (error) {
        reject(error);
      }
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.async = true;
    const fail = (error: unknown) => {
      clearTimeout(timer);
      script.remove();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error("Checkout loading timed out")), 15_000);
    script.onload = () => {
      try {
        initialize();
        clearTimeout(timer);
        resolve();
      } catch (error) {
        fail(error);
      }
    };
    script.onerror = () => fail(new Error("Unable to load checkout"));
    document.head.appendChild(script);
  }).catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

export async function getPaddlePriceId(priceId: string): Promise<string> {
  if (!["skin_rgb_price", "skin_plasma_price", "skin_legend_price"].includes(priceId))
    throw new Error("Unknown skin price");
  return resolvePaddlePrice({
    data: {
      priceId: priceId as "skin_rgb_price" | "skin_plasma_price" | "skin_legend_price",
      environment: getPaddleEnvironment(),
    },
  });
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
