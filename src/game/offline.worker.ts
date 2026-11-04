import { Arena, STEP_MS } from "./engine";
const arena = new Arena();
const id = "offline-player";
let seq = 0;
self.onmessage = (event: MessageEvent) => {
  const m = event.data;
  if (m.type === "join") {
    arena.join(id, m.name, m.skin);
    self.postMessage({ type: "state", state: arena.snapshot(), id });
  } else if (m.type === "input") arena.input(id, { seq: ++seq, angle: m.angle, boost: m.boost });
};
let last = performance.now(),
  accumulator = 0;
setInterval(() => {
  const now = performance.now();
  accumulator += Math.min(120, now - last);
  last = now;
  while (accumulator >= STEP_MS) {
    arena.step();
    accumulator -= STEP_MS;
  }
  self.postMessage({ type: "state", state: arena.snapshot(), id });
}, 50);
