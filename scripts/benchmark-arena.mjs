import { performance } from "node:perf_hooks";
const { Arena } = await import(process.env.BENCHMARK_ENGINE || "../src/game/engine.ts");
import { packSnapshot } from "../src/game/protocol.ts";

let seed = 42;
const random = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const arena = new Arena(random);
const times = [],
  wire = [];
let previous,
  players = 0;
for (let i = 0; i < 600; i++) {
  if (i % 15 === 0) for (let p = 0; p < 50; p++) arena.join(`player-${p}`, `P${p}`, "hue");
  for (const s of arena.snakes.values())
    if (!s.bot)
      arena.input(s.id, { seq: i, angle: s.angle + (random() - 0.5) * 0.5, boost: i % 100 < 20 });
  const start = performance.now();
  arena.step();
  times.push(performance.now() - start);
  players += [...arena.snakes.values()].filter((s) => !s.bot).length;
  if (i % 3 === 0) {
    const current = arena.snapshot();
    wire.push(
      Buffer.byteLength(
        JSON.stringify(packSnapshot(current, previous, { id: "player-0", radius: 1600 })),
      ),
    );
    previous = current;
  }
}
times.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      ticks: times.length,
      averageHumanPlayers: +(players / 600).toFixed(1),
      bots: 18,
      tickBudgetMs: +(1000 / 30).toFixed(2),
      p50Ms: +times[Math.floor(times.length * 0.5)].toFixed(2),
      p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2),
      p99Ms: +times[Math.floor(times.length * 0.99)].toFixed(2),
      maxMs: +times.at(-1).toFixed(2),
      averageSnapshotBytes: Math.round(wire.reduce((a, b) => a + b, 0) / wire.length),
      note: "Local simulation/encoding measurement, not a production network or 50-browser load test.",
    },
    null,
    2,
  ),
);
