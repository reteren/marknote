# W100 report: the tab bar inside a window

## 1. The contract and the architectural boundaries
- **Contract**: `docs/CONTRACTS.md`, section 13 (“Tabs inside a window”).
- **Owned by W100**:
  - `src/ui/TabBar.svelte` (the new tab bar component);
  - `src/App.svelte` (placing the bar in the interface grid, switching, closing and opening tabs);
  - Translations into all 10 languages (`src/i18n/locales/*.ts`);
  - The tests in `tests/ui/tabBar.test.ts`.
- **Boundaries**:
  - The state of the tab set and the autosave are consumed from `src/state/workspace.svelte.ts` (W99).
  - Managing the editor state per tab (`createEditorState`, `switchEditorState`, `setEditorState`) is consumed from `src/editor/createEditor.ts` (W101).
  - No second store for the text was introduced in the UI: all access to the text and the state goes through the contract's API.

---

## 2. The interface and behaviour as built

### The tab bar (`src/ui/TabBar.svelte`)
- Sits between the menu row (`.menu-row`) and the editor work area / the notice strips (`.notice-row`, `main.editor-stage`).
- Every tab shows:
  - The file name for saved documents (for example `notes.md`).
  - The first words of the text for an unnamed document that has text (up to 48 characters, computed by `tabLabel(tab)`).
  - A translated “Untitled” label (“Untitled”, “Ohne Titel” and so on) for empty unnamed documents.
  - A format badge (`Markdown`, `Plain Text` and so on) with a translated label from `formatLabel`.
  - Its own `×` close button with a tooltip and the accessible label `aria-label={t("tabs.closeTab", { name })}`.
- The active tab:
  - Is filled with `--bg-primary`, which merges with the editor work area below it.
  - Has an accent indicator (`box-shadow: 0 -2px 0 0 var(--accent)`).
  - Has its title in semibold (`font-weight: 500`), coloured `--text-normal`.
  - Carries `aria-selected="true"` and `tabindex="0"`.
- To the right of the last tab there is a plus button (`+`):
  - It opens a new tab with a clean state and the start screen (`StartScreen`) for choosing a format or dropping a file.
  - Tooltip: “New tab (Ctrl+T)”.

### Reaching the plus button with only one tab open (why it is done this way)
- **The rule of simplicity**: by the contract, when only 1 tab is open the tab bar is hidden, so that the editor stays a simple, clean interface for working with a single file.
- **The interface decision**:
  1. **A compact “+” in the control row**: while `workspace.tabs.length < 2`, a “+” button with a dashed border in the MarkNote style sits in the top right of the menu row, immediately before the saving controls (`.save-controls-overlay`). It is always visible and one click away without cluttering the work area.
  2. **The `Ctrl+T` shortcut**: caught globally in the application window and opening a new tab at once. As soon as there are 2 tabs or more, `TabBar.svelte` appears automatically and the “+” moves to its canonical place to the right of the last tab.
  3. **Closing the last tab**: closing the only remaining tab starts closing the window, with the standard question about unsaved changes (`CloseRequested` / `requestClose()`).

---

## 3. What to do with 10+ open tabs

### How it behaves now
- The tab bar container uses CSS Flexbox:
  - `flex: 0 1 180px; min-width: 80px; max-width: 200px;`
  - The file name shrinks with an ellipsis (`text-overflow: ellipsis; white-space: nowrap; min-width: 0;`).
  - The format badge and the close cross have a fixed width (`flex-shrink: 0`).
  - The container has `overflow-x: auto; scrollbar-width: none;` (native mouse-wheel scrolling with no visible scrollbar).
- With 10 tabs open on a screen 1000–1200px wide, the tabs shrink smoothly to about 90–100px and the beginning of the file name and the format stay readable.

### The architecture thought through for scaling (roadmap / future releases)
1. **Smooth horizontal scrolling of the bar**:
   - A `wheel` handler: hovering the bar turns vertical wheel scrolling into a horizontal shift (`scrollLeft += event.deltaY`).
   - When tabs are switched from the keyboard or programmatically, `tabElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })` keeps the active tab visible.
2. **An overflow button (dropdown menu)**:
   - Once the total width of the tabs exceeds the width of the window, a chevron button `∨` appears to the right of the “+”.
   - Clicking the chevron opens a popup with the full list of open tabs, a quick search by name and status icons (a dirty document, the format).
3. **A lower bound on shrinking**:
   - `min-width: 100px;` for tabs with text; once the total length exceeds the viewport, the tabs stop shrinking into illegibility and the bar switches to horizontal scrolling.
4. **Pinned tabs**:
   - Pinned tabs shrink to a single format badge or icon and stay at the left edge.

---

## 4. Translations (all 10 languages)
The keys added and kept in sync:
- `tabs.bar`
- `tabs.newTab`
- `tabs.closeTab`
- `tabs.close`
- `tabs.untitled`
- `menu.newTab`

In all 10 dictionaries (`ar.ts`, `de.ts`, `en.ts`, `es.ts`, `fr.ts`, `it.ts`, `ja.ts`, `pt.ts`, `ru.ts`, `zh.ts`). The `tests/i18n.completeness.test.ts` test confirms 100% coverage with no missing and no extra keys.

---

## 5. Checks and how the criteria were met
- `npx vitest run`: **44 test files passed, 343 tests passed (100% green)**.
  - Including the 8 dedicated tests in `tests/ui/tabBar.test.ts`.
  - Including `tests/wiring/exports.test.ts` (every one of `openTab`, `closeTab`, `activateTab`, `tabLabel`, `createEditorState`, `switchEditorState`, `setEditorState` is actually used).
- `npx tsc --noEmit`: 0 TypeScript errors.
- `npm run build`: the Vite build finished without errors.
- `cargo test`: all 136 Rust tests passed.
