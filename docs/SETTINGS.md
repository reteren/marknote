# Settings

This document describes the settings window: its contents, defaults, and
storage.

The “Constraints” section and README used to say that there would be no
settings window. The project owner deliberately changed that decision:
interface languages and spell checking cannot work without settings, and zoom
and column width are the first things people want to adapt to their monitor.

The principle remains: **a setting appears when reasonable people can have
different answers**. Where there is one answer, behavior remains fixed.
Therefore there is no dark-theme switch (there is only one theme) and no editor
choice. One window per file remains the default; external file opens can be
configured to use tabs in the Windows section.

---

## 1. Storage

The `settings.json` file is stored in the application settings directory
provided by the operating system. Rust handles storage: the frontend receives
a ready structure and does not know where it lives.

Rules:

- the file is read once at startup and written atomically, in the same way as
  user documents, through a temporary file and replacement;
- unknown fields are preserved on read rather than discarded: otherwise
  rolling back to an older version would erase settings added by a newer one;
- a damaged file does not crash the application: defaults are used and the
  damaged file is renamed to `settings.broken.json` so it can be inspected;
- every field has a default, and a missing field is equivalent to its default;
- markers for completed one-time migrations are stored in the `migrations`
  object (`migrations.fontFamilyDefault`,
  `migrations.spellcheckSingleLanguage`). The old `spellcheck.language` and
  `spellcheck.languages` fields are now unknown fields: they are read without
  error and preserved on write with the other unknown data. The
  `spellcheckSingleLanguage` marker remains for compatibility with old files
  and no longer starts a language migration.

## 2. Interface language

English is the default. The following languages are supported:

| Code | Language | Script direction |
| --- | --- | --- |
| `en` | English | left to right |
| `ru` | Russian | left to right |
| `de` | Deutsch | left to right |
| `es` | Español | left to right |
| `pt` | Português | left to right |
| `it` | Italiano | left to right |
| `fr` | Français | left to right |
| `zh` | 中文 | left to right |
| `ja` | 日本語 | left to right |
| `ar` | العربية | **right to left** |

Arabic is not merely another list of strings. The entire interface is
mirrored — menus, the status bar, the search panel, the context menu, and the
direction in which submenus open. Layout must use logical properties
(`inline-start`, `inline-end`), not `left` and `right`, or the Arabic interface
will break.

**The document text direction does not change.** A user can write Arabic in an
English interface and vice versa; the document itself determines paragraph
direction, not the menu language.

The `system` value means “use the operating-system language, or English if
that translation is unavailable.”

## 3. Spell checking and autocorrect

Spell checking uses bundled Hunspell dictionaries for English, Russian,
German, Spanish, French, Italian, Portuguese (Portugal), and Arabic. They work
offline and load only when first used. A word is checked only against selected
dictionaries for its script and is considered correct when any matching
dictionary accepts it.

Settings:

- spell checking — enabled or disabled;
- dictionaries — the selected language tags (`en`, `ru`, `de`, `es`, `fr`,
  `it`, `pt`, and `ar`), defaulting to `en`. Older region tags such as
  `en-US` and `ru-RU` migrate to their bundled base language; unsupported tags
  are dropped. An explicitly empty selection remains empty;
- inline suggestions — disabled by default because suggestions are shown on
  demand when this option is off;
- skip code, formulas, and links — enabled by default: the dictionary does
  not underline syntax and identifiers. Disable this when those parts should
  also be checked;
- autocorrect: smart quotes, an em dash from two hyphens, automatic
  capitalization after a period, and replacing three dots with an ellipsis.
  Each can be disabled separately; all are disabled by default because a
  Markdown document often goes to a system that understands only plain
  characters.

## 4. Editor

| Setting | Default | Why |
| --- | --- | --- |
| Text font | system sans-serif | the same font the application uses today; changing it during an update for users who never touched the setting would be unfair. Serif and monospace fonts are nearby in the list |
| Font size | 16 | current behavior |
| Zoom | 100% | changes here and with `Ctrl` `+` / `−` / `0` — this is one value |
| Column width | 81 characters | from the specification; options: narrow 65, normal 81, wide 100, full window |
| Tab width | 4 | |
| Tab inserts | spaces | |
| Soft wrapping | enabled | disabling it enables horizontal scrolling |
| Show invisible characters | disabled | spaces, tabs, and line breaks |
| Line numbers | disabled | when disabled, numbers appear only in code formats with `syntaxMode`; when enabled, they appear in all formats |

## 5. Live preview

| Setting | Default |
| --- | --- |
| Live preview | enabled |
| Reveal markup | under the cursor (options: under the cursor, whole line, never) |
| Render formulas | enabled |
| Render images | enabled |
| Maximum image width | column width |
| Disable preview for files larger than | 5 MB |

The “never” option turns the editor into ordinary Markdown with highlighting —
a deliberate fallback mode for people who find preview distracting.

## 6. Files and saving

| Setting | Default |
| --- | --- |
| Autosave | enabled |
| Autosave delay | 2 seconds |
| Save when the window loses focus | enabled |
| New document format | Markdown |
| New-file encoding | UTF-8 without BOM |
| New-file line endings | system default |
| Remove trailing spaces on save | disabled |
| Append a final line break | disabled |

The last two are deliberately disabled: they change a file beyond what the
user typed, which is an unpleasant surprise for an existing document.

## 7. Windows

| Setting | Default |
| --- | --- |
| Remember window size and position | enabled |
| Open at startup | start screen (option: recent files) |
| Raise an already open window instead of opening another | enabled |
| Open files in a tab of the existing window | disabled |

## 8. Other

- a “Reset all settings” button with confirmation;
- a “Show settings file in Explorer” button, so it can be copied to another
  machine;
- the application version is visible in the corner of the settings window and
  can be copied from there.

## 9. Settings that do not exist and why

- **Light theme.** The specification promises one dark theme; a switch would
  imply a second theme that does not exist.
- **Tabs by default.** One window per file remains the default. External opens
  can be configured to add files as tabs in the most recently focused document
  window.
- **Plugins and vaults.** The same applies.
- **Interface font selection.** Zoom solves the same problem more simply.
