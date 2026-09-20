# W51 — audit of exports used by the application (2026-09-15)

`tests/wiring/exports.test.ts` checks exported functions and constants in
`src/editor/**`, `src/state/**`, and `src/ui/**`. It uses the TypeScript checker
to resolve symbols, imports, and re-exports; Svelte `<script>` blocks are
included as virtual TypeScript files, while tests are ignored when searching
for consumers. A finding includes the source file, export name, and three
possible fixes: connect a call, remove the export, or add a documented exception.

`setEditorFormat` was connected in `App.svelte` during the audit: the function
is now called when choosing a format and when saving after a format change. The
special `keeps setEditorFormat called from the application` check passes; this
task did not change the frontend file.

## Unused exports found

| File and exports | Owner in `docs/CONTRACTS.md` | What to check |
| --- | --- | --- |
| `src/editor/keymap.ts`: `marknoteKeymap`, `currentLine` | W3 · Frontend shell | Connect them if they are public entry points; otherwise remove the unused exports. |
| `src/editor/markdownExtensions.ts`: `calloutTypes` | W4 · Markup and preview | The value is declared and exported but not read from `src/`; connect it or remove the export. |
| `src/editor/zoom.ts`: `installZoom`, `zoomIn`, `zoomOut`, `resetZoom`, `getZoom` | Not listed in the ownership table in `CONTRACTS.md` | `App.svelte` implements zoom directly; assign an owner to decide whether to use these functions or remove the dead API. |
| `src/state/formats.svelte.ts`: `formatById`, `formatByExtension` | W3 · Frontend shell | Connect or remove the unused helpers. |
| `src/ui/menuModel.ts`: `buildMenuModel` | W3 · Frontend shell | `MenuBar.svelte` uses `createMenuModel`; connect the alias if needed or remove it. |

Total: **11** exports are unused in `src/`. The check did not fix them or
change files owned by W3/W4. Exceptions are collected in one
`EXPORTED_VALUE_EXCEPTIONS` list: a documented backward-compatibility alias,
keybindings exported for tests/integrations, decoration test facades, and the
KaTeX cache reset. Every entry has its own comment and reason. Types and
interfaces are not part of the value audit; UI components continue to be
checked by a separate mounting test.

## Verification

- `npx vitest run`: **222 passed, 1 intentionally failed**. The only failure
  was the new audit test listing the 11 discovered exports; the other 222 tests,
  including the existing `tests/wiring/wiring.test.ts`, passed.
- `npx tsc --noEmit`: passed.

## Limits of the static check

This is not a runtime call graph: use inside an unreachable branch still counts
as a reference. Dynamic string/reflection calls, computed access, generated
code, and Tauri macro behavior cannot be reliably reduced to static identifiers;
an audit of public Rust functions would be noisy because of `#[tauri::command]`,
trait methods, and callback registration, so it was not added. The Svelte check
analyzes `<script>`; functions used only in markup need a separate Svelte-aware
analysis.

# Wiring report

The check was performed by the static test `tests/wiring/wiring.test.ts` against
the repository snapshot from 2026-09-14. Tests require not only that modules
exist, but also an explicit connection point; error messages include the file
and corrective action.

## Unconnected locations found

1. **`src/App.svelte:358` — medium severity.** The `open-link`/`open-image`
   action calls `window.open(payload, ...)` directly and bypasses
   `safeLinkHref` from `src/editor/livePreview/inline.ts`. Reproduction: pass
   an external `data:`, `file:`, `javascript:`, or other forbidden scheme
   through the context menu; it reaches `window.open`. The owner in
   `docs/CONTRACTS.md` is **W3 (Frontend shell, `src/App.svelte`)**; route the
   URL through `safeLinkHref` and do not open `null`.
2. **`src/state/actions.ts:462` — medium severity.** The `openLink` action
   passes a URL to `dialogs.openLink(url)` without validation. Even if all
   current call sites use `safeLinkHref`, the external adapter still allows the
   scheme allowlist to be bypassed. The owner in `docs/CONTRACTS.md` is **W3
   (`src/state/**`)**; validate the URL here before the adapter, or require the
   adapter contract to accept only a validated value and enforce that through
   the sole call path.

## Connected on the current snapshot

- All `*Builder` exports from `src/editor/livePreview/` are listed in
  `livePreviewBlockBuilders` in `plugin.ts`.
- All `*Theme` and `*Tooltip` exports from live preview are included in the
  array returned by `livePreview()` in `index.ts`.
- All direct Rust modules, including `binary.rs`, are declared in `lib.rs`, and
  all formats are declared in `formats/mod.rs`; `open_file` calls the binary
  detector.
- All `#[tauri::command]` functions are registered in `generate_handler!`, and
  the commands from section 5 of `docs/CONTRACTS.md` exist in code.
- Every `.svelte` file in `src/ui/` is reachable from `App.svelte` through
  imports and used tags.
- The direct opener in `src/editor/livePreview/plugin.ts` uses the normalized
  result of `safeLinkHref`; the separate rule above catches bypasses through
  the shell/UI.

## Verification

`npx vitest run` finished with **159 passing tests and 1 meaningful failure**
(`routes every external opener through safeLinkHref`), which reports both
findings above. The other five wiring checks passed; `npx tsc --noEmit` passed.
The build was intentionally not run because of the dispatch scope.

## Check limits

- This checks source text rather than the TypeScript/Rust AST: it does not prove
  branch execution, condition correctness, runtime registration order, or the
  behavior of generated macros.
- Builders, themes, Rust modules, and commands are checked by explicit names;
  dynamic imports, aliases, computed macro lists, and generated code may go
  unnoticed.
- UI mounting is checked through static default imports and tags. A dynamic
  component (`<svelte:component>`), re-export through an intermediate module,
  or runtime-conditional mounting needs a separate render test.
- The opener check catches `window.open` and ordinary `receiver.openLink`. It
  cannot prove the safety of a URL passed through a callback, string dispatch,
  `location.assign`, a new Tauri command, or an API with another name; those
  external boundaries need a separate grep/review.
- The presence of `binary::is_binary*` is checked textually in `open_file`; the
  test does not measure the detector heuristic itself, which belongs to its
  unit tests.
