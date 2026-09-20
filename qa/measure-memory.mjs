// Measure browser heap and Windows process memory through a repeatable CDP run.
// Start qa/browser as documented in qa/browser/README.md, then run:
//   node qa/measure-memory.mjs
// Optional: MARKNOTE_CDP_PORT=9555 MARKNOTE_VITE_PORT=1420
// Results are written to qa/w142-memory.json; no process is started or stopped.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const cdpPort = Number(process.env.MARKNOTE_CDP_PORT ?? 9555);
const vitePort = Number(process.env.MARKNOTE_VITE_PORT ?? 1420);
const root = resolve(import.meta.dirname, "..");
const outputPath = resolve(root, "qa/w142-memory.json");

function processMemory() {
  const script = `$items = @(Get-Process marknote,msedgewebview2 -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ id=$_.Id; name=$_.ProcessName; workingSetBytes=$_.WorkingSet64; privateBytes=$_.PrivateMemorySize64 } }); $items | ConvertTo-Json -Compress`;
  try {
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();
    const items = raw ? (JSON.parse(raw) instanceof Array ? JSON.parse(raw) : [JSON.parse(raw)]) : [];
    return {
      processes: items,
      totals: items.reduce((totals, item) => ({
        workingSetBytes: totals.workingSetBytes + Number(item.workingSetBytes || 0),
        privateBytes: totals.privateBytes + Number(item.privateBytes || 0),
      }), { workingSetBytes: 0, privateBytes: 0 }),
    };
  } catch (error) {
    return { error: String(error), processes: [], totals: { workingSetBytes: null, privateBytes: null } };
  }
}

const pages = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
const page = pages.find((item) => item.type === "page" && item.url.startsWith(`http://localhost:${vitePort}`));
if (!page) throw new Error(`No page at http://localhost:${vitePort} on CDP ${cdpPort}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolvePromise, reject) => {
  ws.addEventListener("open", resolvePromise, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
let nextId = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const callback = pending.get(message.id);
  if (callback) {
    pending.delete(message.id);
    callback(message);
  }
});
function send(method, params = {}) {
  return new Promise((resolvePromise, reject) => {
    const id = ++nextId;
    pending.set(id, (message) => message.error ? reject(new Error(message.error.message)) : resolvePromise(message.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Runtime.evaluate failed");
  return result.result?.value;
}
async function wait(ms) { await new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }
async function clickSelector(selector, index = 0) {
  const point = await evaluate(`(() => { const node = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!node || !node.offsetParent) return null; const rect = node.getBoundingClientRect(); return [rect.left + rect.width / 2, rect.top + rect.height / 2]; })()`);
  if (!point) throw new Error(`Visible element not found: ${selector}[${index}]`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point[0], y: point[1] });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point[0], y: point[1], button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point[0], y: point[1], button: "left", clickCount: 1 });
}
async function insertText(text) { await send("Input.insertText", { text }); }
async function sample(label, extra = {}) {
  await send("HeapProfiler.collectGarbage");
  const heap = await send("Runtime.getHeapUsage");
  const status = String(await evaluate("document.querySelector('.status-bar')?.textContent ?? ''"));
  const chars = status.match(/([0-9][0-9, .]*)\s+chars?\b/u)?.[1]?.replace(/[^0-9]/gu, "");
  const sample = {
    label,
    timestamp: new Date().toISOString(),
    browserHeap: { usedBytes: heap.usedSize, totalBytes: heap.totalSize, limitBytes: heap.heapSizeLimit },
    processMemory: processMemory(),
    tabs: Number(await evaluate("document.querySelectorAll('[role=tab]').length")),
    documentBytes: chars ? Number(chars) : null,
    status,
    ...extra,
  };
  console.log(JSON.stringify(sample));
  return sample;
}

await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(resolve(root, "qa/browser/tauri-mock.js"), "utf8") });
await send("Page.reload");
await wait(2500);
const samples = [];
samples.push(await sample("startup"));

await clickSelector(".start-screen button", 0);
await wait(600);
await clickSelector(".cm-content");
// Chromium's Input.insertText silently truncates very large payloads, so use
// 128 real editor transactions of 8 KiB instead of claiming a 1 MiB input.
for (let index = 0; index < 128; index += 1) {
  await insertText("x".repeat(8192));
  await wait(50);
}
await wait(1500);
samples.push(await sample("one-megabyte-document"));

for (let index = 0; index < 9; index += 1) {
  await clickSelector(".tab-new-btn");
  await wait(35);
}
for (let index = 0; index < 10; index += 1) {
  await clickSelector("[role=tab]", index);
  await wait(20);
}
samples.push(await sample("ten-tabs"));

for (let index = 0; index < 9; index += 1) {
  await clickSelector(".tab.active .tab-close-btn");
  await wait(35);
}
samples.push(await sample("tabs-closed"));

await clickSelector(".cm-content");
for (let index = 0; index < 500; index += 1) {
  await insertText(`\n$${index}^2$`);
}
await wait(2500);
samples.push(await sample("five-hundred-edits", { edits: 500, uniqueFormulas: 500 }));

await evaluate(`(async () => {
  for (let index = 0; index < 200; index += 1) {
    document.querySelector('.tab-new-btn')?.click();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    document.querySelector('.tab.active .tab-close-btn')?.click();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  return document.querySelectorAll('[role=tab]').length;
})()`);
await wait(500);
samples.push(await sample("two-hundred-open-close-cycles", { cycles: 200 }));

const report = {
  generatedAt: new Date().toISOString(),
  cdpPort,
  vitePort,
  note: "Process samples include every matching process currently running; stop unrelated MarkNote/WebView2 instances before comparing runs.",
  samples,
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(outputPath);
ws.close();
