# W142 — application size and memory

## Changes

- `src/editor/livePreview/widgets/Math.ts`: `renderedMath` became an LRU cache
  capped at 256 formulas. It used to be a map that lived until the process
  exited, with no limit at all.
- `src/App.svelte`: `SettingsWindow.svelte` is imported dynamically, only when
  the settings are opened. `Ctrl+,` and File → Settings were checked in the
  browser.
- `tests/wiring/wiring.test.ts` counts dynamic Svelte imports as edges of the
  mount graph; `closeProtocol.test.ts` waits for the lazy import.

## Measurements

Every browser measurement is reproduced by `node qa/measure-memory.mjs` with
Vite and Edge running as described in `qa/browser/README.md`; the results are
in `w142-memory-before.json` and `w142-memory-after.json`. The heap is measured
through CDP after `HeapProfiler.collectGarbage`, so the comparison uses the
browser heap rather than the volatile working set of the processes.

| What was measured | Tool | Before | After | Evidence |
|---|---|---:|---:|---|
| Main JS chunk | `node qa/measure-build.mjs` | 558352 B | 538570 B | `w142-build-report-before.json`, `w142-build-report-after.json` |
| Isolated effect of the lazy SettingsWindow | the same Rollup report | 558465 B | 538570 B | `w142-build-report-before-settings.json`, `w142-build-report-after-settings.json` |
| Browser heap at startup | CDP | 9.96 MB | 9.88 MB | `w142-memory-*.json` |
| A 1 MiB document | CDP | 37.44 MB | 30.69 MB | `w142-memory-*.json` |
| 10 tabs | CDP | 38.18 MB | 31.42 MB | `w142-memory-*.json` |
| After closing 9 tabs | CDP | 37.87 MB | 31.11 MB | `w142-memory-*.json` |
| 500 edits / 500 unique formulas | CDP | 37.81 MB | 31.05 MB | `w142-memory-*.json` |
| 200 cycles of opening and closing a tab | CDP | 39.22 MB | 32.45 MB | `w142-memory-*.json` |

Before and after for the heap is the same scenario from the script. The drop of
roughly 6.76 MiB after the document and after the 200 cycles confirms the
effect of capping the formula cache; loading the settings dynamically shrinks
the startup chunk on top of that, although the memory scenario never opens the
settings.

The ten heaviest modules in the final main chunk:

| Module | Size |
|---|---:|
| `@lezer/javascript` | 81155 B |
| `@lezer/markdown` | 59346 B |
| `@codemirror/commands` | 46356 B |
| `src/App.svelte` | 40122 B |
| `src/editor/livePreview/tables.ts` | 38185 B |
| `@codemirror/language-data` | 31614 B |
| `src/state/actions.ts` | 30254 B |
| `@codemirror/search` | 27755 B |
| `src/editor/keymap.ts` | 23298 B |
| `@codemirror/lang-html` | 22334 B |

`SettingsWindow` is now a separate chunk of 20631 B of JS and 6.90 KB of CSS.
KaTeX stays a separate chunk of 260.83 KB. Rollup warns that some of the
language-data dynamic imports cannot be split out: the languages also arrive
statically through `createEditor.ts` and other adapters; those files were
outside the bounds of this task, so that risky change was not made.

## Native processes

`measure-memory.mjs` records every matching `marknote.exe` and `msedgewebview2`
process and stops none of them. A trustworthy native A/B measurement was not
accepted: other WebView2 processes were already running before and during the
check, and a `marknote.exe` appeared during the final cycle. At the start there
were 29 WebView2 processes (~717 MiB working set), and by cycle 200 there were
1 MarkNote (~26.8 MiB) and 37 WebView2 (~1.15 GiB). Mixing those processes
makes any conclusion about native memory growth unreliable, so the owner's
process was not closed; a clean run means repeating the same script after
stopping only the outside instances.

## Checks

- `npx tsc --noEmit` — clean.
- `npx vitest run --poolOptions.threads.maxThreads=3` — 50 files, 429 tests,
  all passed.
- `npm run build` — succeeded; the Rollup warnings are only about the
  ineffective dynamic language-data imports and the size of the main chunk.
- A live browser check: Ctrl+, opened Settings after the lazy import;
  screenshot: `qa/shots/w142-settings.png`.

## Looked at, and deliberately left alone

- `tabEditorStates` already drops the state when a tab is closed; an extra
  change would have had no measurable grounds.
- `imageResolver` clears its document cache when the path changes, and removed
  data URLs do not accumulate in an additional global cache.
- The subscriptions in App/MenuBar/FindPanel/ContextMenu have cleanup
  functions; changing them without a reproducible leak signal would have been
  gratuitous.
- KaTeX and the languages are already split into chunks; KaTeX was not
  duplicated in the main chunk.
