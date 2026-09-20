# W144: typing in very large documents

## Method

The profile was taken on a live Vite + Edge pair through CDP with
[`qa/w144-profile.mjs`](w144-profile.mjs). The script opens the real editor,
loads a Markdown file of exactly 5 MiB, inserts a character through
`Input.insertText` and then waits for two `requestAnimationFrame`. Each variant
was reloaded three times with a 1 s warm-up; the table gives the median of the
three runs. The internal intervals are measured with `performance.now()` around
the real `EditorView.dispatch` and the extensions under suspicion. `W144_CPU=1`
additionally saves a CDP `Profiler` sampling profile.

## Breaking down one keystroke in 5 MiB

All values in milliseconds; this is the same CDP measurement before and after
the change. `cdp dispatch` is `Input.insertText` returning, `2 RAF` is two
frames completing, and `post-dispatch frame` is the difference between them —
not pure paint time, since it also includes the browser scheduling a frame.

| Part | Before | After | Evidence |
| --- | ---: | ---: | --- |
| `EditorView.dispatch` / applying the transaction | 87.7 | 7.2 | `qa/w144-profile-before-all-clean.json`, `qa/w144-profile-after-all-clean.json` |
| CDP `Input.insertText` until it returns | 99.8 | 15.3 | the same JSON |
| up to two `requestAnimationFrame` | 114.4 | 30.8 | the same JSON |
| post-dispatch up to two frames (a DOM/frame proxy) | 14.6 | 15.5 | the same JSON |
| rebuilding the live preview | 13.9 | 0 | the `preview.rebuild` phase in the same JSON |
| the list renumbering filter | 0.0 | 0.1 | the `lists.filter` phase in the same JSON |
| marking code and formulas for spellcheck | 0.8 | 0.5 | the `spellcheck.decorate` phase in the same JSON |
| fetching the already parsed tree in preview/spellcheck | 0.0 | 0.0 | the `preview.parse` and `spellcheck.parse` phases |

The phases are nested inside `EditorView.dispatch`, so they cannot be added to
`transaction.apply`. The `@lezer/markdown` parse happens inside CodeMirror's
language state update, before our `syntaxTree` functions are called, and is
therefore not visible as a separate `preview.parse` phase. For 5 MiB before the
change the CPU profile `qa/w144-cpu-normal.json` recorded 36.0 ms in
`getEditorStats` and about 10.1 ms in `TextEncoder.encode`; Lezer's incremental
`reuseFragment` and the ordinary parser frames are visible there too. As an
independent estimate of the parser's share, a 5 MiB plain-text control gave a
37.8 ms transaction against 46.2 ms for Markdown without the preview — about
8.4 ms of difference. That is an estimate of Markdown/Lezer and the related
Markdown extensions, not a sum of sampling frames.

## Hypotheses and variants

| Variant | 5 MiB transaction | 5 MiB CDP dispatch | What it proves |
| --- | ---: | ---: | --- |
| Before every W144 change, preview switched off by the threshold | 87.7 | 99.8 | `w144-profile-before-all-clean.json`; the full size scan, the statistics and the update overhead were all still there |
| After only the lower-bound size check in preview, before stats/blockMath | 59.7 | 72.9 | `w144-profile-before-stats-after-limits.json`; the preview is already 0 ms |
| After incremental stats, before the blockMath shortcut | 23.2 | 34.6 | `w144-profile-before-block-math-stats.json` |
| After every change | 7.7 | 16.8 | `w144-profile-after-block-math-stats.json` |
| The final clean before/after | 87.7 → 7.2 | 99.8 → 15.3 | `w144-profile-before-all-clean.json`, `w144-profile-after-all-clean.json` |

A separate control, `w144-profile-no-preview.json`, showed the upper bound of
what switching the preview off entirely could gain: about 46.2 ms of
transaction on 5 MiB. With the threshold raised to 20 MiB,
`w144-profile-high-limit.json` made the preview actually work and gave 66.6 ms
of transaction with 11.3 ms of `preview.rebuild`. So the `disableAboveBytes`
setting really does switch the preview off, and what it used to cost in the
ordinary mode was mostly not building the visible decorations but measuring the
size of the document.

## What changed

1. `src/editor/livePreview/plugin.ts` and `blockMath.ts` first compare the
   UTF-16 length of the `Text` with the limit. UTF-8 cannot be shorter for that
   text, so a document already above the limit is no longer flattened into a
   string and encoded with `TextEncoder` before the preview or the formulas are
   switched off. For documents below the limit the previous exact UTF-8
   calculation and threshold behaviour are kept.
2. `src/editor/createEditor.ts` caches the word statistics against the
   immutable CodeMirror `Text` and, after a change, recomputes only the changed
   ranges widened by one character. The character count comes from `doc.length`;
   counting words in a selection still respects whole words and whitespace
   boundaries.
3. `qa/w144-profile.mjs` is kept as a reproducible CDP profile;
   `tests/editorStats.performance.test.ts` was added, along with regression
   checks for the shortcut in `tests/livePreview.performance.test.ts` and
   `tests/blockMath.test.ts`.

## Checks

- `npx vitest run --poolOptions.threads.maxThreads=3` — 51 files, 433 tests
  passed.
- `npx tsc --noEmit` — passed.
- Rust was not touched, so `cargo test` was not run.
- The live measurement was made in the browser through CDP; W144 needed no
  native window and started none.

## Looked at, and left alone for speed

- `src/editor/keymap.ts`: the list filter measures about 0.1 ms. It already
  works on the list block that changed, and moving to different normalization
  semantics could change the behaviour of Enter/Tab and indent/outdent.
- `src/editor/spellcheck.ts`: the tree walk happens on `docChanged` or a change
  of the tree, not on every cursor or viewport movement; the measured cost is
  under 1.3 ms. Marking the boundaries of code, formulas and links
  incrementally needs a model of its own that can be proved, so it was not
  introduced.
- The Lezer parser and parsing off screen: the parser is needed for a coherent
  incremental tree; the plain-format control gave about 8.4 ms of difference,
  but there is no safe way to limit parsing to the viewport without changing
  Markdown semantics.
- Rebuilding the preview on `selectionSet`/`viewportChanged` and the table
  handlers: they are needed for `revealMarkup`, the visible decorations and the
  drag highlight, and they do not add a significant cost to the 5 MiB typing
  path.
- The DOM: CDP gives no exact separate paint timestamp in this scenario, so an
  honest `post-dispatch frame` proxy was recorded instead, and the DOM was not
  changed for the sake of an unproven hypothesis.
