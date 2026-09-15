<script lang="ts">
  import { deleteLine, moveLineDown, moveLineUp, redo, redoDepth, selectAll, undo, undoDepth } from "@codemirror/commands";
  import { EditorSelection } from "@codemirror/state";
  import type { Command } from "@codemirror/view";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { onMount } from "svelte";
  import { toggleWrapper } from "./editor/keymap";
  import { safeLinkHref } from "./editor/livePreview/inline";
  import { createEditor, setEditorDocumentPath, type EditorStats } from "./editor/createEditor";
  import { dispatchSearchOpen } from "./editor/search";
  import { createAutosave, saveAs } from "./state/autosave";
  import {
    clearExternalChange,
    documentState,
    getClosePromptMessage,
    getDocumentTitle,
    markSaved,
    replaceDocument,
    resetDocument,
    setDocumentFormat,
    setDocumentText,
    type NewDocument,
    type OpenedFile,
  } from "./state/document.svelte";
  import { formatsState, loadCreatableFormats, type FormatCapabilities } from "./state/formats.svelte";
  import MenuBar from "./ui/MenuBar.svelte";
  import SaveControls from "./ui/SaveControls.svelte";
  import StartScreen from "./ui/StartScreen.svelte";
  import StatusBar from "./ui/StatusBar.svelte";
