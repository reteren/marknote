#!/usr/bin/env node
/**
 * CDP smoke-check helper for live-preview table controls.
 *
 * Start the app with qa/Run-TableCdp.ps1, then run:
 *   $env:W128_CDP_PORT = '9445'
 *   node qa/cdp-table-check.mjs inspect
 *   node qa/cdp-table-check.mjs screenshot qa/shots/w129-table.png
 *   node qa/cdp-table-check.mjs mouse mouseMoved 333 180
 *
 * The launcher isolates settings with MARKNOTE_CONFIG_DIR and checks for a
 * foreign MarkNote process via Assert-NoForeignMarkNote.ps1 before launch.
 */
import { writeFile } from "node:fs/promises";
import http from "node:http";
import WebSocket from "ws";

if (!process.env.MARKNOTE_CONFIG_DIR) {
  throw new Error("MARKNOTE_CONFIG_DIR must point to a temporary QA settings directory");
}

const port = Number(process.env.W128_CDP_PORT ?? 9445);
const operation = process.argv[2] ?? "inspect";

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => resolve(JSON.parse(body)));
    }).on("error", reject);
  });
}

const pages = await getJson("http://127.0.0.1:" + port + "/json/list");
const page = pages.find((item) => item.type === "page");
if (!page) throw new Error("No CDP page found");

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

const inspectExpression = `JSON.stringify({
  title: document.title,
  text: document.querySelector('.cm-content')?.textContent ?? '',
  lines: [...document.querySelectorAll('.cm-line')].map((element) => ({
    className: element.className,
    text: element.textContent,
    rect: (() => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })(),
  })),
  controls: [...document.querySelectorAll('.cm-marknote-table-add-row-bar,.cm-marknote-table-add-col-bar,.cm-marknote-table-row-controls,.cm-marknote-table-row-handle,.cm-marknote-table-col-hitarea,.cm-marknote-table-col-handle,.cm-marknote-table-selection-outline')].map((element) => ({
    className: element.className,
    hidden: element.hidden,
    style: element.getAttribute('style'),
    opacity: getComputedStyle(element).opacity,
    pointerEvents: getComputedStyle(element).pointerEvents,
    cursor: getComputedStyle(element).cursor,
    rect: (() => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })(),
  })),
  cells: [...document.querySelectorAll('.cm-marknote-table-cell')].map((cell) => ({
    className: cell.className,
    rect: (() => { const r = cell.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })(),
    background: getComputedStyle(cell).backgroundColor,
    borderLeft: getComputedStyle(cell).borderLeft,
    borderRight: getComputedStyle(cell).borderRight,
    borderTop: getComputedStyle(cell).borderTop,
    borderBottom: getComputedStyle(cell).borderBottom,
    boxShadow: getComputedStyle(cell).boxShadow,
  })),
})`;

if (operation === "inspect") {
  const result = await call("Runtime.evaluate", { expression: inspectExpression, returnByValue: true });
  console.log(result.result?.value ?? "");
} else if (operation === "screenshot") {
  const output = process.argv[3];
  if (!output) throw new Error("screenshot requires an output path");
  const result = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(output, Buffer.from(result.data, "base64"));
  console.log(output);
} else if (operation === "mouse") {
  const type = process.argv[3];
  const x = Number(process.argv[4]);
  const y = Number(process.argv[5]);
  await call("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: "left",
    clickCount: type === "mousePressed" ? 1 : 0,
  });
  console.log(JSON.stringify({ type, x, y }));
} else if (operation === "eval") {
  const expression = process.argv.slice(3).join(" ");
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(result.result?.value ?? null));
} else {
  throw new Error("Unknown operation: " + operation);
}

socket.close();
