import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { unpackSnapshot } from "../src/game/protocol.ts";

const child = spawn(process.execPath, ["server/arena.mjs"], {
  env: { ...process.env, ARENA_PORT: "0" },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
const sockets = [];
let stderr = "";
child.stderr.on("data", (data) => {
  stderr += data;
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, timeout = 8000) {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeout)
      throw new Error(`Timeout waiting for arena: ${stderr}`);
    await delay(20);
  }
}
try {
  let port;
  child.stdout.on("data", (data) => {
    const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(data.toString());
    if (match) port = Number(match[1]);
  });
  await until(() => !!port);
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  function connect(room) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/arena/${room}`);
    sockets.push(ws);
    const client = { ws, id: "", states: new Map(), last: undefined, errors: [] };
    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "hello") client.id = msg.id;
        if (msg.type === "state") {
          const next = unpackSnapshot(msg.state, client.last);
          if (!next) throw new Error("Invalid or missing authoritative delta");
          client.last = next;
          client.states.set(next.tick, next);
        }
      } catch (error) {
        client.errors.push(error);
      }
    });
    return client;
  }
  const a = connect("eu-1"),
    b = connect("eu-1"),
    other = connect("eu-2");
  await until(() => a.id && b.id && other.id && a.last && b.last && other.last);
  a.ws.send(JSON.stringify({ type: "join", name: "Alpha", skin: "aurora" }));
  b.ws.send(JSON.stringify({ type: "join", name: "Beta", skin: "ice" }));
  let matched;
  await until(() => {
    for (const [tick, state] of a.states) {
      const second = b.states.get(tick);
      if (
        second &&
        state.snakes.some((s) => s.id === a.id) &&
        state.snakes.some((s) => s.id === b.id)
      ) {
        matched = [state, second];
        return true;
      }
    }
    return false;
  });
  const heads = (state) =>
    state.snakes.map((s) => ({ id: s.id, head: s.pts[0], len: s.len, skin: s.skin, bot: s.bot }));
  assert.deepEqual(heads(matched[0]), heads(matched[1]));
  assert.deepEqual(matched[0].foods, matched[1].foods);
  assert.equal(matched[0].snakes.filter((s) => s.bot).length, 18);
  assert.ok(other.last.snakes.every((s) => s.id !== a.id && s.id !== b.id));
  // Malformed, forged-position and out-of-order commands must not corrupt either client.
  a.ws.send("{");
  a.ws.send(
    JSON.stringify({ type: "input", seq: 1, angle: 0, boost: true, x: 1000000, len: 1000000 }),
  );
  a.ws.send(JSON.stringify({ type: "input", seq: 0, angle: null, boost: true }));
  await delay(350);
  assert.equal(a.errors.length + b.errors.length + other.errors.length, 0);
  b.ws.close();
  await until(() => !a.last.snakes.some((s) => s.id === b.id));
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/health`)).json()).players, 2);
  console.log(
    "PASS: real WebSocket clients share bots, head positions, food and tick; rooms stay isolated; malformed input is ignored; disconnect removes its snake.",
  );
} finally {
  for (const ws of sockets) ws.close();
  child.kill();
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3500)]);
}
