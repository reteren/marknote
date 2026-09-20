import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import http from "node:http";
import WebSocket from "ws";

const cdpPort = Number(process.env.W140_CDP_PORT ?? 9557);
const vitePort = Number(process.env.W140_VITE_PORT ?? 1423);
const runs = Number(process.env.W140_RUNS ?? 3);
const output = process.env.W140_OUTPUT ?? "qa/w140-baseline.json";
const profile = process.env.W140_PROFILE ?? "plain-list";
const disablePreview = process.env.W140_DISABLE_PREVIEW === "1";
const disableSpellcheckSkip = process.env.W140_DISABLE_SPELLCHECK_SKIP === "1";
const mockSource = await readFile("qa/browser/tauri-mock.js", "utf8");

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => resolve(JSON.parse(body)));
    }).on("error", reject);
  });
}

const targets = await getJson(`http://127.0.0.1:${cdpPort}/json`);
const page = targets.find((item) => item.type === "page" && item.url.startsWith(`http://localhost:${vitePort}`));
if (!page) throw new Error(`No W140 page at http://localhost:${vitePort}`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.on("open", resolve);
  socket.on("error", reject);
});

let nextId = 0;
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id !== id) return;
      socket.off("message", onMessage);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    };
    socket.on("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await call("Page.enable");
await call("Page.addScriptToEvaluateOnNewDocument", { source: mockSource });

const sizes = [10 * 1024, 200 * 1024, 1024 * 1024, 5 * 1024 * 1024];
const labels = new Map(sizes.map((size) => [size, `${Math.round(size / 1024)}KB`]));

function makeDocument(size) {
  const chunk = profile === "nested-list"
    ? "- benchmark item with enough Markdown text to exercise the parser\n    - nested benchmark item\n"
    : "- benchmark item with enough Markdown text to exercise the parser\n";
  let document = "# W140 benchmark\n\n";
  while (document.length + chunk.length <= size) document += chunk;
  return document + "x".repeat(Math.max(0, size - document.length));
}

async function setFixture(document) {
  const format = {
    id: "markdown",
    label: "Markdown",
    defaultExtension: "md",
    extensions: ["md"],
    editable: true,
    creatable: true,
    livePreview: true,
    autosave: true,
    lossy: false,
    syntaxMode: null,
    template: "",
  };
  const source = `(() => {
    window.__W140_DOC = ${JSON.stringify(document)};
    window.__W140_DISABLE_PREVIEW = ${disablePreview};
    window.__W140_DISABLE_SPELLCHECK_SKIP = ${disableSpellcheckSkip};
    const internals = window.__TAURI_INTERNALS__;
    const originalInvoke = internals.invoke;
    let pending = true;
    internals.invoke = async (command, args) => {
      if (command === "take_pending_file" && pending) {
        pending = false;
        return "C:\\\\w140-benchmark.md";
      }
      if (command === "open_file") {
        return {
          path: "C:\\\\w140-benchmark.md",
          text: window.__W140_DOC,
          encoding: "utf-8",
          bom: false,
          lineEnding: "lf",
          format: ${JSON.stringify(format)},
          readonly: false,
        };
      }
      if (command === "get_settings") {
        const settings = await originalInvoke(command, args);
        if (window.__W140_DISABLE_PREVIEW) settings.livePreview.enabled = false;
        if (window.__W140_DISABLE_SPELLCHECK_SKIP) settings.spellcheck.skipCodeFormulaLinks = false;
        return settings;
      }
      return originalInvoke(command, args);
    };
  })();`;
  await call("Page.addScriptToEvaluateOnNewDocument", { source });
}

async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Runtime evaluation failed");
  return result?.result?.value;
}

async function waitForReady(timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await evaluate(`(() => {
      const shell = document.querySelector('.app-shell');
      const editor = document.querySelector('.cm-editor');
      return Boolean(shell && editor && !shell.hasAttribute('inert') && document.querySelector('.cm-line'));
    })()`);
    if (ready) {
      await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      return Date.now() - started;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the editor");
}

async function measureInput() {
  await evaluate("document.querySelector('.cm-content')?.focus()");
  const started = performance.now();
  await call("Input.insertText", { text: "x" });
  return performance.now() - started;
}

async function measureArrow() {
  await evaluate("document.querySelector('.cm-content')?.focus()");
  const started = performance.now();
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
  return performance.now() - started;
}

async function measureScroll() {
  await evaluate("document.querySelector('.cm-scroller')?.scrollTo(0, 0)");
  await evaluate("new Promise((resolve) => requestAnimationFrame(resolve))");
  const started = performance.now();
  await call("Input.dispatchMouseEvent", { type: "mouseWheel", x: 500, y: 350, deltaY: 600, deltaX: 0 });
  await evaluate("new Promise((resolve) => requestAnimationFrame(resolve))");
  return performance.now() - started;
}

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  return {
    samples: values.map((value) => Number(value.toFixed(3))),
    medianMs: Number(percentile(0.5).toFixed(3)),
    p95Ms: Number(percentile(0.95).toFixed(3)),
    maxMs: Number(sorted.at(-1).toFixed(3)),
  };
}

const results = [];
for (const size of sizes) {
  const document = makeDocument(size);
  const row = { bytes: size, label: labels.get(size), documentLength: document.length, runs: [] };
  for (let run = 0; run < runs; run += 1) {
    await setFixture(document);
    const reloadStarted = performance.now();
    await call("Page.reload");
    const openMs = performance.now() - reloadStarted;
    const readyPollingMs = await waitForReady();
    const firstRenderMs = performance.now() - reloadStarted;
    const arrows = [];
    for (let sample = 0; sample < 5; sample += 1) arrows.push(await measureArrow());
    const input = [];
    const scroll = [];
    for (let sample = 0; sample < 5; sample += 1) {
      input.push(await measureInput());
      scroll.push(await measureScroll());
    }
    row.runs.push({ openCommandMs: Number(openMs.toFixed(3)), firstRenderMs: Number(firstRenderMs.toFixed(3)), readyPollingMs, input: summary(input), arrow: summary(arrows), scroll: summary(scroll) });
  }
  results.push(row);
  console.log(JSON.stringify(row));
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), cdpPort, vitePort, runs, profile, disablePreview, disableSpellcheckSkip, results }, null, 2));
console.log(`Wrote ${output}`);
socket.close();
