<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" alt="MarkNote">
</p>

# MarkNote

this program is aimed at making it convenient to view different formats: .md,
.txt, .json, .yaml, .toml, .html, .xml, .css, .js, .ts, .py, .rs, .go, .c,
.cpp, .sh, .jsonc.

basically it's a mix of the basic windows notepad and obsidian, there is nice
drag and drop of files into the window and also a tab system.

the program has everything you need for editing md formats:
formatting — bold, italic, strikethrough, highlight, code, link
paragraph — headings, bullet list, numbered list, task list
insert — table, callout, code block, math block, horizontal rule

there are extensive settings where you can do basic personalization. changing
the font, text size, interface language and spellcheck.

basically i made this because i got tired of opening obsidian and dragging a
file over just to edit it somehow, and i want to do all of that in one click.
the program also has lifetime saving of files, so everything you write is
saved instantly.

in general there is nothing more to say, the program is very convenient, you
just have to set it in windows settings so that all the formats open through
the program.

## a few notes from the build side

- saving is atomic: the file is written next to the original and then swapped
  in, so a crash mid-save can't leave you with half a file.
- opening a file that is already open doesn't make a second copy of it — the
  window or tab that already has it comes up instead.
- markdown-only commands are hidden in .py or .json. there is nothing to make
  bold there, so the menu doesn't pretend otherwise.
- formulas load katex on the first `$$` in a document, not at startup. code
  highlighting for each language is loaded the same way, on demand.
- the installer is 3.1 MB and there is no chromium inside: windows already
  has webview2, and the program uses that.
- on files over 5 MB live preview turns itself off and the markup goes raw.
  the status bar doesn't explain why yet.
- spellcheck follows the windows interface language. webview2 gives no way to
  pick a different one, so there is no such setting.

## license

not chosen yet. until there is a `LICENSE` file here, the default applies:
all rights reserved, so the code can be read but not reused. worth picking one
before publishing — MIT is the usual choice for this kind of program.

## building

needs [rust](https://rustup.rs) stable and [node](https://nodejs.org) 20+, on
windows 10 (1809+) or 11.

```bash
npm install
npm run tauri dev     # run with hot reload
npm run tauri build   # installer in src-tauri/target/release/bundle/nsis
```
