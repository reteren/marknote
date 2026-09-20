# W140: typing speed and large documents

## Method

Measured on a live Vite + Edge pair through CDP (`qa/w140-benchmark.mjs`),
without calling editor functions directly. The script uses `Input.insertText`
for typing, `Input.dispatchKeyEvent` for the down arrow and
`Input.dispatchMouseEvent(mouseWheel)` for scrolling.

Each size was measured over 3 reloads of the document; inside every reload each
operation was repeated 5 times, and the table gives the mean of the medians of
those three runs. The ASCII Markdown documents are exactly 10,240, 204,800,
1,048,576 and 5,242,880 bytes (the last one is labelled `5120KB`, i.e. 5 MiB).

- `first render`: from the start of `Page.reload` to a ready `.cm-editor` plus
  two `requestAnimationFrame`;
- `input`: from the CDP `Input.insertText` to the command returning;
- `arrow`: five arrow presses on an unchanged document, each measured from
  `Input.dispatchKeyEvent` to the command returning;
- `viewport rebuild`: before every sample the viewport is returned to the top,
  then a wheel event is sent and one animation frame is awaited. That makes
  CodeMirror genuinely change the visible range, instead of measuring a wheel
  event at an end of the document it has already reached.

The raw before and after JSON is kept next to the script:

- `qa/w140-before-final.json` — before the change;
- `qa/w140-after-final.json` — after it.

## Results

All values in milliseconds; `before → after`.

| Document | First render | Typing one character | Arrow | Viewport rebuild |
| --- | ---: | ---: | ---: | ---: |
| 10 KB | 118.9 → 106.3 | 3.2 → 3.2 | 2.2 → 2.2 | 35.5 → 40.9 |
| 200 KB | 109.5 → 108.0 | 8.0 → 8.3 | 4.8 → 4.8 | 36.0 → 36.1 |
| 1 MiB | 181.8 → 107.1 | 25.1 → 21.8 | 19.2 → 9.4 | 40.0 → 41.5 |
| 5 MiB | 379.0 → 349.1 | 93.0 → 92.1 | 75.3 → 62.9 | 47.9 → 35.5 |

The large document tells the most: moving the cursor became 16.4% faster,
changing the viewport 26.0%, the first render 7.9%. Typing barely moved
(`93.0 → 92.1`), because the insertion into a 5 MiB document and the syntax
tree update stay expensive on their own; this change does not switch the
preview off and does not touch the `disableAboveBytes` threshold.

## What changed

1. `src/editor/livePreview/plugin.ts` now computes the UTF-8 size through a
   `WeakMap<Text, number>`. A CodeMirror document is immutable, so on
   `selectionSet` and `viewportChanged` the same `Text` reuses its size instead
   of a fresh `doc.toString()` and `TextEncoder`.
2. `src/editor/livePreview/blocks.ts` accepts the visible ranges for
   `nestedListGuide`. Walking the lines of an `OrderedList`/`BulletList` is
   limited to the intersection of the list with the viewport; calls without
   ranges, including the full preview and the existing integrations, keep the
   previous full behaviour. `src/editor/livePreview/plugin.ts` passes the real
   `view.visibleRanges` to the builder.

Regression tests added:

- `tests/livePreview.performance.test.ts` checks that the size of a single
  immutable `Text` is computed once;
- `tests/orderedLists.test.ts` checks that no guides are built outside the
  visible range.

## Checks

- `npx vitest run --poolOptions.threads.maxThreads=3` — 50 files, 429 tests
  passed;
- `npx tsc --noEmit` — passed;
- Rust was not touched, so `cargo test` was not run.

## Looked at, and left alone

- `src/editor/keymap.ts`: the current `orderedListNormalization` in
  `getMarkerChangesForTransaction` already takes only the list block that
  changed and does not call a full `doc.toString()` on an ordinary
  transaction. The full `normalizeViewOrderedLists` is used only by the
  Enter/Tab and indent/outdent commands; changing that without changing their
  meaning was not attempted.
- `src/editor/livePreview/plugin.ts`: the rebuild on `selectionSet` is needed
  for `revealMarkup` — the cursor can show or hide the markers. Skipping the
  rebuild in general would change how the preview looks.
- `src/editor/livePreview/tables.ts`: the `querySelectorAll` calls sit in the
  drag and mousemove handlers of tables, not in the path of typing, arrows or
  viewport changes; table behaviour was not touched for the sake of the
  benchmark set.
- `src/editor/spellcheck.ts`: the full syntax tree walk runs only after
  `docChanged` or a change of the tree, not on cursor movement or scrolling.
  Doing it incrementally requires handling insertions and deletions at the
  boundaries of code, formulas and links correctly, so it was not introduced
  without its own measurement and tests.
