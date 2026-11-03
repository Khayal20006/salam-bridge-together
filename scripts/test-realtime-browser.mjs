import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import WebSocket from "ws";

const profile = await mkdtemp(join(tmpdir(), "neon-browser-"));
const browser = spawn(
  process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--disable-extensions",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
);
let endpoint,
  socket,
  seq = 0;
const pending = new Map(),
  errors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
browser.stderr.on("data", (data) => {
  const m = /DevTools listening on (ws:\/\/\S+)/.exec(data.toString());
  if (m) endpoint = m[1];
});
const exited = new Promise((_, reject) => {
  browser.once("error", reject);
  browser.once("exit", (code) => reject(new Error(`Browser exited: ${code}`)));
});
async function until(predicate, timeout = 15_000) {
  const start = performance.now();
  while (!(await predicate())) {
    if (performance.now() - start > timeout) throw new Error("Browser check timed out");
    await sleep(50);
  }
}
function cdp(method, params = {}, sessionId) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timed out: ${method}`));
    }, 10_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression, session) {
  const r = await cdp(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    session,
  );
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

// Isolated test topics use the real backend relay without joining public game rooms.
const namespace = `neon-test-${crypto.randomUUID()}`;
async function page(room = "eu-4") {
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  await cdp("Runtime.enable", {}, sessionId);
  await cdp("Page.enable", {}, sessionId);
  await cdp("Page.navigate", { url: process.env.APP_URL || "http://127.0.0.1:8080/" }, sessionId);
  await until(() => evaluate("document.readyState === 'complete'", sessionId));
  await connectPage(sessionId, room);
  return { sessionId, targetId };
}
async function connectPage(sessionId, room = "eu-4") {
  await evaluate(
    `(async () => {
    const {RealtimeConnection} = await import('/src/game/realtime.ts');
    window.testStates = new Map();
    window.testStatus = '';
    window.testRejections = [];
    window.testArena = new RealtimeConnection(${JSON.stringify(room)}, {
      snapshot(state, id, world) {
        window.testId = id;
        window.testWorld = world;
        window.testStates.set(state.tick, JSON.stringify(state));
        if (window.testStates.size > 100) window.testStates.delete(window.testStates.keys().next().value);
      },
      status(status) { window.testStatus = status; },
      rejected(reason) { window.testRejections.push(reason); },
      count() {},
    }, {namespace: ${JSON.stringify(namespace)}});
  })()`,
    sessionId,
  );
}
const check = (p, expression) => evaluate(expression, p.sessionId);
async function matching(a, b) {
  const one = await check(a, "[...window.testStates]");
  const two = new Map(await check(b, "[...window.testStates]"));
  const matches = one.filter(([tick, state]) => two.get(tick) === state);
  return { count: matches.length, last: matches.at(-1) };
}
try {
  await Promise.race([until(() => !!endpoint), exited]);
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
    }
    if (msg.method === "Runtime.exceptionThrown")
      errors.push(
        msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text,
      );
  };
  const a = await page();
  const b = await page();
  await until(async () => (await matching(a, b)).count >= 5, 25_000);
  assert.equal(await check(a, "window.testWorld"), await check(b, "window.testWorld"));
  assert.equal(await check(a, "window.testArena.host"), await check(b, "window.testArena.host"));
  const initial = JSON.parse((await matching(a, b)).last[1]);
  assert.equal(initial.snakes.filter((s) => s.bot).length, 18);
  console.log(
    "PASS: two real browsers receive identical ticks, bot bodies, food and deaths over Supabase.",
  );
  await check(a, "window.testArena.play('Alpha','aurora')");
  await check(b, "window.testArena.play('Beta','ice')");
  await until(async () => {
    const match = (await matching(a, b)).last;
    return match && JSON.parse(match[1]).snakes.filter((s) => !s.bot).length === 2;
  });
  console.log("PASS: both players join the same world.");
  const host = (await check(a, "!!window.testArena.worker")) ? a : b;
  const follower = host === a ? b : a;
  const hiddenHost = await check(host, "document.hidden"),
    hiddenFollower = await check(follower, "document.hidden");
  const beforeSwitch = await check(host, "window.testArena.current.tick");
  await check(
    host,
    "Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))",
  );
  await check(
    follower,
    "Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))",
  );
  await sleep(250);
  assert.equal(await check(host, "!!window.testArena.worker"), true);
  assert.ok((await check(host, "window.testArena.current.tick")) > beforeSwitch);
  await check(
    host,
    `Object.defineProperty(document,'hidden',{configurable:true,get:()=>${hiddenHost}});document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await check(
    follower,
    `Object.defineProperty(document,'hidden',{configurable:true,get:()=>${hiddenFollower}});document.dispatchEvent(new Event('visibilitychange'))`,
  );
  console.log("PASS: a brief tab switch does not stop the authority worker.");
  const world = await check(host, "window.testWorld");
  const tick = await check(follower, "window.testArena.current.tick");
  await check(
    host,
    `Object.defineProperty(document, 'hidden', {configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await check(
    follower,
    `Object.defineProperty(document, 'hidden', {configurable:true,get:()=>false});
    document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await until(
    async () =>
      (await check(follower, "!!window.testArena.worker")) &&
      !(await check(host, "!!window.testArena.worker")) &&
      (await check(follower, "window.testArena.current.tick")) > tick + 5,
  );
  assert.equal(await check(follower, "window.testWorld"), world);
  await until(async () => (await matching(a, b)).count >= 10);
  console.log("PASS: backgrounding the host transfers authority and preserves the shared world.");
  // Drop one baseline on a follower; the next delta must request and accept a keyframe.
  await check(host, "window.testArena.current = undefined; window.testStates.clear()");
  await until(async () => (await matching(a, b)).count >= 3);
  console.log("PASS: a missing delta baseline recovers automatically.");
  const reloadTick = await check(host, "window.testArena.current.tick");
  const previousId = await check(follower, "window.testId");
  const reloadUrl = new URL(process.env.APP_URL || "http://127.0.0.1:8080/");
  reloadUrl.searchParams.set("reload-check", Date.now().toString());
  await cdp("Page.navigate", { url: reloadUrl.href }, follower.sessionId);
  await until(() => check(follower, "document.readyState === 'complete' && !window.testArena"));
  await connectPage(follower.sessionId);
  await until(() => check(follower, "window.testStatus === 'online'"));
  await check(follower, "window.testArena.play('AfterRefresh','hue')");
  await until(async () => {
    const match = (await matching(a, b)).last;
    return (
      match &&
      match[0] > reloadTick &&
      JSON.parse(match[1]).snakes.some((s) => s.name === "AfterRefresh") &&
      !JSON.parse(match[1]).snakes.some((s) => s.id === previousId)
    );
  }, 25000);
  assert.equal(await check(follower, "window.testWorld"), world);
  console.log(
    "PASS: refreshing the host releases its old presence and rejoins the same advancing world.",
  );
  const owner = (await check(a, "!!window.testArena.worker")) ? a : b;
  const survivor = owner === a ? b : a;
  const beforeClose = await check(survivor, "window.testArena.current.tick");
  await check(owner, "window.testArena.close()");
  await until(
    async () =>
      (await check(survivor, "!!window.testArena.worker")) &&
      (await check(survivor, "window.testArena.current.tick")) > beforeClose + 5,
  );
  assert.equal(await check(survivor, "window.testWorld"), world);
  console.log("PASS: closing the host preserves the world on the surviving client.");
  await check(survivor, "window.testArena.close()");
  assert.deepEqual(errors, []);
  console.log("PASS: no browser JavaScript exceptions.");
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      await cdp("Browser.close");
    } catch {
      /* Already closed. */
    }
    socket.close();
  }
  browser.kill();
}
