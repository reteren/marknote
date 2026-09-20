# Test changes in the browser, not in the owner's window

The app is started with ordinary `vite` and opened in Edge with debugging
(CDP) enabled. This provides capabilities that launching `marknote.exe` does not:

- you can type, click, hover, and take screenshots;
- it does not interfere with the owner's open MarkNote window: the single-instance
  rule does not apply, so nothing needs to be closed;
- page errors are visible, not just the appearance (`window.__ERR`).

Tauri commands do not work in the browser: `tauri-mock.js` supplies a stub with
an empty Markdown document, a format list, and an empty recent-files list.
Anything involving Rust (opening files, saving, windows) cannot be tested this
way; launch `marknote.exe` for those checks (`qa/Run-TableCdp.ps1`).

## Run

```powershell
Start-Job { Set-Location C:\marknote; npx vite --port 1420 --strictPort }
Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  -ArgumentList "--headless=new", "--remote-debugging-port=9555",
  "--user-data-dir=$env:TEMP\marknote-edge", "--window-size=1000,800",
  "http://localhost:1420/"
node qa\browser\cdp.mjs steps.json
```

## Steps

The steps file is an array of objects, one action per object:

| Step | Action |
| --- | --- |
| `{"init": "qa/browser/tauri-mock.js"}` | install the Tauri stub (before `reload`) |
| `{"reload": true}` | reload the page |
| `{"click": [x, y]}`, `{"button": "right"}` | real mouse click |
| `{"clickText": "Bold"}`, `{"hover": true}` | click or hover a button label |
| `{"type": "text"}` | type text |
| `{"key": "=", "code": "Equal", "vk": 187, "text": "="}` | press a key; `mods`: 2 is Ctrl, 8 is Shift |
| `{"eval": "js"}` | execute code on the page and print the result |
| `{"shot": "path.png"}` | take a window screenshot |
| `{"wait": 300}` | pause in milliseconds |

Submenus open on hover, so the parent item needs `"hover": true`; click the
actual submenu item afterwards.

Example: checking the cursor after `Bold` in the context menu:

```json
[
 {"init": "qa/browser/tauri-mock.js"},
 {"reload": true},
 {"click": [340, 387]}, {"wait": 900},
 {"click": [400, 150]},
 {"type": "hello world"},
 {"key": "Home", "code": "Home", "vk": 36, "mods": 8},
 {"click": [110, 137], "button": "right"}, {"wait": 400},
 {"clickText": "Formatting", "hover": true}, {"wait": 350},
 {"clickText": "Bold"}, {"wait": 500},
 {"eval": "document.querySelector('.status-bar')?.textContent"}
]
```