import FindPanel from "./ui/FindPanel.svelte";
import ContextMenu, { type ContextMenuAction } from "./ui/ContextMenu.svelte";
import FormatPicker from "./ui/FormatPicker.svelte";
import Notice from "./ui/Notice.svelte";
import HelpDialog, { type HelpMode } from "./ui/HelpDialog.svelte";
  import type { EditorView } from "@codemirror/view";

  type OpenFileRequest = { path: string };
  type CloseChoice = "save" | "discard" | "cancel";
  type CloseRequestSource = "menu" | "native" | null;
  type SelectionSnapshot = Array<{ anchor: number; head: number }>;

  let editorHost: HTMLDivElement | undefined = $state();
  let editorView = $state<EditorView | null>(null);
  let autosaveController: ReturnType<typeof createAutosave> | null = null;
  let openingPathKey: string | null = null;
  let unlistenNativeDrop: UnlistenFn | undefined;
  let lastDropKey: string | null = null;
  let lastDropAt = 0;
  let startScreenDismissed = $state(false);
  let formatPickerOpen = $state(false);
  let closePromptOpen = $state(false);
  let closeRequestSource = $state<CloseRequestSource>(null);
  let nativeClosePending = $state(false);
  let closeAfterDecision = $state(false);
  let helpMode = $state<HelpMode | null>(null);
  let zoomPercent = $state(100);
  let stats = $state<EditorStats>({
    line: 1,
    col: 1,
    lines: 1,
    words: 0,
    chars: 0,
    selection: null,
  });
  let errorMessage = $state<string | null>(null);

  const title = $derived(getDocumentTitle(documentState));
  const closePromptMessage = $derived(getClosePromptMessage(documentState));
  const showStartScreen = $derived(
    !startScreenDismissed && documentState.path === null && documentState.text.length === 0,
  );
  const isReadOnly = $derived(documentState.readonly || !documentState.format.editable);
  const canSave = $derived(
    !isReadOnly &&
      documentState.saveStatus !== "pending" &&
      (documentState.path === null ? documentState.text.length > 0 : documentState.dirty),
  );
  const menuState = $derived({
    editable: !isReadOnly,
    readOnly: isReadOnly,
    hasSelection: stats.selection !== null,
    canUndo: editorView ? undoDepth(editorView.state) > 0 : false,
    canRedo: editorView ? redoDepth(editorView.state) > 0 : false,
    canSave,
  });

  function pathKey(path: string): string {
    return path.replaceAll("/", "\\").toLowerCase();
  }

  function snapshotSelection(view: EditorView | null): SelectionSnapshot {
    return view?.state.selection.ranges.map((range) => ({ anchor: range.anchor, head: range.head })) ?? [];
  }

  function selectionForLength(snapshot: SelectionSnapshot, length: number): EditorSelection {
    if (snapshot.length === 0) return EditorSelection.single(0);
    return EditorSelection.create(
      snapshot.map((range) =>
        EditorSelection.range(Math.min(range.anchor, length), Math.min(range.head, length)),
      ),
    );
  }

  function replaceEditorText(text: string, selection = snapshotSelection(editorView)): void {
    const view = editorView;
    if (!view || view.state.doc.toString() === text) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: selectionForLength(selection, text.length),
    });
  }

  function rebuildEditor(focus = false): void {
    if (!editorHost) return;
    editorView?.destroy();
    editorView = createEditor({
      parent: editorHost,
      doc: documentState.text,
      path: documentState.path,
      format: documentState.format,
      onChange: (text) => {
        setDocumentText(text);
        autosaveController?.schedule();
      },
      onStats: (nextStats) => {
        stats = nextStats;
      },
    });
    if (focus) editorView.focus();
  }

  function reportError(error: unknown): void {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  async function openFile(path: string): Promise<void> {
    if (!path) return;
    const requestedPathKey = pathKey(path);
    if (
      openingPathKey === requestedPathKey ||
      (documentState.path !== null && pathKey(documentState.path) === requestedPathKey)
    ) {
      editorView?.focus();
      return;
    }
    openingPathKey = requestedPathKey;
    try {
      const opened = await invoke<OpenedFile>("open_file", { path });
      replaceDocument(opened);
      startScreenDismissed = true;
      errorMessage = null;
      rebuildEditor(true);
    } catch (error) {
      reportError(error);
    } finally {
      if (openingPathKey === requestedPathKey) openingPathKey = null;
    }
  }

  async function pickFile(): Promise<void> {
    try {
      const path = await invoke<string | null>("pick_file");
      if (path) await openFile(path);
    } catch (error) {
      reportError(error);
    }
  }

  async function createNewDocument(format: FormatCapabilities): Promise<void> {
    try {
      const created = await invoke<NewDocument>("new_document", { formatId: format.id });
      resetDocument(created.format, created.text);
    } catch {
      // До запуска Tauri используем заготовку из уже загруженного реестра.
      resetDocument(format, format.template);
    }
    startScreenDismissed = true;
    formatPickerOpen = false;
    errorMessage = null;
    rebuildEditor(true);
  }

  function handleFormatSelect(format: FormatCapabilities): void {
    setDocumentFormat(format);
    startScreenDismissed = true;
    formatPickerOpen = false;
    rebuildEditor(true);
  }

  async function saveDocumentAs(): Promise<boolean> {
    const extension = documentState.format.defaultExtension;
    const suggestedName = documentState.path?.split(/[\\/]/u).pop() ?? `Untitled.${extension}`;
    try {
      const result = await saveAs(documentState, suggestedName);
      if (!result) return false;
      const formatChanged = result.format.id !== documentState.format.id;
      markSaved(result, documentState.text);
      if (editorView) setEditorDocumentPath(editorView, result.path);
      if (formatChanged) rebuildEditor(true);
      errorMessage = null;
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  async function saveNow(): Promise<boolean> {
    if (documentState.path === null) return saveDocumentAs();
    const result = await autosaveController?.flush(true);
    return result !== null || !documentState.dirty;
  }

  async function reloadExternalFile(): Promise<void> {
    const path = documentState.externalChangePath ?? documentState.path;
    if (!path) return;
    const selection = snapshotSelection(editorView);
    try {
      const opened = await invoke<OpenedFile>("open_file", { path });
      const formatChanged = opened.format.id !== documentState.format.id;
      replaceDocument(opened);
      clearExternalChange();
      if (formatChanged) {
        rebuildEditor();
        if (editorView) {
          editorView.dispatch({ selection: selectionForLength(selection, opened.text.length) });
          editorView.focus();
        }
      } else {
        replaceEditorText(opened.text, selection);
      }
      errorMessage = null;
    } catch (error) {
      reportError(error);
    }
  }

  function keepMine(): void {
    clearExternalChange();
    autosaveController?.schedule();
  }

  function needsClosePrompt(): boolean {
    return !isReadOnly && documentState.dirty && documentState.text.length > 0;
  }

  async function respondToNativeClose(allow: boolean): Promise<void> {
    if (!nativeClosePending) return;
    nativeClosePending = false;
    try {
      await invoke("respond_to_close", { allow });
    } catch (error) {
      reportError(error);
    }
  }

  function handleNativeCloseRequest(): void {
    nativeClosePending = true;
    if (closeAfterDecision) {
      closeAfterDecision = false;
      void respondToNativeClose(true);
      return;
    }
    if (closePromptOpen) {
      closeRequestSource = "native";
      return;
    }
    if (needsClosePrompt()) {
      closeRequestSource = "native";
      closePromptOpen = true;
      return;
    }
    void respondToNativeClose(true);
  }

  async function closeWindowAfterDecision(): Promise<void> {
    closeAfterDecision = true;
    try {
      await getCurrentWindow().close();
    } catch (error) {
      closeAfterDecision = false;
      reportError(error);
    }
  }

  async function requestClose(): Promise<void> {
    if (needsClosePrompt()) {
      closeRequestSource = "menu";
      closePromptOpen = true;
      return;
    }
    await closeWindowAfterDecision();
  }

  async function handleCloseChoice(choice: CloseChoice): Promise<void> {
    const source = closeRequestSource;
    closePromptOpen = false;
    closeRequestSource = null;
    if (choice === "cancel") {
      if (source === "native") await respondToNativeClose(false);
      return;
    }
    if (choice === "save") {
      const saved = documentState.path === null ? await saveDocumentAs() : await saveNow();
      if (!saved) {
        if (source === "native") await respondToNativeClose(false);
        return;
      }
    }
    if (source === "native") {
      await respondToNativeClose(true);
    } else {
      await closeWindowAfterDecision();
    }
  }

  function runEditor(command: Command): void {
    if (!editorView) return;
    editorView.focus();
    command(editorView);
  }

  function wrapSelection(open: string, close = open): void {
    runEditor((view) => toggleWrapper(view, open, close));
  }

  function insertText(text: string): void {
    if (!editorView || isReadOnly) return;
    editorView.focus();
    editorView.dispatch(editorView.state.replaceSelection(text));
  }

  function insertLink(): void {
    if (!editorView || isReadOnly) return;
    const range = editorView.state.selection.main;
    const selected = editorView.state.sliceDoc(range.from, range.to);
    if (selected) {
      editorView.dispatch({
        changes: { from: range.from, to: range.to, insert: `[${selected}](url)` },
        selection: { anchor: range.from + selected.length + 3, head: range.from + selected.length + 6 },
      });
    } else {
      editorView.dispatch({ changes: { from: range.from, insert: "[](url)" }, selection: { anchor: range.from + 1 } });
    }
  }

  function applyHeading(level: number): void {
    if (!editorView || isReadOnly) return;
    const view = editorView;
    const ranges = view.state.selection.ranges;
    const changes = ranges.map((range) => {
      const line = view.state.doc.lineAt(range.from);
      const body = line.text.replace(/^\s*#{1,6}\s*/, "").replace(/^\s+/u, "");
      const indent = line.text.match(/^\s*/u)?.[0] ?? "";
      const text = level === 0 ? indent + body : `${indent}${"#".repeat(level)} ${body}`;
      return { from: line.from, to: line.to, insert: text };
    });
    view.dispatch({ changes });
  }

  function applyList(): void {
    if (!editorView || isReadOnly) return;
    const view = editorView;
    const range = view.state.selection.main;
    const first = view.state.doc.lineAt(range.from).number;
    const last = view.state.doc.lineAt(range.to).number;
    const changes = [] as Array<{ from: number; to: number; insert: string }>;
    for (let number = first; number <= last; number += 1) {
      const line = view.state.doc.line(number);
      if (!/^\s*(?:[-+*]|\d+[.)])\s+/u.test(line.text)) changes.push({ from: line.from, to: line.from, insert: "- " });
    }
    if (changes.length > 0) view.dispatch({ changes });
  }

  function clipboard(action: "cut" | "copy" | "paste"): void {
    if (!editorView) return;
    editorView.focus();
    if (action === "paste") {
      void navigator.clipboard?.readText().then((text) => {
        if (text) editorView?.dispatch(editorView.state.replaceSelection(text));
      }).catch(() => undefined);
      return;
    }
    try {
      document.execCommand(action);
    } catch {
      // Clipboard permissions are controlled by WebView2.
    }
  }

  function copyText(text: string | undefined): void {
    if (!text) return;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  function handleContextMenuAction(action: ContextMenuAction, payload?: string): void {
    switch (action) {
      case "cut": clipboard("cut"); break;
      case "copy": clipboard("copy"); break;
      case "paste": clipboard("paste"); break;
      case "delete": runEditor((view) => { if (!view.state.selection.main.empty) view.dispatch(view.state.replaceSelection("")); return true; }); break;
      case "select-all": runEditor(selectAll); break;
      case "bold": wrapSelection("**"); break;
      case "italic": wrapSelection("*"); break;
      case "code": wrapSelection("`"); break;
      case "strikethrough": wrapSelection("~~"); break;
      case "highlight": wrapSelection("=="); break;
      case "link": insertLink(); break;
      case "open-link":
      case "open-image":
        if (payload) {
          const href = safeLinkHref(payload);
          if (href) window.open(href, "_blank", "noopener,noreferrer");
        }
        break;
      case "copy-link":
      case "copy-image": copyText(payload); break;
      case "edit-link": insertLink(); break;
      case "insert-table": insertText("| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n"); break;
      case "insert-callout": insertText("> [!NOTE] Note\n> \n"); break;
      case "insert-code-block": insertText("```\n\n```\n"); break;
      case "insert-math-block": insertText("$$\n\n$$\n"); break;
      case "insert-hr": insertText("\n---\n"); break;
    }
  }

  function handleMenuAction(id: string): void {
    if (id.startsWith("file.new.")) {
      const format = formatsState.items.find((item) => item.id === id.slice("file.new.".length));
      if (format) void createNewDocument(format);
      return;
    }
    switch (id) {
      case "file.newWindow":
        if (documentState.path) {
          void invoke("open_in_new_window", { path: documentState.path }).catch(reportError);
        } else {
          const markdown = formatsState.items.find((format) => format.id === "markdown") ?? formatsState.items[0];
          if (markdown) void createNewDocument(markdown);
        }
        break;
      case "file.open": void pickFile(); break;
      case "file.save": void saveNow(); break;
      case "file.saveAs": void saveDocumentAs(); break;
      case "file.close": void requestClose(); break;
      case "edit.undo": runEditor(undo); break;
      case "edit.redo": runEditor(redo); break;
      case "edit.cut": clipboard("cut"); break;
      case "edit.copy": clipboard("copy"); break;
      case "edit.paste": clipboard("paste"); break;
      case "edit.selectAll": runEditor(selectAll); break;
      case "edit.deleteLine": runEditor(deleteLine); break;
      case "edit.moveLineUp": runEditor(moveLineUp); break;
      case "edit.moveLineDown": runEditor(moveLineDown); break;
      case "edit.find": if (editorView) dispatchSearchOpen(editorView, false); break;
      case "edit.replace": if (editorView) dispatchSearchOpen(editorView, true); break;
      case "edit.pastePlainText": clipboard("paste"); break;
      case "format.bold": wrapSelection("**"); break;
      case "format.italic": wrapSelection("*"); break;
      case "format.strikethrough": wrapSelection("~~"); break;
      case "format.highlight": wrapSelection("=="); break;
      case "format.code": wrapSelection("`"); break;
      case "format.link": insertLink(); break;
      case "format.heading1": applyHeading(1); break;
      case "format.heading2": applyHeading(2); break;
      case "format.heading3": applyHeading(3); break;
      case "format.heading4": applyHeading(4); break;
      case "format.heading5": applyHeading(5); break;
      case "format.heading6": applyHeading(6); break;
      case "format.clearHeading": applyHeading(0); break;
      case "format.list": applyList(); break;
      case "format.table": insertText("| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n"); break;
      case "format.callout": insertText("> [!NOTE] Note\n> \n"); break;
      case "format.codeBlock": insertText("```\n\n```\n"); break;
      case "format.mathBlock": insertText("$$\n\n$$\n"); break;
      case "format.horizontalRule": insertText("\n---\n"); break;
      case "view.zoomIn": zoomPercent = Math.min(200, zoomPercent + 10); break;
      case "view.zoomOut": zoomPercent = Math.max(50, zoomPercent - 10); break;
      case "view.resetZoom": zoomPercent = 100; break;
      case "help.shortcuts": helpMode = "shortcuts"; break;
      case "help.markdownReference": helpMode = "markdownReference"; break;
      case "help.about": helpMode = "about"; break;
      default: break;
    }
  }

  function handleDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function fileUriToPath(value: string): string {
    if (!value.toLowerCase().startsWith("file://")) return value;
    try {
      const parsed = new URL(value);
      const pathname = decodeURIComponent(parsed.pathname);
      return pathname.replace(/^\/([A-Za-z]:)/u, "$1");
    } catch {
      return value;
    }
  }

  function handleDroppedPaths(paths: string[]): void {
    const normalized = paths.map(fileUriToPath).filter(Boolean);
    if (normalized.length === 0) return;
    const batchKey = normalized.map(pathKey).join("|");
    const now = Date.now();
    if (batchKey === lastDropKey && now - lastDropAt < 750) return;
    lastDropKey = batchKey;
    lastDropAt = now;

    const reuseCurrent = documentState.path === null && documentState.text.length === 0 && !documentState.dirty;
    normalized.forEach((path, index) => {
      if (index === 0 && reuseCurrent) {
        void openFile(path);
      } else {
        void invoke("open_in_new_window", { path }).catch(reportError);
      }
    });
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    if (
      event.currentTarget instanceof HTMLElement &&
      event.currentTarget.classList.contains("editor-stage") &&
      (event.target as Element | null)?.closest(".start-screen")
    ) return;

    const paths: string[] = [];
    for (const file of Array.from(event.dataTransfer?.files ?? [])) {
      const path = (file as File & { path?: string }).path;
      if (path) paths.push(path);
    }
    const uriList = event.dataTransfer?.getData("text/uri-list") ?? "";
    if (paths.length === 0 && uriList) {
      paths.push(...uriList.split(/\r?\n/u).filter((line) => line && !line.startsWith("#")).map(fileUriToPath));
    }
    handleDroppedPaths(paths);
  }

  $effect(() => {
    const currentTitle = title;
    if (typeof globalThis.document !== "undefined") globalThis.document.title = currentTitle;
    try {
      void getCurrentWindow().setTitle(currentTitle).catch(() => undefined);
    } catch {
      // Запуск вне Tauri не должен ломать редактор.
    }
  });

  $effect(() => {
    const text = documentState.text;
    const view = editorView;
    if (view && view.state.doc.toString() !== text) replaceEditorText(text);
  });

  $effect(() => {
    if (typeof globalThis.document !== "undefined") globalThis.document.documentElement.style.zoom = `${zoomPercent}%`;
  });

  onMount(() => {
    let disposed = false;
    let unlistenOpen: UnlistenFn | undefined;
    let unlistenNativeClose: UnlistenFn | undefined;
    autosaveController = createAutosave({
      onSaved: (result) => {
        if (editorView) setEditorDocumentPath(editorView, result.path);
      },
      onError: reportError,
    });
    void autosaveController.start();
    rebuildEditor();

    const setup = async (): Promise<void> => {
      try {
        unlistenOpen = await listen<OpenFileRequest>("open-file-request", ({ payload }) => {
          if (payload?.path) void openFile(payload.path);
        });
        unlistenNativeClose = await listen("save-before-close", handleNativeCloseRequest);
        unlistenNativeDrop = await listen<{ paths?: string[] }>("tauri://drag-drop", ({ payload }) => {
          handleDroppedPaths(payload?.paths ?? []);
        });
        if (disposed) {
          unlistenOpen();
          unlistenNativeClose?.();
          unlistenNativeDrop?.();
          return;
        }
        const pendingPath = await invoke<string | null>("take_pending_file");
        if (pendingPath) void openFile(pendingPath);
      } catch (error) {
        reportError(error);
      }
      void loadCreatableFormats();
    };
    void setup();

    return () => {
      disposed = true;
      unlistenOpen?.();
      unlistenNativeClose?.();
      unlistenNativeDrop?.();
      autosaveController?.dispose();
      editorView?.destroy();
      editorView = null;
    };
  });
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

<div class="app-shell">
  <div class="menu-row">
    <MenuBar
      formats={formatsState.items}
      {menuState}
      {title}
      saveStatus={documentState.saveStatus}
      lastSavedAt={documentState.lastSavedAt}
      onSave={() => void saveNow()}
      onSaveAs={() => void saveDocumentAs()}
      onAction={handleMenuAction}
      onFocusEditor={() => editorView?.focus()}
    />
    <div class="save-controls-overlay">
      <SaveControls
        saveStatus={documentState.saveStatus}
        lastSavedAt={documentState.lastSavedAt}
        path={documentState.path}
        text={documentState.text}
        format={documentState.format}
        encoding={documentState.encoding}
        bom={documentState.bom}
        lineEnding={documentState.lineEnding}
        readonly={documentState.readonly}
        dirty={documentState.dirty}
        onSave={() => void saveNow()}
        onSaveAs={() => void saveDocumentAs()}
        onError={reportError}
      />
    </div>
  </div>

  <div class="notice-row">
    {#if documentState.externalChange === "changed"}
      <Notice
        preset="file-changed"
        onAction={(action) => action === "reload" ? void reloadExternalFile() : keepMine()}
      />
    {:else if documentState.externalChange === "deleted"}
      <Notice preset="file-deleted" onAction={(action) => action === "save" ? void saveNow() : undefined} />
    {/if}
  </div>

  <main class="editor-stage" ondragover={handleDragOver} ondrop={handleDrop}>
    <div class="editor-host" bind:this={editorHost}></div>
    <FindPanel view={editorView} />
    {#if showStartScreen}
      <StartScreen
        formats={formatsState.items}
        onSelect={(format) => void createNewDocument(format)}
        onOpenFile={() => void pickFile()}
        onDrop={handleDrop}
      />
    {/if}
    {#if errorMessage}
      <div class="notice" role="status">{errorMessage}</div>
    {/if}
  </main>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="status-area"
    role="region"
    aria-label="Choose document format"
    onclick={(event) => {
      if ((event.target as Element | null)?.closest(".format-info")) formatPickerOpen = true;
    }}
    onkeydown={(event) => {
      if ((event.key === "Enter" || event.key === " ") && (event.target as Element | null)?.closest(".format-info")) {
        event.preventDefault();
        formatPickerOpen = true;
      }
    }}
  >
    <StatusBar format={documentState.format} {stats} />
    {#if formatPickerOpen}
      <div class="format-picker-popover">
        <FormatPicker
          mode="list"
          formats={formatsState.items}
          selectedId={documentState.format.id}
          onSelect={handleFormatSelect}
          onClose={() => (formatPickerOpen = false)}
        />
      </div>
    {/if}
  </div>

  <ContextMenu onSelect={handleContextMenuAction} />

  {#if helpMode}
    <HelpDialog mode={helpMode} onClose={() => (helpMode = null)} />
  {/if}

  {#if closePromptOpen}
    <div class="modal-backdrop">
      <div class="close-dialog" role="dialog" aria-modal="true" aria-labelledby="close-dialog-title">
        <h2 id="close-dialog-title">Save changes?</h2>
        <p>{closePromptMessage}</p>
        <div class="close-dialog-actions">
          <button type="button" class="primary" onclick={() => void handleCloseChoice("save")}>Save</button>
          <button type="button" onclick={() => void handleCloseChoice("discard")}>Discard</button>
          <button type="button" onclick={() => void handleCloseChoice("cancel")}>Cancel</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .app-shell {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    height: 100vh;
    overflow: hidden;
    background: var(--bg-primary);
  }

  .menu-row {
    position: relative;
    min-width: 0;
  }

  /* MenuBar has a legacy fallback; the shared component below owns the save state. */
  :global(.menu-row > .menu-bar > .save-controls) { display: none; }

  .save-controls-overlay {
    position: absolute;
    top: 0;
    right: 12px;
    z-index: 25;
    display: flex;
    align-items: center;
    height: var(--menubar-height);
    padding-left: 8px;
    background: var(--bg-secondary);
  }

  .editor-stage {
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-primary);
  }

  .notice-row {
    min-width: 0;
  }

  .editor-host {
    height: 100%;
    overflow: hidden;
  }

  .status-area {
    position: relative;
    z-index: 15;
  }

  .format-picker-popover {
    position: absolute;
    bottom: calc(var(--statusbar-height) + 4px);
    left: 8px;
    z-index: 40;
  }

  .notice {
    position: absolute;
    right: 16px;
    bottom: 16px;
    max-width: min(520px, calc(100% - 32px));
    padding: 8px 10px;
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-s);
    background: var(--bg-secondary);
    color: var(--text-error);
    font-family: var(--font-ui);
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: grid;
    place-items: center;
    background: var(--background-modifier-cover, rgba(0, 0, 0, 0.55));
  }

  .close-dialog {
    width: min(360px, calc(100vw - 32px));
    padding: 18px;
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-m);
    background: var(--bg-secondary);
    color: var(--text-normal);
    font-family: var(--font-ui);
    box-shadow: 0 14px 40px var(--bg-secondary-alt);
  }

  .close-dialog h2 { margin: 0 0 8px; font-size: var(--font-size-text); }
  .close-dialog p { margin: 0 0 18px; color: var(--text-muted); }
  .close-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .close-dialog-actions button {
    padding: 6px 10px;
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-normal);
    font: inherit;
    cursor: pointer;
  }
  .close-dialog-actions button:hover { background: var(--bg-modifier-hover); }
  .close-dialog-actions button.primary { background: var(--accent); color: var(--text-on-accent); }

  @media (max-width: 760px) {
    .save-controls-overlay { right: 4px; padding-left: 4px; }
  }
</style>
