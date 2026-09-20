#!/usr/bin/env node
/**
 * W146 release acceptance helper. Connects to a release MarkNote page over CDP
 * and performs real keyboard/mouse input without touching the installed app.
 * Usage: W146_CDP_PORT=9559 node qa/w146-release-cdp.mjs snapshot label
 *         ... press Ctrl+f | clickText File | clickSelector '.foo' | type text
 *         ... eval 'document.title' | screenshot label
 */
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import WebSocket from "ws";

process.on("uncaughtException", (error) => { console.error(error.stack ?? error); process.exit(1); });
process.on("unhandledRejection", (error) => { console.error(error?.stack ?? error); process.exit(1); });

const port = Number(process.env.W146_CDP_PORT ?? 9559);
const shotDir = process.env.W146_SHOTS_DIR ?? "qa/shots";
mkdirSync(shotDir, { recursive: true });

const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => resolve(JSON.parse(body)));
  }).on("error", reject);
});
const pages = await getJson(`http://127.0.0.1:${port}/json/list`);
const page = pages.find((item) => item.type === "page");
if (!page) throw new Error("No CDP page found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});
let nextId = 0;
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const handler = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id !== id) return;
      socket.off("message", handler);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    };
    socket.on("message", handler);
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Runtime.evaluate failed");
  return result.result?.value;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const keyNames = { "+": "Equal", "=": "Equal", "0": "Digit0", "1": "Digit1", "2": "Digit2", "3": "Digit3", "4": "Digit4", "5": "Digit5", "6": "Digit6", "7": "Digit7", "8": "Digit8", "9": "Digit9", "f": "KeyF", "b": "KeyB", "i": "KeyI", "s": "KeyS", "z": "KeyZ", "y": "KeyY", "p": "KeyP", "a": "KeyA", "g": "KeyG", "t": "KeyT", "Escape": "Escape", "Enter": "Enter", "Tab": "Tab", "Backspace": "Backspace", "Delete": "Delete", "ArrowDown": "ArrowDown", "ArrowUp": "ArrowUp" };
const modifierBits = { Ctrl: 2, Control: 2, Alt: 1, Shift: 8, Meta: 4, Command: 4 };
async function press(spec) {
  const parts = spec.split("+");
  const key = parts.pop();
  const modifiers = parts.reduce((bits, part) => bits | (modifierBits[part] ?? 0), 0);
  const value = key.length === 1 ? key : "";
  const base = { key: key === " " ? " " : key, code: keyNames[key] ?? key, modifiers };
  // Do not send a text payload for modified shortcuts: Chromium otherwise
  // inserts the payload in addition to dispatching the command.
  if (key.length === 1 && modifiers === 0) base.text = value;
  await call("Input.dispatchKeyEvent", { type: "keyDown", ...base });
  await call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
async function clickAt(point) {
  if (!point) throw new Error("Target not found or not visible");
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point[0], y: point[1] });
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: point[0], y: point[1], button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point[0], y: point[1], button: "left", clickCount: 1 });
}
async function rightClickAt(point) {
  if (!point) throw new Error("Target not found or not visible");
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point[0], y: point[1] });
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: point[0], y: point[1], button: "right", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point[0], y: point[1], button: "right", clickCount: 1 });
}
async function clickText(text) {
  const needle = JSON.stringify(text);
  const point = await evaluate(`(() => { const e = [...document.querySelectorAll('button,[role=button],[role=menuitem],a,label')].find((x) => x.offsetParent && x.textContent.trim().startsWith(${needle})); if (!e) return null; const r=e.getBoundingClientRect(); return [r.left+r.width/2,r.top+r.height/2]; })()`);
  await clickAt(point);
}
async function clickSelector(selector, index = 0) {
  const value = JSON.stringify(selector);
  const point = await evaluate(`(() => { const e = [...document.querySelectorAll(${value})].filter((x) => x.offsetParent)[${index}]; if (!e) return null; const r=e.getBoundingClientRect(); return [r.left+r.width/2,r.top+r.height/2]; })()`);
  await clickAt(point);
}
async function snapshot(label) {
  const data = await evaluate(`JSON.stringify((() => { const visible=(e)=>!!e&&e.offsetParent!==null; const rect=(e)=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}; return { title:document.title, url:location.href, textLength:document.querySelector('.cm-content')?.textContent.length??0, lineCount:document.querySelectorAll('.cm-line').length, contentText:document.querySelector('.cm-content')?.textContent.slice(0,2000)??'', bodyText:document.body.innerText.slice(0,5000), classes:[...document.querySelectorAll('[class]')].filter(visible).map(e=>e.className).filter(x=>typeof x==='string').slice(0,1000), visibleButtons:[...document.querySelectorAll('button,[role=button],[role=menuitem]')].filter(visible).map(e=>e.textContent.trim()).filter(Boolean), dialogs:[...document.querySelectorAll('[role=dialog],dialog')].filter(visible).map(e=>({text:e.innerText,rect:rect(e)})) }; })())`);
  const result = JSON.parse(data);
  const image = await call("Page.captureScreenshot", { format: "png" });
  const path = `${shotDir}/w146-${label}.png`;
  writeFileSync(path, Buffer.from(image.data, "base64"));
  result.screenshot = path;
  console.log(JSON.stringify(result));
}

