import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/utils/payments.functions", () => ({ resolvePaddlePrice: vi.fn() }));
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_PAYMENTS_CLIENT_TOKEN", "test_example");
  vi.useFakeTimers();
  document.head.innerHTML = "";
  delete window.Paddle;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete window.Paddle;
  document.head.innerHTML = "";
});

describe("checkout loader", () => {
  it("shares one script and initialization across simultaneous callers", async () => {
    const { initializePaddle } = await import("./paddle");
    const first = initializePaddle(),
      second = initializePaddle();
    expect(document.querySelectorAll("script")).toHaveLength(1);
    const initialize = vi.fn();
    window.Paddle = {
      Environment: { set: vi.fn() },
      Initialize: initialize,
      Update: vi.fn(),
      Checkout: { open: vi.fn() },
    };
    document.querySelector("script")!.dispatchEvent(new Event("load"));
    await Promise.all([first, second]);
    await initializePaddle();
    expect(initialize).toHaveBeenCalledTimes(1);
  });
  it("rejects loading errors and permits a retry", async () => {
    const { initializePaddle } = await import("./paddle");
    const first = initializePaddle();
    const rejected = expect(first).rejects.toThrow("Unable to load");
    document.querySelector("script")!.dispatchEvent(new Event("error"));
    await rejected;
    expect(document.querySelectorAll("script")).toHaveLength(0);
    const second = initializePaddle();
    window.Paddle = {
      Environment: { set: vi.fn() },
      Initialize: vi.fn(),
      Update: vi.fn(),
      Checkout: { open: vi.fn() },
    };
    document.querySelector("script")!.dispatchEvent(new Event("load"));
    await second;
  });
  it("times out instead of leaving checkout stuck forever", async () => {
    const { initializePaddle } = await import("./paddle");
    const result = expect(initializePaddle()).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_001);
    await result;
    expect(document.querySelectorAll("script")).toHaveLength(0);
  });
});
