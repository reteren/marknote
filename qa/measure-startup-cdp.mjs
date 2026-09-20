// Probe the real WebView2 page until MarkNote's editable CodeMirror surface exists.
// Usage: node qa/measure-startup-cdp.mjs --port 9610 --timeout-ms 30000

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const port = Number(args.get("--port") ?? 9610);
const timeoutMs = Number(args.get("--timeout-ms") ?? 30000);
const expectedText = args.get("--expected-text") ?? "";
const deadline = Date.now() + timeoutMs;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let page;
while (Date.now() < deadline) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    page = targets.find((target) => target.type === "page" && target.url.startsWith("http://tauri.localhost"));
    if (page) break;
  } catch {
    // The DevTools endpoint appears after the WebView2 environment is ready.
  }
  await sleep(25);
}
if (!page) {
  console.error(JSON.stringify({ error: "CDP target did not appear", port, timeoutMs }));
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
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
  const response = await send("Runtime.evaluate", { expression, returnByValue: true });
  return response.result?.result?.value;
};

let state;
while (Date.now() < deadline) {
  state = await evaluate(`(() => {
    const content = document.querySelector(".cm-content");
    return {
      readyState: document.readyState,
      hasEditor: Boolean(content),
      editable: Boolean(content?.isContentEditable),
      focused: document.activeElement === content,
      hasExpectedText: !${JSON.stringify(expectedText)} || Boolean(content?.textContent?.includes(${JSON.stringify(expectedText)})),
    };
  })()`);
  if (state?.readyState === "complete" && state.hasEditor && state.editable && state.hasExpectedText) break;
  await sleep(25);
}
const ready = state?.readyState === "complete" && state.hasEditor && state.editable && state.hasExpectedText;
console.log(JSON.stringify({ ready, pageUrl: page.url, state }));
ws.close();
if (!ready) process.exit(3);
