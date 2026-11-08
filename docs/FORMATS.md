# File formats

You asked for an “advanced Notepad”: double-clicking any text-like file should
produce a meaningful result. The problem is that formats are not equivalent:
`.md` can be saved byte for byte, while a PDF cannot be saved at all.

The solution is four classes. The class determines what the application allows
and reports it honestly in the status bar.

---

## Classes

### A · Native — Markdown

`.md` `.markdown` `.mdown` `.mkd` `.mdx`

Live preview, autosave, and everything in [SPEC.md](SPEC.md). This is the main
scenario; everything else is an addition.

### A+ · Markdown with images

`.mdz`

One file that carries a Markdown document and every picture it shows, so it
can be sent on like a PDF. It is an ordinary ZIP archive: `<name>.md` at the
root, the pictures in `images/`, links in the text pointing there
(`![alt|400](images/shot.png)`). Unpacked by hand, it is a normal Markdown
folder any editor shows with its pictures.

Opening copies the pictures into the shared image folder (Settings ->
Attachments) and points the links at it, so editing is plain class A: paste,
resize, delete. Opening the same package again reuses the copies it made; a
different picture under a taken name gets a content-derived name and never
overwrites the other one. Saving, including autosave, packs every local image
the text references; remote and `data:` images stay links, and an image that
cannot be read keeps its link. Entries outside `images/`, nested folders and
non-image files are ignored.

`File -> Save as Markdown with Images (.mdz)…` turns an open Markdown
document into a package; the tab continues in the new file. Unlike
`Export as ZIP`, which writes a one-off copy with images as data URIs, a
package is a working document. Adapter: `src-tauri/src/formats/package.rs`.

### B · Plain text

`.txt` `.log` `.ini` `.cfg` `.conf` `.env` `.csv` `.tsv`

Editing without markup: Markdown markup is not recognized or hidden. Soft
wrapping at 81 characters works. Autosave is enabled and the file is written
byte for byte.

`.csv` and `.tsv` are treated as text, without a table editor. This application
does not include a table editor, and converting data to a Markdown table would
damage the file on save.

### C · Code and data

`.json` `.yaml` `.yml` `.toml` `.xml` `.html` `.css` `.js` `.ts` `.rs` `.py`
`.go` `.c` `.cpp` `.sh`

Syntax highlighting instead of Markdown preview, autosave, and unchanged
saving. The highlighting language is loaded on demand.

For JSON, additionally: syntax validation with the error location highlighted,
and a `Format JSON` command in the `Format` menu.

### D · Lossy — convertible

`.rtf`

On opening, the file is converted to Markdown and edited as ordinary Markdown.
On save, it is converted back, but the reverse conversion covers only what can
be expressed in Markdown.

Therefore:

- **autosave is disabled**; explicit `Ctrl+S` is required;
- the first save shows a formatting-loss warning with a choice of “save as RTF”
  or “save as Markdown”;
- the status bar is marked `Lossy format`.

The round trip preserves headings, bold, italic, strikethrough, bulleted and
numbered lists, links, tables, and paragraphs.

The following are lost: fonts, font sizes, colors, margins, headers and
footers, embedded objects, and complex tables with merged cells.

### E · Read-only

`.pdf` `.docx` `.epub`

Text is extracted and shown as Markdown. Editing is disabled and the status bar
is marked `Read-only`. `Save as Markdown…` creates a new `.md` without touching
the original.

Extraction quality depends on the file. A text PDF gives a decent result.
Complex layouts, columns, or scans produce poor output. This is a limitation
of the format, not the application, and it is better to report it honestly
than pretend otherwise.

---

## Summary table

| Class | Extensions | Preview | Editing | Create from scratch | Autosave | Losses |
| --- | --- | --- | --- | --- | --- | --- |
| A | md, markdown, mdown, mkd | Markdown | yes | yes | yes | no |
| A+ | mdz | Markdown | yes | yes | yes | no |
| B | txt, log, ini, cfg, env, csv, tsv | none | yes | yes | yes | no |
| C | json, yaml, toml, xml, html, css, js, ts, rs, py, … | code highlighting | yes | yes | yes | no |
| D | rtf | Markdown | yes | yes | no | yes |
| E | pdf, docx, epub | Markdown | no | no | — | — |

## Creating files

Documents of any type in classes A, B, C, and D can be created from scratch
from the start screen or through `File ▸ New`. Class E cannot be created:
the application cannot assemble a PDF from text, and no such item is listed.

A new document is not empty when the format has a meaningful template:

| Type | Template |
| --- | --- |
| JSON | `{}` with the cursor inside |
| YAML, TOML, Markdown, text | empty |
| HTML | minimal document skeleton with `<html>`, `<head>`, and `<body>` |
| CSV, TSV | empty |

Lossy and read-only formats — RTF, DOCX, EPUB, and PDF — cannot be created;
they can only be opened because they have no template and should not have one.
An opened RTF warns about formatting loss on its first save.

The document type can be changed at any time by clicking the type in the status
bar; the text is preserved and only the rules change. Details are in
[SPEC.md, section 2.4](SPEC.md#24-change-document-type).

---

## Implementation

The Rust-side trait is in `src-tauri/src/formats/mod.rs`:

~~~rust
pub trait FormatAdapter: Send + Sync {
    fn caps(&self) -> FormatCapabilities;
    fn decode(&self, bytes: &[u8]) -> anyhow::Result<Decoded>;
    fn encode(&self, text: &str, src: &Decoded) -> anyhow::Result<Vec<u8>>;
    // The commands call these; by default they forward to decode/encode.
    fn decode_in(&self, bytes: &[u8], context: &FormatContext) -> anyhow::Result<Decoded>;
    fn encode_in(&self, text: &str, src: &Decoded, context: &FormatContext) -> anyhow::Result<Vec<u8>>;
}

pub struct FormatContext<'a> {
    pub doc_path: Option<&'a Path>,
    pub images: &'a dyn ImageStore, // the shared image folder
}
~~~

`Decoded` (in `encoding.rs`) holds the text, its encoding (UTF-8, UTF-8 BOM,
UTF-16LE, CP1251, …) and line ending (CRLF or LF). Only container formats such
as `.mdz` use the context; `ImageStore` is implemented in `attachments.rs`, so
the format code has no file system policy of its own.

The dispatcher chooses an adapter by extension. For an unknown extension, a
text-like file uses class B; a binary file produces a rejection message.

Libraries: `pdf-extract` for PDF, `docx-rs` for DOCX, and a hand-written RTF
parser — the specification subset is small, and no ready-made crates for
reverse conversion exist anyway.

## File associations

The installer registers only class A by default — `.md` and related
extensions. The others appear in the “Open with” list but do not take over
double-click behavior. An application that claims `.json` and `.txt` after
installation is not behaving as users expect.
