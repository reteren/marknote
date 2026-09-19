// Usage: node cdp.mjs steps.json
// steps: [{eval:"js"}, {key:"=", code:"Equal", vk:187, mods:0}, {type:"text"}, {shot:"path.png"}, {wait:ms}, {click:[x,y]}]
import { readFileSync, writeFileSync } from "node:fs";

const list = await (await fetch("http://127.0.0.1:9555/json")).json();
const page = list.find((t) => t.type === "page" && t.url.startsWith("http://localhost:1420"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

const steps = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const s of steps) {
  if (s.eval) {
    const r = await send("Runtime.evaluate", { expression: s.eval, awaitPromise: true, returnByValue: true });
    const v = r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result;
    console.log("eval>", typeof v === "string" ? v : JSON.stringify(v));
  } else if (s.key) {
    const base = { key: s.key, code: s.code, windowsVirtualKeyCode: s.vk, nativeVirtualKeyCode: s.vk, modifiers: s.mods ?? 0 };
    await send("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: s.text });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  } else if (s.type !== undefined) {
    await send("Input.insertText", { text: s.type });
  } else if (s.click) {
    const [x, y] = s.click;
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: s.button ?? "left", clickCount: 1 });
  } else if (s.clickText) {
    // real mouse click on the centre of the first button whose text starts with clickText
    const r = await send("Runtime.evaluate", { returnByValue: true, expression: `(() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().startsWith(${JSON.stringify(s.clickText)}) && b.offsetParent); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()` });
    const pt = r.result?.result?.value;
    console.log("clickText>", s.clickText, pt);
    if (pt) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt[0], y: pt[1] });
      await new Promise((res) => setTimeout(res, 150));
      if (!s.hover) for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: pt[0], y: pt[1], button: "left", clickCount: 1 });
    }
  } else if (s.scrollIntoView) {
    await send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(s.scrollIntoView)})?.scrollIntoView({ block: "center", inline: "nearest" })` });
    await new Promise((res) => setTimeout(res, 100));
  } else if (s.clickSelector) {
    const r = await send("Runtime.evaluate", { returnByValue: true, expression: `(() => { const e = document.querySelectorAll(${JSON.stringify(s.clickSelector)})[${Number.isInteger(s.index) ? s.index : 0}]; if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()` });
    const pt = r.result?.result?.value;
    console.log("clickSelector>", s.clickSelector, pt);
    if (pt) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt[0], y: pt[1] });
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: pt[0], y: pt[1], button: "left", clickCount: 1 });
    }
  } else if (s.move) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: s.move[0], y: s.move[1] });
  } else if (s.wait) {
    await new Promise((r) => setTimeout(r, s.wait));
  } else if (s.shot) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(s.shot, Buffer.from(r.result.data, "base64"));
    console.log("shot>", s.shot);
  } else if (s.init) {
    await send("Page.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(s.init, "utf8") });
  } else if (s.reload) {
    await send("Page.reload", {}); await new Promise((r) => setTimeout(r, 2500));
  }
}
ws.close();
