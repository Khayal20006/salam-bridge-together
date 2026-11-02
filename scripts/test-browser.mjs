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
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  await cdp("Runtime.enable", {}, sessionId);
  await cdp("Page.enable", {}, sessionId);
  await cdp(
    "Emulation.setDeviceMetricsOverride",
    { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  await cdp("Page.navigate", { url: process.env.APP_URL || "http://127.0.0.1:8080/" }, sessionId);
  await until(() =>
    evaluate(
      "!!document.querySelector('button[type=submit]') && !document.querySelector('button[type=submit]').disabled",
      sessionId,
    ),
  );
  const menu = await cdp("Page.captureScreenshot", { format: "png" }, sessionId);
  await writeFile("browser-menu.png", Buffer.from(menu.data, "base64"));
  await evaluate("document.querySelector('button[type=submit]').click()", sessionId);
  await until(() =>
    evaluate("!document.querySelector('form') && !!document.querySelector('canvas')", sessionId),
  );
  await sleep(600);
  const game = await cdp("Page.captureScreenshot", { format: "png" }, sessionId);
  await writeFile("browser-game.png", Buffer.from(game.data, "base64"));
  const size = await evaluate(
    "({width:document.querySelector('canvas').width,height:document.querySelector('canvas').height})",
    sessionId,
  );
  assert.deepEqual(size, { width: 1366, height: 900 });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real browser loads the menu, connects to the authoritative server, starts gameplay, renders a correctly sized canvas, and reports no JavaScript exceptions.",
  );
  console.log("Screenshots: browser-menu.png, browser-game.png");
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      await cdp("Browser.close");
    } catch {
      /* Browser may already be closed. */
    }
    socket.close();
  }
  browser.kill();
}
