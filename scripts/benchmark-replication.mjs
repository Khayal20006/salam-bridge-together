import { PerformanceObserver, performance } from "node:perf_hooks";
import { Session } from "node:inspector";
import { setImmediate } from "node:timers/promises";
import { createHash } from "node:crypto";
import { Arena } from "../src/game/engine.ts";
const { packSnapshot } = await import(process.env.BENCHMARK_PROTOCOL || "../src/game/protocol.ts");

let seed = 42;
const random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32;
const arena = new Arena(random);
const session = new Session();
session.connect();
const post = (method, params = {}) =>
  new Promise((resolve, reject) =>
    session.post(method, params, (error, result) => (error ? reject(error) : resolve(result))),
  );
const gc = [];
globalThis.gc?.();
const observer = new PerformanceObserver((list) =>
  gc.push(...list.getEntries().map((e) => e.duration)),
);
observer.observe({ entryTypes: ["gc"] });
await post("HeapProfiler.startSampling", {
  samplingInterval: 32768,
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true,
});
const publication = [];
let previous,
  bytes = 0;
const packets = createHash("sha256");
for (let tick = 0; tick < 300; tick++) {
  if (tick % 15 === 0) for (let p = 0; p < 50; p++) arena.join(`player-${p}`, `P${p}`, "hue");
  for (const snake of arena.snakes.values())
    if (!snake.bot)
      arena.input(snake.id, {
        seq: tick,
        angle: snake.angle + (random() - 0.5) * 0.5,
        boost: tick % 100 < 20,
      });
  arena.step();
  if (tick % 3 === 0) {
    const start = performance.now();
    const current = arena.snapshot();
    for (let peer = 0; peer < 50; peer++) {
      const encoded = JSON.stringify(
        packSnapshot(current, previous, { id: `player-${peer}`, radius: 1600 }),
      );
      bytes += Buffer.byteLength(encoded);
      packets.update(encoded);
    }
    previous = current;
    publication.push(performance.now() - start);
  }
  await setImmediate();
}
await setImmediate();
const { profile } = await post("HeapProfiler.stopSampling");
const allocated = (node) => node.selfSize + node.children.reduce((n, c) => n + allocated(c), 0);
observer.disconnect();
session.disconnect();
publication.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      publications: publication.length,
      recipients: 50,
      allocatedSampledMB: +(allocated(profile.head) / 1024 / 1024).toFixed(2),
      gcCount: gc.length,
      gcTotalMs: +gc.reduce((a, b) => a + b, 0).toFixed(2),
      gcMaxMs: +Math.max(0, ...gc).toFixed(2),
      publishP50Ms: +publication[50].toFixed(2),
      publishP95Ms: +publication[95].toFixed(2),
      bytes,
      packetSha256: packets.digest("hex"),
      note: "Seeded local simulation and encoding with allocation sampling; excludes browser rendering and Internet.",
    },
    null,
    2,
  ),
);
