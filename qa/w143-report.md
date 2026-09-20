# W143 — should HTML parsing be detached from Markdown

## Decision

Recommendation: **change it in production**, but only together with replacing
`insertNewlineContinueMarkup`, not while leaving the
`@codemirror/lang-markdown` import in `keymap.ts`. The experiment crossed the
agreed size threshold: the main JS chunk shrank by 148142 B (>100 KB), while
ordinary Markdown, tables, fenced code and formulas survived. The price is
expected and recorded in the screenshots: HTML inside Markdown no longer has
its tags and attributes highlighted, and has no HTML completion.

Production code was not changed. The variant used for the measurement is in
`qa/w143-nohtml-markdown.ts`; it builds the CodeMirror LanguageSupport straight
out of `@lezer/markdown` and `@codemirror/language`, passes `marknoteMarkdown`,
and does not pass `htmlParser` to `parseCode`. For `keymap.ts` the experiment
adds a compact replacement of the Enter command; checked through real CDP
input, the continuation came out the same in the baseline and the experiment:
`1. first` → `2. second`.

## Paired measurements

The tools run reproducibly from the root of the repository. The baseline uses
the current production build of MarkNote (the chunk from
`qa/w143-baseline-build-report.json`), the experiment uses
`node qa/w143-build-experiment.mjs` and `qa/w143-vite.config.ts`.

| Metric | Baseline | Direct Lezer, no HTML | Difference | Evidence |
|---|---:|---:|---:|---|
| Main JS chunk | 538570 B | 390428 B | −148142 B (−27.5%) | `w143-baseline-build-report.json`, `w143-nohtml-build-report.json` |
| First render, 200 KB document, median of 3 runs | 111.070 ms | 107.406 ms | −3.664 ms | `w143-baseline.json`, `w143-nohtml-benchmark.json` |
| First render, 1 MB document, median of 3 runs | 151.954 ms | 162.825 ms | +10.871 ms | the same benchmark JSON |
| Startup browser heap after GC | 11212056 B | 10096788 B | −1115268 B (~1.06 MiB) | `w143-startup-heap-baseline.json`, `w143-startup-heap-nohtml.json` |

Every benchmark run uses `qa/w140-benchmark.mjs`, the same 3 runs and CDP
input; the baseline and the experiment differ only in their Vite/CDP ports, to
keep the processes apart (1420/9555 and 1423/9557).

## What is left of the main chunk

The experimental main chunk lost `@lezer/javascript` (81155 B),
`@codemirror/lang-html` (22334 B) and the HTML/CSS branch that hangs off them.
Its largest modules: `@lezer/markdown` 59246 B, `@codemirror/commands` 46356 B,
`src/App.svelte` 40122 B, `src/editor/livePreview/tables.ts` 38185 B,
`@codemirror/language-data` 31619 B, `src/state/actions.ts` 30254 B and
`@codemirror/search` 27755 B.

## What is lost

The same fixture was checked with real input through CDP:

```html
<div><span style="color:red">text</span></div>

<script>
const value = 42;
console.log(value);
</script>
```

| Observation | Baseline | Without HTML |
|---|---:|---:|
| Tokenized spans in the HTML fixture | 37 | 0 |
| HTML token classes | 6 kinds | 0 |
| Screenshot | `qa/shots/w143-html-baseline.png` | `qa/shots/w143-html-nohtml.png` |

In the baseline the tag, the attributes, the strings and the JavaScript are
visibly coloured; in the experiment the text is the same but the whole fixture
is one plain colour. That is a deliberate loss, not a defect in the measuring
harness.

Ordinary Markdown was unharmed — both CDP runs gave identical values:

| Check | Baseline | Without HTML |
|---|---:|---:|
| Heading | 1 | 1 |
| List marker visible | yes | yes |
| Table cells | 4 | 4 |
| Fenced code block | 1 | 1 |
| Fenced code tokens | 5 | 5 |
| KaTeX widget | 1 | 1 |
| Enter after `1. first` | `1. first` → `2. second` | the same |

Evidence: `w143-integrity-baseline.json`, `w143-integrity-nohtml.json`,
`w143-enter-baseline.json`, `w143-enter-nohtml.json` and
`w143-html-baseline.json`/`w143-html-nohtml.json`.

## Repository checks

- `npx tsc --noEmit` — clean.
- `npx vitest run --poolOptions.threads.maxThreads=3` — 50 files, 429 tests,
  all green.
- Production code and `src-tauri/**` were not changed, and no installer was
  built.