const op = process.argv[2] ?? "snapshot";
if (op === "snapshot") await snapshot(process.argv[3] ?? "snapshot");
else if (op === "screenshot") {
  const image = await call("Page.captureScreenshot", { format: "png" });
  const path = `${shotDir}/w146-${process.argv[3] ?? "snapshot"}.png`;
  writeFileSync(path, Buffer.from(image.data, "base64"));
  console.log(path);
} else if (op === "press") { await press(process.argv[3]); console.log(JSON.stringify({ pressed: process.argv[3] })); }
else if (op === "type") { await call("Input.insertText", { text: process.argv.slice(3).join(" ") }); console.log(JSON.stringify({ typed: process.argv.slice(3).join(" ") })); }
else if (op === "clickText") { await clickText(process.argv.slice(3).join(" ")); console.log(JSON.stringify({ clicked: process.argv.slice(3).join(" ") })); }
else if (op === "clickSelector") { await clickSelector(process.argv[3], Number(process.argv[4] ?? 0)); console.log(JSON.stringify({ clicked: process.argv[3] })); }
else if (op === "rightClick") { await rightClickAt([Number(process.argv[3]), Number(process.argv[4])]); console.log(JSON.stringify({ rightClicked: [Number(process.argv[3]), Number(process.argv[4])] })); }
else if (op === "eval") { console.log(JSON.stringify(await evaluate(process.argv.slice(3).join(" ")))); }
else if (op === "list") { console.log(JSON.stringify(await evaluate(`JSON.stringify([...document.querySelectorAll('button,[role=button],[role=menuitem],a,label')].filter(e=>e.offsetParent).map(e=>({tag:e.tagName,text:e.textContent.trim(),cls:e.className,rect:(()=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()})))`))); }
else if (op === "inputs") { console.log(JSON.stringify(await evaluate(`JSON.stringify([...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,type:e.type,name:e.name,value:e.value,checked:e.checked,disabled:e.disabled,aria:e.getAttribute('aria-label'),rect:[r.left,r.top,r.width,r.height]}}))`))); }
else if (op === "scrollSelector") { await evaluate(`document.querySelector(${JSON.stringify(process.argv[3])})?.scrollIntoView({block:'center'})`); console.log(JSON.stringify({scrolled:process.argv[3]})); }
else if (op === "scrollInput") { await evaluate(`document.querySelectorAll('input')[${Number(process.argv[3] ?? 0)}]?.scrollIntoView({block:'center'})`); console.log(JSON.stringify({scrolledInput:Number(process.argv[3] ?? 0)})); }
else if (op === "scrollInfo") { console.log(JSON.stringify(await evaluate(`JSON.stringify([...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+2).map(e=>({tag:e.tagName,cls:e.className,top:e.scrollTop,height:e.clientHeight,scrollHeight:e.scrollHeight})).slice(-20))`))); }
else if (op === "scrollSettings") { await evaluate(`(()=>{const e=document.querySelector('.settings-content');if(e)e.scrollTop=Number(${process.argv[3] ?? 0});})()`); console.log(JSON.stringify({scrollSettings:Number(process.argv[3] ?? 0)})); }
else if (op === "scrollEditor") { await evaluate(`(()=>{const e=document.querySelector('.cm-scroller');if(e)e.scrollTop=Number(${process.argv[3] ?? 0});})()`); console.log(JSON.stringify({scrollEditor:Number(process.argv[3] ?? 0)})); }
else if (op === "wait") { await wait(Number(process.argv[3] ?? 500)); console.log(JSON.stringify({ waited: Number(process.argv[3] ?? 500) })); }
else throw new Error(`Unknown operation: ${op}`);
socket.terminate();
process.exit(0);
