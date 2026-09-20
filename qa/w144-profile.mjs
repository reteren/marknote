import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import http from "node:http";
import WebSocket from "ws";

const cdpPort = Number(process.env.W144_CDP_PORT ?? 9558);
const vitePort = Number(process.env.W144_VITE_PORT ?? 1424);
const runs = Number(process.env.W144_RUNS ?? 5);
const output = process.env.W144_OUTPUT ?? "qa/w144-profile.json";
const mode = process.env.W144_MODE ?? "normal";
const cpuProfile = process.env.W144_CPU === "1";
const requestedSize = process.env.W144_SIZE;
const warmupMs = Number(process.env.W144_WARMUP_MS ?? 1000);
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
const page = targets.find((item) => item.type === "page" && item.url.startsWith(`http://localhost:${vitePort}`))
  ?? targets.find((item) => item.type === "page");
if (!page) throw new Error(`No W144 page at CDP ${cdpPort}`);

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
if (cpuProfile) await call("Profiler.enable");
await call("Page.addScriptToEvaluateOnNewDocument", { source: mockSource });
if (!page.url.startsWith(`http://localhost:${vitePort}`)) await call("Page.navigate", { url: `http://localhost:${vitePort}/` });

function makeDocument(size) {
  const chunk = "- benchmark item with enough Markdown text to exercise the parser\n";
  let document = "# W144 benchmark\n\n";
  while (document.length + chunk.length <= size) document += chunk;
  return document + "x".repeat(Math.max(0, size - document.length));
}

async function setFixture(document) {
  const markdown = mode !== "plain-format";
  const format = {
    id: markdown ? "markdown" : "text",
    label: markdown ? "Markdown" : "Text",
    defaultExtension: markdown ? "md" : "txt",
    extensions: markdown ? ["md"] : ["txt"],
    editable: true,
    creatable: true,
    livePreview: markdown,
    autosave: true,
    lossy: false,
    syntaxMode: null,
    template: "",
  };
  const source = `(() => {
    window.__W144_DOC = ${JSON.stringify(document)};
    window.__marknoteProfile__ = { entries: [] };
    window.__marknoteEditorView__ = null;
    const internals = window.__TAURI_INTERNALS__;
    const originalInvoke = internals.invoke;
    let pending = true;
    internals.invoke = async (command, args) => {
      if (command === "take_pending_file" && pending) {
        pending = false;
        return "C:\\\\w144-profile.md";
      }
      if (command === "open_file") {
        return {
          path: "C:\\\\w144-profile.md",
          text: window.__W144_DOC,
          encoding: "utf-8",
          bom: false,
          lineEnding: "lf",
          format: ${JSON.stringify(format)},
          readonly: false,
        };
      }
      if (command === "get_settings") {
        const settings = await originalInvoke(command, args);
        if (${JSON.stringify(mode)} === "no-preview") settings.livePreview.enabled = false;
        if (${JSON.stringify(mode)} === "normal") {
          settings.livePreview.enabled = true;
          settings.livePreview.disableAboveBytes = 5 * 1024 * 1024;
          settings.spellcheck.skipCodeFormulaLinks = true;
        }
        if (${JSON.stringify(mode)} === "high-limit") {
          settings.livePreview.enabled = true;
          settings.livePreview.disableAboveBytes = 20 * 1024 * 1024;
        }
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

async function waitForReady(expectedLength, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await evaluate(`(() => {
      const shell = document.querySelector('.app-shell');
      const editor = document.querySelector('.cm-editor');
      return Boolean(shell && editor && window.__marknoteEditorView__ && window.__marknoteEditorView__.state.doc.length === ${expectedLength} && !shell.hasAttribute('inert') && document.querySelector('.cm-line'));
    })()`);
    if (ready) {
      await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the editor");
}

async function installDispatchProfile() {
  const installed = await evaluate(`(() => {
    const view = window.__marknoteEditorView__;
    const sink = window.__marknoteProfile__;
    if (!view || !sink) return false;
    const original = view.dispatch.bind(view);
    view.dispatch = (...specs) => {
      const started = performance.now();
      try { return original(...specs); }
      finally { sink.entries.push({ name: "transaction.apply", duration: performance.now() - started }); }
    };
    return true;
  })()`);
  if (!installed) throw new Error("Editor view was not exposed for W144 profiling");
}

async function clearProfile() {
  await evaluate("window.__marknoteProfile__.entries = []");
}

async function measureInput() {
  await evaluate("document.querySelector('.cm-content')?.focus()");
  await clearProfile();
  if (cpuProfile) await call("Profiler.start", { samplingInterval: 1000 });
  const started = performance.now();
  await call("Input.insertText", { text: "x" });
  const dispatchDone = performance.now();
  await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const frameDone = performance.now();
  const entries = await evaluate("JSON.stringify(window.__marknoteProfile__.entries)");
  const cpu = cpuProfile ? summarizeCpu((await call("Profiler.stop")).profile) : undefined;
  return {
    cdpDispatchMs: dispatchDone - started,
    cdpToFrameMs: frameDone - started,
    postDispatchFrameMs: frameDone - dispatchDone,
    entries: JSON.parse(entries),
    cpu,
  };
}

function summarizeCpu(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const totals = new Map();
  for (let index = 0; index < profile.samples.length; index += 1) {
    const frame = nodes.get(profile.samples[index]);
    if (!frame) continue;
    const key = `${frame.functionName || "(anonymous)"} @ ${frame.url || "native"}:${frame.lineNumber ?? 0}`;
    totals.set(key, (totals.get(key) ?? 0) + (profile.timeDeltas?.[index] ?? 0) / 1000);
  }
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 40)
    .map(([frame, milliseconds]) => ({ frame, milliseconds }));
}

function summarize(samples) {
  const names = new Set(samples.flatMap((sample) => sample.entries.map((entry) => entry.name)));
  const values = (name) => samples.flatMap((sample) => sample.entries.filter((entry) => entry.name === name).map((entry) => entry.duration));
  const median = (numbers) => {
    const sorted = [...numbers].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  };
  return {
    cdpDispatchMs: median(samples.map((sample) => sample.cdpDispatchMs)),
    cdpToFrameMs: median(samples.map((sample) => sample.cdpToFrameMs)),
    postDispatchFrameMs: median(samples.map((sample) => sample.postDispatchFrameMs)),
    phases: Object.fromEntries([...names].sort().map((name) => [name, median(values(name))])),
    raw: samples,
  };
}

const sizes = requestedSize === "1" ? [1024 * 1024] : requestedSize === "5" ? [5 * 1024 * 1024] : [1024 * 1024, 5 * 1024 * 1024];
const results = [];
for (const size of sizes) {
  const document = makeDocument(size);
  const samples = [];
  for (let run = 0; run < runs; run += 1) {
    await setFixture(document);
    await call("Page.reload");
    await waitForReady(document.length);
    if (warmupMs > 0) await new Promise((resolve) => setTimeout(resolve, warmupMs));
    await installDispatchProfile();
    samples.push(await measureInput());
  }
  const row = { bytes: size, label: `${Math.round(size / 1024)}KB`, profile: summarize(samples) };
  results.push(row);
  console.log(JSON.stringify(row));
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), cdpPort, vitePort, runs, mode, results }, null, 2));
console.log(`Wrote ${output}`);
socket.close();
