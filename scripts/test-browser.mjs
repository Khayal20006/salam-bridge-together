import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import WebSocket from "ws";

const APP_URL = process.env.TEST_APP_URL || "http://127.0.0.1:8101";
const ARENA_URL = process.env.TEST_ARENA_URL || "ws://127.0.0.1:8798";
const profile = await mkdtemp(join(tmpdir(), "neon-browser-"));
const browser = spawn(
  process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
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
  errors = [],
  inputs = [];
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
const inject = `(() => {
 const d=window.__diag={sockets:[],frames:[],tasks:[],states:[],sent:[]};
 const Native=window.WebSocket;
 window.WebSocket=class extends Native {
  constructor(...args){if(String(args[0]).includes("salam-bridge-together.onrender.com/arena/"))args[0]=String(args[0]).replace("wss://salam-bridge-together.onrender.com",${JSON.stringify(ARENA_URL)});super(...args); const info={url:String(args[0]),closed:[]}; d.sockets.push(info);if(info.url.includes("/arena/"))(window.__arenaSockets??=[]).push(this);
   this.addEventListener('close',e=>info.closed.push({code:e.code,reason:e.reason}));
   this.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(m.type==='state')d.states.push({at:performance.now(),tick:m.state.tick,base:m.state.base,count:m.count,bytes:e.data.length,snakes:m.state.snakes.map(s=>({id:s[0],bot:s[6],head:s[8].slice(0,2)}))});}catch{}});
  }
  send(value){try{const m=JSON.parse(value);if(m.type==='input')d.sent.push({at:performance.now(),seq:m.seq});}catch{}return super.send(value)}
 };
 let last;function frame(t){if(last!==undefined)d.frames.push({at:t,dt:t-last});last=t;requestAnimationFrame(frame)}requestAnimationFrame(frame);
 new PerformanceObserver(list=>d.tasks.push(...list.getEntries().map(e=>({at:e.startTime,dt:e.duration})))).observe({entryTypes:['longtask']});
})();`;
async function page() {
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank", newWindow: true });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  await cdp("Runtime.enable", {}, sessionId);
  await cdp("Page.enable", {}, sessionId);
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: inject }, sessionId);
  const mobile = process.env.MOBILE_PROBE === "1";
  await cdp(
    "Emulation.setDeviceMetricsOverride",
    mobile
      ? { width: 392, height: 720, deviceScaleFactor: 2, mobile: true }
      : { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  if (mobile) {
    await cdp("Emulation.setCPUThrottlingRate", { rate: 4 }, sessionId);
    await cdp(
      "Emulation.setTouchEmulationEnabled",
      { enabled: true, maxTouchPoints: 5 },
      sessionId,
    );
  }
  await cdp("Page.navigate", { url: APP_URL + "/?room=eu-3" }, sessionId);
  await until(
    () =>
      evaluate(
        "!!document.querySelector('button[type=submit]') && !document.querySelector('button[type=submit]').disabled",
        sessionId,
      ),
    40000,
  );
  await until(
    () =>
      evaluate(
        "document.body.innerText.includes('Onlayn') && window.__diag.sockets.some(s=>s.url.endsWith('/arena/eu-3'))",
        sessionId,
      ),
    40000,
  );
  await evaluate("document.querySelector('button[type=submit]').click()", sessionId);
  await evaluate(
    "setInterval(()=>document.querySelector('canvas').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:innerWidth/2+120*Math.cos(performance.now()/3500),clientY:innerHeight/2+120*Math.sin(performance.now()/3500)})),100)",
    sessionId,
  );
  await evaluate(
    "setInterval(()=>{const b=document.querySelector('button[type=submit]');if(b&&!b.disabled)b.click()},750)",
    sessionId,
  );
  return sessionId;
}
function stats(data, after = 0) {
  const states = data.states.filter((s) => s.at > after),
    frames = data.frames.filter((s) => s.at > after);
  const summary = (values) => {
    const v = values.toSorted((a, b) => a - b);
    return {
      n: v.length,
      p50: v[Math.floor(v.length * 0.5)],
      p95: v[Math.floor(v.length * 0.95)],
      max: v.at(-1),
      over200: v.filter((x) => x > 200).length,
    };
  };
  return {
    sockets: data.sockets.filter((s) => s.url.includes("/arena/")),
    packets: summary(states.slice(1).map((s, i) => s.at - states[i].at)),
    frames: summary(frames.map((f) => f.dt)),
    counts: [...new Set(states.map((s) => s.count))],
    tasks: data.tasks.filter((t) => t.at > after),
    inputs: data.sent.length,
  };
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
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
    }
    if (msg.method === "Runtime.exceptionThrown")
      errors.push(
        msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text,
      );
  };
  const a = await page();
  console.log("BROWSER_FIRST_READY");
  await sleep(10000);
  const first = await evaluate("window.__diag", a);
  assert.ok(first.sockets.some((s) => s.url === ARENA_URL + "/arena/eu-3"));
  assert.ok(first.states.length > 50);
  console.log("BROWSER_ONE", JSON.stringify(stats(first, 2000)));
  const split = await evaluate("performance.now()", a);
  const b = await page();
  console.log("BROWSER_SECOND_READY");
  await sleep(16000);
  const one = await evaluate("window.__diag", a),
    two = await evaluate("window.__diag", b);
  await writeFile(
    join(
      tmpdir(),
      "neon-canvas-browser-report" + (process.env.MOBILE_PROBE === "1" ? "-mobile" : "") + ".json",
    ),
    JSON.stringify({ first, one, two }),
  );
  assert.ok(two.sockets.some((s) => s.url === ARENA_URL + "/arena/eu-3"));
  assert.ok(one.states.some((s) => s.count === 2));
  assert.ok(two.states.some((s) => s.count === 2));
  const common = one.states.find(
    (s) =>
      s.count === 2 &&
      two.states.some((t) => t.tick === s.tick && t.snakes.filter((x) => !x.bot).length === 2) &&
      s.snakes.filter((x) => !x.bot).length === 2,
  );
  assert.ok(common, "two browsers must see both players on a shared tick");
  const other = two.states.find((s) => s.tick === common.tick);
  assert.deepEqual(
    common.snakes.map((s) => ({ id: s.id, head: s.head })),
    other.snakes.map((s) => ({ id: s.id, head: s.head })),
  );
  console.log("BROWSER_TWO_A", JSON.stringify(stats(one, split + 2000)));
  console.log("BROWSER_TWO_B", JSON.stringify(stats(two, 3000)));
  await cdp("Network.enable", {}, b);
  await cdp(
    "Network.emulateNetworkConditions",
    { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
    b,
  );
  await evaluate("window.__arenaSockets.forEach(s=>s.close())", b);
  await sleep(7500);
  const fallback = await evaluate("document.body.innerText.includes('Lokal oflayn oyun')", b);
  assert.ok(fallback, "connection loss must enter clearly labelled offline mode");
  await sleep(2000);
  assert.ok(
    await evaluate("!document.querySelector('button[type=submit]')", b),
    "offline worker must accept play",
  );
  console.log("OFFLINE_FALLBACK_PASS");
  console.log("BROWSER_ERRORS", JSON.stringify(errors));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: two production-build browsers use the local test arena (hosted endpoint intercepted by harness); shared tick, players and heads match.",
  );
  await writeFile(
    join(
      tmpdir(),
      "neon-canvas-browser-report" + (process.env.MOBILE_PROBE === "1" ? "-mobile" : "") + ".json",
    ),
    JSON.stringify({ first, one, two }),
  );
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      await cdp("Browser.close");
    } catch {}
    socket.close();
  }
  browser.kill();
}
