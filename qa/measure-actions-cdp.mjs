// Measure native "New window" and frontend "New tab" from a running MarkNote.
// The process must already be running with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
// containing --remote-debugging-port=<port>.

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const port = Number(args.get("--port") ?? 9610);
const timeoutMs = Number(args.get("--timeout-ms") ?? 30000);
const filePath = args.get("--file");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const listPages = async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json())
  .filter((target) => target.type === "page" && target.url.startsWith("http://tauri.localhost"));
const deadline = () => Date.now() + timeoutMs;

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP WebSocket did not open")), 5000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const requestId = ++id;
    pending.set(requestId, resolve);
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? "Runtime.evaluate failed");
    return result.result?.result?.value;
  };
  return { ws, send, evaluate };
}

async function waitForEditor(target, expectedText = "") {
  const client = await connect(target);
  const until = deadline();
  let state;
  while (Date.now() < until) {
    state = await client.evaluate(`(() => {
      const content = document.querySelector(".cm-content");
      return {
        readyState: document.readyState,
        editor: Boolean(content?.isContentEditable),
        text: content?.textContent ?? "",
      };
    })()`);
    if (state?.readyState === "complete" && state.editor && (!expectedText || state.text.includes(expectedText))) {
      return { client, state };
    }
    await sleep(25);
  }
  client.ws.close();
  throw new Error(`editor did not become ready: ${JSON.stringify(state)}`);
}

async function clickSelector(client, selector) {
  const point = await client.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return [rect.left + rect.width / 2, rect.top + rect.height / 2];
  })()`);
  if (!point) throw new Error(`selector not found: ${selector}`);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point[0], y: point[1], button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point[0], y: point[1], button: "left", clickCount: 1 });
}

const pagesBefore = await listPages();
if (!pagesBefore.length) throw new Error("no MarkNote CDP page");
const initialTarget = pagesBefore[0];
const initial = (await waitForEditor(initialTarget)).client;

const nativeStart = performance.now();
const openExpression = filePath
  ? `window.__TAURI_INTERNALS__.invoke("open_in_new_window", { path: ${JSON.stringify(filePath)} })`
  : `window.__TAURI_INTERNALS__.invoke("open_new_window", { formatId: "markdown" })`;
await initial.evaluate(openExpression);
const nativeCommandMs = performance.now() - nativeStart;
let newTarget;
while (Date.now() < deadline()) {
  const pages = await listPages();
  newTarget = pages.find((target) => target.id !== initialTarget.id);
  if (newTarget) break;
  await sleep(25);
}
if (!newTarget) throw new Error("new native window target did not appear");
const newWindowStart = performance.now();
const newWindow = (await waitForEditor(newTarget, filePath ? "MarkNote action fixture" : "")).client;
const newWindowEditorMs = performance.now() - nativeStart;
const targetToEditorMs = performance.now() - newWindowStart;

const tabBefore = await initial.evaluate("document.querySelectorAll('.tab').length");
const tabStart = performance.now();
await clickSelector(initial, ".tab-new-btn");
let tabAfter = tabBefore;
while (Date.now() < deadline()) {
  tabAfter = await initial.evaluate("document.querySelectorAll('.tab').length");
  if (tabAfter > tabBefore) break;
  await sleep(10);
}
const tabMs = performance.now() - tabStart;
console.log(JSON.stringify({
  pagesBefore: pagesBefore.length,
  pagesAfter: (await listPages()).length,
  nativeCommandMs: Number(nativeCommandMs.toFixed(1)),
  newWindowEditorMs: Number(newWindowEditorMs.toFixed(1)),
  targetToEditorMs: Number(targetToEditorMs.toFixed(1)),
  tabBefore,
  tabAfter,
  newTabMs: Number(tabMs.toFixed(1)),
}));
initial.ws.close();
newWindow.ws.close();
