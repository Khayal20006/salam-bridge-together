import { createHash } from "node:crypto";
import { Session } from "node:inspector";
import { PerformanceObserver, performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
const { Arena } = await import(process.env.BENCHMARK_ENGINE || "../src/game/engine.ts");

let seed = 42;
const random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32;
const arena = new Arena(random),
  inspector = new Session();
inspector.connect();
const post = (method, params = {}) =>
  new Promise((resolve, reject) =>
    inspector.post(method, params, (error, result) => (error ? reject(error) : resolve(result))),
  );
const gc = [],
  times = [];
globalThis.gc?.();
const observer = new PerformanceObserver((list) =>
  gc.push(...list.getEntries().map((e) => e.duration)),
);
observer.observe({ entryTypes: ["gc"] });
await post("HeapProfiler.startSampling", {
  samplingInterval: 16384,
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true,
});
let humans = 0;
for (let tick = 0; tick < 600; tick++) {
  if (tick % 15 === 0) for (let p = 0; p < 50; p++) arena.join(`player-${p}`, `P${p}`, "hue");
  for (const snake of arena.snakes.values())
    if (!snake.bot)
      arena.input(snake.id, {
        seq: tick,
        angle: snake.angle + (random() - 0.5) * 0.5,
        boost: tick % 100 < 20,
      });
  const start = performance.now();
  arena.step();
  times.push(performance.now() - start);
  for (const snake of arena.snakes.values()) if (!snake.bot) humans++;
  await setImmediate();
}
await setImmediate();
const { profile } = await post("HeapProfiler.stopSampling");
observer.disconnect();
inspector.disconnect();
const allocated = (node) =>
  node.selfSize + node.children.reduce((sum, child) => sum + allocated(child), 0);
times.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      ticks: times.length,
      averageHumans: +(humans / 600).toFixed(1),
      bots: 18,
      allocatedSampledMB: +(allocated(profile.head) / 1024 / 1024).toFixed(2),
      gcCount: gc.length,
      gcMaxMs: +Math.max(0, ...gc).toFixed(2),
      tickP95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2),
      stateSha256: createHash("sha256").update(JSON.stringify(arena.snapshot())).digest("hex"),
      note: "Local simulation with allocation profiler overhead; excludes rendering, replication and Internet.",
    },
    null,
    2,
  ),
);
