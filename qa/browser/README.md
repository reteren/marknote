# Проверка правок в браузере, а не в окне владельца

Программа поднимается обычным `vite` и открывается в Edge с включённой
отладкой (CDP). Это даёт то, чего не даёт запуск `marknote.exe`:

- можно печатать, нажимать мышью, наводить курсор и снимать снимки;
- не мешает окну MarkNote, открытому владельцем: правило «один запуск» тут ни
  при чём, никого закрывать не нужно;
- видно ошибки страницы, а не только внешний вид (`window.__ERR`).

Команды Tauri в браузере не работают: `tauri-mock.js` подставляет заглушку —
пустой документ Markdown, список форматов, пустой список недавних файлов.
Всё, что упирается в Rust (открытие файла, сохранение, окна), так не
проверить: для этого нужен запуск `marknote.exe` (`qa/Run-TableCdp.ps1`).

## Запуск

```powershell
Start-Job { Set-Location C:\marknote; npx vite --port 1420 --strictPort }
Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  -ArgumentList "--headless=new", "--remote-debugging-port=9555",
  "--user-data-dir=$env:TEMP\marknote-edge", "--window-size=1000,800",
  "http://localhost:1420/"
node qa\browser\cdp.mjs шаги.json
```

## Шаги

Файл шагов — массив объектов, по одному действию в каждом:

| Шаг | Что делает |
| --- | --- |
| `{"init": "qa/browser/tauri-mock.js"}` | подставить заглушку Tauri (перед `reload`) |
| `{"reload": true}` | перезагрузить страницу |
| `{"click": [x, y]}`, `{"button": "right"}` | настоящий щелчок мышью |
| `{"clickText": "Bold"}`, `{"hover": true}` | щелчок или наведение по подписи кнопки |
| `{"type": "текст"}` | ввод текста |
| `{"key": "=", "code": "Equal", "vk": 187, "text": "="}` | нажатие клавиши; `mods`: 2 — Ctrl, 8 — Shift |
| `{"eval": "js"}` | выполнить код на странице и напечатать результат |
| `{"shot": "путь.png"}` | снимок окна |
| `{"wait": 300}` | пауза в миллисекундах |

Подменю открывается наведением, поэтому у пункта-родителя нужен
`"hover": true`, а щелчок — уже по самому пункту.

Пример — проверка курсора после «Bold» из контекстного меню:

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
