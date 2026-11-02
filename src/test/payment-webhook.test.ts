import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), upsert: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock("@/lib/paddle.server", () => ({
  verifyWebhook: mocks.verify,
  EventName: { TransactionCompleted: "transaction.completed" },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ upsert: mocks.upsert }) },
}));
import { Route } from "@/routes/api/public/payments/webhook";
const handler = (
  Route as unknown as {
    server: { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } };
  }
).server.handlers.POST;
const completed = {
  eventType: "transaction.completed",
  data: {
    id: "txn_test",
    customData: { userId: "11111111-1111-4111-8111-111111111111" },
    items: [{ price: { importMeta: { externalId: "skin_rgb_price" } } }],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue(structuredClone(completed));
  mocks.upsert.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("payment webhook", () => {
  it("grants a verified purchase idempotently with environment-scoped transaction IDs", async () => {
    for (let i = 0; i < 2; i++)
      expect(
        (
          await handler({
            request: new Request("https://example.com/api/public/payments/webhook?env=live", {
              method: "POST",
            }),
          })
        ).status,
      ).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(
      {
        user_id: completed.data.customData.userId,
        skin_id: "rgb",
        environment: "live",
        transaction_id: "live:txn_test:rgb",
      },
      { onConflict: "transaction_id" },
    );
  });
  it("rejects invalid signatures before touching purchases", async () => {
    mocks.verify.mockRejectedValue(new Error("Invalid signature"));
    expect(
      (await handler({ request: new Request("https://example.com/webhook", { method: "POST" }) }))
        .status,
    ).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("reports a database failure for retry instead of acknowledging a lost purchase", async () => {
    mocks.upsert.mockResolvedValue({ error: new Error("Database unavailable") });
    expect(
      (await handler({ request: new Request("https://example.com/webhook", { method: "POST" }) }))
        .status,
    ).toBe(500);
  });
  it("does not accept an unknown payment environment", async () => {
    expect(
      (
        await handler({
          request: new Request("https://example.com/webhook?env=wrong", { method: "POST" }),
        })
      ).status,
    ).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
