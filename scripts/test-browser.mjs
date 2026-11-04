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
    if (msg.method === "Network.webSocketFrameSent") {
      try {
        const packet = JSON.parse(msg.params.response.payloadData);
        if (packet.type === "input") inputs.push(packet);
      } catch {
        /* Non-JSON transport frames are irrelevant to controls. */
      }
    }
  };
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  await cdp("Runtime.enable", {}, sessionId);
  await cdp("Page.enable", {}, sessionId);
  await cdp("Network.enable", {}, sessionId);
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
  const beforeRight = inputs.length;
  await cdp(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x: 900, y: 500, button: "right", buttons: 2, clickCount: 1 },
    sessionId,
  );
  await until(() => inputs.slice(beforeRight).some((input) => input.boost === true));
  assert.equal(
    await evaluate(
      "document.querySelector('canvas').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}))",
      sessionId,
    ),
    false,
  );
  const beforeRelease = inputs.length;
  await cdp(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x: 900, y: 500, button: "right", buttons: 0, clickCount: 1 },
    sessionId,
  );
  await until(() => inputs.slice(beforeRelease).some((input) => input.boost === false));
  const game = await cdp("Page.captureScreenshot", { format: "png" }, sessionId);
  await writeFile("browser-game.png", Buffer.from(game.data, "base64"));
  const size = await evaluate(
    "({width:document.querySelector('canvas').width,height:document.querySelector('canvas').height})",
    sessionId,
  );
  assert.deepEqual(size, { width: 1366, height: 900 });
  if (process.env.SURFACE_DIAGNOSTICS === "1") {
    const report = await evaluate(
      `(async () => {
      const frames=[], longTasks=[];
      const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration)));
      observer.observe({entryTypes:['longtask']});
      let previous=performance.now();
      await new Promise(resolve=>{const frame=now=>{frames.push(now-previous);previous=now;if(frames.length<300)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
      observer.disconnect();
      frames.sort((a,b)=>a-b);
      const {drawSnakeSurface}=await import('/src/game/snake-surface.ts');
      const {smoothSpine}=await import('/src/game/movement.ts');
      const {SKIN_BY}=await import('/src/lib/skins.ts');
      const gallery=document.createElement('canvas');gallery.width=1200;gallery.height=900;
      const ctx=gallery.getContext('2d');ctx.fillStyle='#0b0f1a';ctx.fillRect(0,0,1200,900);
      const ids=['hue','jungle','rainbow','fire','aurora','obsidian','cosmos','sakura','royal'];
      for(let row=0;row<ids.length;row++){
        const body=Array.from({length:96},(_,i)=>({x:1050-i*8,y:row*95+55+Math.sin(i/15)*20}));
        const points=[];smoothSpine(body,points,4,Math.atan2(body[0].y-body[1].y,body[0].x-body[1].x));
        drawSnakeSurface(ctx,points,16,SKIN_BY[ids[row]],145,1234,false,4,false);
        ctx.fillStyle='#e0eaff';ctx.font='16px sans-serif';ctx.fillText(SKIN_BY[ids[row]].name,20,row*95+55);
      }
      window.surfaceGallery=gallery.toDataURL('image/png');
      const spine=[];smoothSpine(Array.from({length:240},(_,i)=>({x:1100-i*4,y:450+Math.sin(i/20)*100})),spine,1,0);
      const costs=[];
      for(let sample=0;sample<30;sample++){
        const start=performance.now();
        for(let n=0;n<18;n++)drawSnakeSurface(ctx,spine,16,SKIN_BY[ids[n%ids.length]],145,1234+sample*16,true,1,false);
        ctx.getImageData(0,0,1,1); // Flush Canvas commands so the sample includes drawing work.
        costs.push(performance.now()-start);
      }
      costs.sort((a,b)=>a-b);
      return {frames:frames.length,p95Ms:+frames[Math.floor(frames.length*.95)].toFixed(2),maxMs:+frames.at(-1).toFixed(2),longTasks:longTasks.length,
        surfaceStress:{snakes:18,physicalPoints:240,drawPoints:spine.length,p95Ms:+costs[Math.floor(costs.length*.95)].toFixed(2)}};
    })()`,
      sessionId,
    );
    const gallery = await evaluate("window.surfaceGallery", sessionId);
    const galleryPath = join(tmpdir(), "neon-skin-surfaces.png");
    await writeFile(galleryPath, Buffer.from(gallery.split(",")[1], "base64"));
    console.log("Render diagnostics:", JSON.stringify(report));
    console.log("Skin preview:", galleryPath);
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real browser joins the authority, renders gameplay, sends right-button boost and release, suppresses the context menu, and reports no JavaScript exceptions.",
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
