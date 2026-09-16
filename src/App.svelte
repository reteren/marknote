<script lang="ts">
  import { deleteLine, moveLineDown, moveLineUp, redo, redoDepth, selectAll, undo, undoDepth } from "@codemirror/commands";
  import { EditorSelection } from "@codemirror/state";
  import type { Command } from "@codemirror/view";
  import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
import { onMount, tick } from "svelte";
  import { installZoom, resetZoom, zoomIn, zoomOut } from "./editor/zoom";
  import { safeLinkHref } from "./editor/livePreview/inline";
  import { createActions } from "./state/actions";
  import {
    createEditor,
    createEditorState,
    setEditorDocumentPath,
    setEditorFormat,
    setEditorState,
    type EditorStats,
  } from "./editor/createEditor";
  import { applyEditorSettings } from "./editor/settings";
  import { settingsState } from "./state/settings.svelte";
  import { dispatchSearchOpen } from "./editor/search";
  import { createAutosave, saveAs as saveAsFile } from "./state/autosave";
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
    type SaveResult,
  } from "./state/document.svelte";
  import { formatsState, loadCreatableFormats, markdownFormat, type FormatCapabilities } from "./state/formats.svelte";
  import MenuBar from "./ui/MenuBar.svelte";
  import SaveControls from "./ui/SaveControls.svelte";
  import StartScreen from "./ui/StartScreen.svelte";
  import StatusBar from "./ui/StatusBar.svelte";
import FindPanel from "./ui/FindPanel.svelte";
import ContextMenu, { type ContextMenuAction } from "./ui/ContextMenu.svelte";
import FormatPicker from "./ui/FormatPicker.svelte";
import Notice from "./ui/Notice.svelte";
import HelpDialog, { type HelpMode } from "./ui/HelpDialog.svelte";
  import SettingsWindow from "./ui/SettingsWindow.svelte";
  import TabBar from "./ui/TabBar.svelte";
  import {
    workspace,
    openTab,
    closeTab,
    activateTab,
    activeTab,
    tabLabel,
    type TabId,
  } from "./state/workspace.svelte";
  import type { EditorState } from "@codemirror/state";
  import TitleBar from "./ui/TitleBar.svelte";
  import { formatLabel, translate as t } from "./i18n";
import { EditorView, type EditorView as EditorViewType } from "@codemirror/view";

  type OpenFileRequest = { path: string };
  type CloseChoice = "save" | "discard" | "cancel";
  type CloseRequestSource = "menu" | "native" | "tab" | null;
  type SelectionSnapshot = Array<{ anchor: number; head: number }>;

  let editorHost: HTMLDivElement | undefined = $state();
  let editorView = $state<EditorViewType | null>(null);
  const tabEditorStates = new Map<TabId, EditorState>();
  let pendingCloseTabId = $state<TabId | null>(null);
  let autosaveController: ReturnType<typeof createAutosave> | null = null;
  let openingPathKey: string | null = null;
  let unlistenNativeDrop: UnlistenFn | undefined;
  let lastDropKey: string | null = null;
  let lastDropAt = 0;
  let startScreenDismissed = $state(false);
  let formatPickerOpen = $state(false);
  let formatChoiceResolve: ((formatId: string | null) => void) | null = null;
  let closePromptOpen = $state(false);
  let nativeCloseReady = $state(false);
  let closeRequestSource = $state<CloseRequestSource>(null);
  let nativeClosePending = $state(false);
  let closeAfterDecision = $state(false);
  let closePromptTabs = $state<WorkspaceTab[]>([]);
  let helpMode = $state<HelpMode | null>(null);
  let settingsOpen = $state(false);
  let goToLineOpen = $state(false);
  let goToLineValue = $state("1");
  let goToLineInput: HTMLInputElement | undefined = $state();
  let lossyNoticeOpen = $state(false);
  let lossyChoiceResolve: ((decision: "save-lossy" | "save-markdown" | "cancel") => void) | null = null;
  let stats = $state<EditorStats>({
    line: 1,
    col: 1,
    lines: 1,
    words: 0,
    chars: 0,
    selection: null,
  });
  let errorMessage = $state<string | null>(null);

  const rawDocumentTitle = $derived(getDocumentTitle(documentState));
  const documentFileName = $derived(rawDocumentTitle.replace(/\s+—\s+MarkNote$/u, ""));
  /** Заголовок окна для системы: панель задач и переключение окон. */
  const title = $derived(t("window.documentTitle", { filename: documentFileName }));
  /** Подпись в строке меню: имя файла и его формат, без имени программы —
   *  программа и так перед глазами, а формат человеку важнее. */
  const documentLabel = $derived(
    `${documentFileName} · ${formatLabel(documentState.format.id, documentState.format.label)}`,
  );
  function getTabDisplayName(tab: WorkspaceTab): string {
    const label = tabLabel(tab);
    return label.name === "Untitled" ? t("tabs.untitled") : label.name;
  }
  const closePromptMessage = $derived.by(() => {
    if (closePromptTabs.length > 1) {
      return t("dialog.close.unsavedMultiple");
    }
    const targetDoc = closePromptTabs[0]?.document ?? documentState;
    const message = getClosePromptMessage(targetDoc);
    const untitledMessage = getClosePromptMessage({ path: null });
    return t(message === untitledMessage ? "dialog.close.unsavedUntitled" : "dialog.close.unsavedDocument");
  });
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

  function snapshotSelection(view: EditorViewType | null): SelectionSnapshot {
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

  const actions = createActions({
    getEditorView: () => editorView,
    autosave: {
      flush: (force) => autosaveController?.flush(force) ?? Promise.resolve(null),
    },
    dialogs: {
      showHelp: (mode) => {
        helpMode = mode;
      },
      openLink: (url) => {
        const href = safeLinkHref(url);
        if (href) window.open(href, "_blank", "noopener,noreferrer");
      },
      openImage: (src) => {
        const href = safeLinkHref(src);
        if (href) window.open(href, "_blank", "noopener,noreferrer");
      },
      chooseFormat: async () => {
        formatPickerOpen = true;
        return await new Promise<string | null>((resolve) => {
          formatChoiceResolve?.(null);
          formatChoiceResolve = resolve;
        });
      },
    },
    getFormats: () => formatsState.items,
    getSettings: () => settingsState.settings,
    notify: reportError,
    confirmLossySave: requestLossySave,
    saveAsMarkdown: saveDocumentAsMarkdown,
    closeWindow: () => void requestClose(),
    openSettings: () => {
      settingsOpen = true;
    },
    zoomIn: () => {
      if (editorView) zoomIn(editorView);
    },
    zoomOut: () => {
      if (editorView) zoomOut(editorView);
    },
    resetZoom: () => {
      if (editorView) resetZoom(editorView);
    },
    openNewDocumentWindow: async (formatId) => {
      await invoke("open_new_window", { formatId });
    },
    goToLine: openGoToLine,
  });

  function rebuildEditor(focus = false): void {
    if (!editorHost) return;
    editorView?.destroy();
    editorView = createEditor({
      parent: editorHost,
      doc: documentState.text,
      path: documentState.path,
      format: documentState.format,
      settings: settingsState.ready ? settingsState.settings : null,
      handlers: actions.handlers,
      onChange: (text) => {
        setDocumentText(text);
        autosaveController?.schedule();
      },
      onStats: (nextStats) => {
        stats = nextStats;
      },
    });
    installZoom(editorView);
    tabEditorStates.set(workspace.activeId, editorView.state);
    if (focus) editorView.focus();
  }

  function reportError(error: unknown): void {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  function openGoToLine(): void {
    const view = editorView;
    goToLineValue = String(view ? view.state.doc.lineAt(view.state.selection.main.head).number : stats.line);
    goToLineOpen = true;
    void tick().then(() => {
      goToLineInput?.focus();
      goToLineInput?.select();
    });
  }

  function applyGoToLine(): void {
    const view = editorView;
    const requested = Number.parseInt(goToLineValue, 10);
    if (!view || !Number.isFinite(requested)) return;
    const lineNumber = Math.min(Math.max(requested, 1), view.state.doc.lines);
    const line = view.state.doc.line(lineNumber);
    view.dispatch({
      selection: EditorSelection.cursor(line.from),
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    view.focus();
    goToLineOpen = false;
  }

  function handleGoToLineKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      goToLineOpen = false;
    } else if (event.key === "Enter") {
      event.preventDefault();
      applyGoToLine();
    }
  }

  function requestLossySave(): Promise<"save-lossy" | "save-markdown" | "cancel"> {
    lossyNoticeOpen = true;
    return new Promise((resolve) => {
      lossyChoiceResolve?.("cancel");
      lossyChoiceResolve = resolve;
    });
  }

  async function saveDocumentAsMarkdown(): Promise<boolean> {
    const currentName = documentState.path?.split(/[\\/]/u).pop() ?? "Untitled";
    const stem = currentName.replace(/\.[^.]*$/u, "") || "Untitled";
    const suggestedName = `${stem}.md`;
    try {
      // Через общий saveAs, а не напрямую по IPC: только он применяет правку
      // текста при записи — удаление пробелов в конце строк и завершающий
      // перевод строки. Прямой вызов сохранял бы иначе, чем Ctrl+S.
      const result = await saveAsFile(
        { text: documentState.text, format: markdownFormat },
        suggestedName,
      );
      if (!result) return false;
      const formatChanged = result.format.id !== documentState.format.id;
      markSaved(result, documentState.text);
      if (editorView) {
        setEditorDocumentPath(editorView, result.path);
        if (formatChanged) void setEditorFormat(editorView, result.format);
      }
      errorMessage = null;
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  function handleLossyAction(action: string): void {
    const resolve = lossyChoiceResolve;
    lossyChoiceResolve = null;
    lossyNoticeOpen = false;
    if (!resolve) return;
    if (action === "save-lossy") resolve("save-lossy");
    else if (action === "save-markdown") resolve("save-markdown");
    else resolve("cancel");
  }

  function closeLossyNotice(): void {
    const resolve = lossyChoiceResolve;
    lossyChoiceResolve = null;
    lossyNoticeOpen = false;
    resolve?.("cancel");
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
      actions.resetLossyWarning();
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
    actions.resetLossyWarning();
    formatPickerOpen = false;
    errorMessage = null;
    rebuildEditor(true);
  }

  function handleFormatSelect(format: FormatCapabilities): void {
    if (formatChoiceResolve) {
      const resolve = formatChoiceResolve;
      formatChoiceResolve = null;
      formatPickerOpen = false;
      resolve(format.id);
      return;
    }
    setDocumentFormat(format);
    actions.resetLossyWarning();
    startScreenDismissed = true;
    formatPickerOpen = false;
    // Заголовок окна пересчитается сам: он выведен из documentState, а тот
    // только что изменился. Отдельного вызова здесь быть не должно — две
    // реализации одного заголовка мы уже разводили и в меню, и в правке.
    if (editorView) {
      void setEditorFormat(editorView, format);
      editorView.focus();
    } else {
      rebuildEditor(true);
    }
  }

  async function saveDocumentAs(): Promise<boolean> {
    const previousFormat = documentState.format.id;
    const saved = await actions.saveAs(editorView);
    if (!saved) return false;
    if (editorView && documentState.path) {
      setEditorDocumentPath(editorView, documentState.path);
      if (previousFormat !== documentState.format.id) {
        void setEditorFormat(editorView, documentState.format).then(() => editorView?.focus());
      }
    } else if (previousFormat !== documentState.format.id) {
      rebuildEditor(true);
    }
    errorMessage = null;
    return true;
  }

  async function saveNow(): Promise<boolean> {
    const previousPath = documentState.path;
    const previousFormat = documentState.format.id;
    const saved = await actions.save(editorView);
    if (saved && editorView && previousPath === null && documentState.path) {
      setEditorDocumentPath(editorView, documentState.path);
      if (previousFormat !== documentState.format.id) {
        void setEditorFormat(editorView, documentState.format).then(() => editorView?.focus());
      }
    }
    return saved;
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

  function isTabDirty(tab: WorkspaceTab): boolean {
    const doc = tab.document;
    if (doc.readonly || !doc.format.editable) return false;
    if (doc.path === null) {
      return doc.dirty && doc.text.length > 0;
    }
    return doc.dirty;
  }

  function getTabsRequiringPrompt(): WorkspaceTab[] {
    return workspace.tabs.filter((tab) => isTabDirty(tab));
  }

  function needsClosePrompt(): boolean {
    return getTabsRequiringPrompt().length > 0;
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

  async function handleNativeCloseRequest(): Promise<void> {
    nativeClosePending = true;
    if (closeAfterDecision) {
      closeAfterDecision = false;
      await respondToNativeClose(true);
      return;
    }
    if (closePromptOpen) {
      closeRequestSource = "native";
      return;
    }
    if (autosaveController) {
      for (const tab of workspace.tabs) {
        if (
          tab.document.path !== null &&
          tab.document.dirty &&
          tab.document.format.autosave &&
          !tab.document.readonly &&
          settingsState.settings?.files?.autosave !== false
        ) {
          await autosaveController.flush(true, tab.id);
        }
      }
    }
    const dirtyTabs = getTabsRequiringPrompt();
    if (dirtyTabs.length === 0) {
      await respondToNativeClose(true);
      return;
    }
    closeRequestSource = "native";
    pendingCloseTabId = null;
    closePromptTabs = dirtyTabs;
    closePromptOpen = true;
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
    if (autosaveController) {
      for (const tab of workspace.tabs) {
        if (
          tab.document.path !== null &&
          tab.document.dirty &&
          tab.document.format.autosave &&
          !tab.document.readonly &&
          settingsState.settings?.files?.autosave !== false
        ) {
          await autosaveController.flush(true, tab.id);
        }
      }
    }
    const dirtyTabs = getTabsRequiringPrompt();
    if (dirtyTabs.length === 0) {
      await closeWindowAfterDecision();
      return;
    }
    closeRequestSource = "menu";
    pendingCloseTabId = null;
    closePromptTabs = dirtyTabs;
    closePromptOpen = true;
  }

  function handleOpenNewTab(): void {
    if (editorView) {
      tabEditorStates.set(workspace.activeId, editorView.state);
    }
    const newId = openTab();
    startScreenDismissed = false;
    if (editorView) {
      const tab = activeTab();
      const newState = createEditorState(editorView, {
        doc: tab.document.text,
        format: tab.document.format,
        path: tab.document.path,
      });
      tabEditorStates.set(newId, newState);
      setEditorState(editorView, newState);
      editorView.focus();
    } else {
      rebuildEditor(true);
    }
  }

  function handleSelectTab(id: TabId): void {
    if (id === workspace.activeId) return;
    if (editorView) {
      tabEditorStates.set(workspace.activeId, editorView.state);
    }
    activateTab(id);
    const tab = activeTab();
    startScreenDismissed = tab.document.path !== null || tab.document.text.length > 0;
    if (editorView) {
      let nextState = tabEditorStates.get(id);
      if (!nextState) {
        nextState = createEditorState(editorView, {
          doc: tab.document.text,
          format: tab.document.format,
          path: tab.document.path,
        });
        tabEditorStates.set(id, nextState);
      }
      setEditorState(editorView, nextState);
      editorView.focus();
    }
  }

  async function handleCloseTab(id: TabId): Promise<void> {
    const tab = workspace.tabs.find((t) => t.id === id);
    if (!tab) return;

    if (workspace.tabs.length <= 1) {
      await requestClose();
      return;
    }

    if (
      tab.document.path !== null &&
      tab.document.dirty &&
      tab.document.format.autosave &&
      !tab.document.readonly &&
      settingsState.settings?.files?.autosave !== false
    ) {
      await autosaveController?.flush(true, id);
    }

    if (isTabDirty(tab)) {
      handleSelectTab(id);
      pendingCloseTabId = id;
      closePromptTabs = [tab];
      closeRequestSource = "tab";
      closePromptOpen = true;
      return;
    }

    tabEditorStates.delete(id);
    const wasActive = workspace.activeId === id;
    closeTab(id);
    if (wasActive && editorView) {
      const nextTab = activeTab();
      let nextState = tabEditorStates.get(nextTab.id);
      if (!nextState) {
        nextState = createEditorState(editorView, {
          doc: nextTab.document.text,
          format: nextTab.document.format,
          path: nextTab.document.path,
        });
        tabEditorStates.set(nextTab.id, nextState);
      }
      setEditorState(editorView, nextState);
      editorView.focus();
    }
  }

  async function handleCloseChoice(choice: CloseChoice): Promise<void> {
    const tabToClose = pendingCloseTabId;
    const tabsToProcess = closePromptTabs.length > 0
      ? [...closePromptTabs]
      : (tabToClose ? [workspace.tabs.find((t) => t.id === tabToClose)].filter(Boolean) as WorkspaceTab[] : []);
    const source = closeRequestSource;

    if (choice === "cancel") {
      closePromptOpen = false;
      closeRequestSource = null;
      pendingCloseTabId = null;
      closePromptTabs = [];
      if (source === "native") await respondToNativeClose(false);
      return;
    }

    if (choice === "save") {
      closePromptOpen = false;
      for (const tab of tabsToProcess) {
        handleSelectTab(tab.id);
        await tick();
        const saved = tab.document.path === null ? await saveDocumentAs() : await saveNow();
        if (!saved) {
          closeRequestSource = null;
          pendingCloseTabId = null;
          closePromptTabs = [];
          if (source === "native") await respondToNativeClose(false);
          return;
        }
      }
    }

    closePromptOpen = false;
    closeRequestSource = null;
    pendingCloseTabId = null;
    closePromptTabs = [];

    if (source === "tab" && tabToClose) {
      tabEditorStates.delete(tabToClose);
      const wasActive = workspace.activeId === tabToClose;
      closeTab(tabToClose);
      if (wasActive && editorView) {
        const nextTab = activeTab();
        let nextState = tabEditorStates.get(nextTab.id);
        if (!nextState) {
          nextState = createEditorState(editorView, {
            doc: nextTab.document.text,
            format: nextTab.document.format,
            path: nextTab.document.path,
          });
          tabEditorStates.set(nextTab.id, nextState);
        }
        setEditorState(editorView, nextState);
        editorView.focus();
      }
      return;
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
    if (action.startsWith("format.") || action === "edit.pastePlainText") {
      handleMenuAction(action);
      return;
    }

    switch (action) {
      case "cut": clipboard("cut"); break;
      case "copy": clipboard("copy"); break;
      case "paste": clipboard("paste"); break;
      case "delete": runEditor((view) => { if (!view.state.selection.main.empty) view.dispatch(view.state.replaceSelection("")); return true; }); break;
      case "select-all": runEditor(selectAll); break;
      case "bold": void actions.run("format.bold"); break;
      case "italic": void actions.run("format.italic"); break;
      case "code": void actions.run("format.code"); break;
      case "strikethrough": void actions.run("format.strikethrough"); break;
      case "highlight": void actions.run("format.highlight"); break;
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
      case "insert-code-block": void actions.run("format.codeBlock"); break;
      case "insert-math-block": insertText("$$\n\n$$\n"); break;
      case "insert-hr": insertText("\n---\n"); break;
    }
  }

  function handleMenuAction(id: string): void {
    if (id.startsWith("file.new.")) {
      const format = formatsState.items.find((item) => item.id === id.slice("file.new.".length));
      if (format) void actions.newDocument(format.id);
      return;
    }
    switch (id) {
      case "file.newWindow": void actions.newDocument(); break;
      case "file.newTab": handleOpenNewTab(); break;
      case "file.open": void pickFile(); break;
      case "file.save": void saveNow(); break;
      case "file.saveAs": void saveDocumentAs(); break;
      case "file.close":
        if (workspace.tabs.length > 1) {
          void handleCloseTab(workspace.activeId);
        } else {
          void requestClose();
        }
        break;
      case "file.settings": void actions.run(id); break;
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
      case "format.bold":
      case "format.italic":
      case "format.strikethrough":
      case "format.highlight":
      case "format.code":
      case "format.codeBlock":
      case "format.jsonValidate":
      case "format.jsonFormat":
        void actions.run(id);
        break;
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
      case "format.mathBlock": insertText("$$\n\n$$\n"); break;
      case "format.horizontalRule": insertText("\n---\n"); break;
      case "view.zoomIn": void actions.run("view.zoomIn"); break;
      case "view.zoomOut": void actions.run("view.zoomOut"); break;
      case "view.resetZoom": void actions.run("view.resetZoom"); break;
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

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (closePromptOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        void handleCloseChoice("cancel");
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === "Comma") {
      event.preventDefault();
      settingsOpen = true;
    } else if ((event.ctrlKey || event.metaKey) && event.code === "KeyT") {
      event.preventDefault();
      handleOpenNewTab();
    } else if ((event.ctrlKey || event.metaKey) && event.code === "KeyW") {
      event.preventDefault();
      if (workspace.tabs.length > 1) {
        void handleCloseTab(workspace.activeId);
      } else {
        void requestClose();
      }
    }
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
      void getCurrentWindow()
        .setTitle(currentTitle)
        // Ошибку показываем, а не глотаем: именно молчаливый catch скрывал,
        // что у окна не было разрешения на смену заголовка и в панели задач
        // все окна назывались одинаково.
        .catch((error) => console.error("Не удалось задать заголовок окна", error));
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
    // Настройки грузятся сами при импорте модуля и приходят из Rust уже после
    // того, как редактор поднялся на умолчаниях. Дальше этот эффект держит
    // редактор в согласии с окном настроек: переключатель перенастраивает
    // отсек, а не пересоздаёт редактор.
    // Читаем settings до проверки готовности, чтобы эффект подписался на
    // изменения и после первой загрузки: Svelte отслеживает то, что прочитано.
    const settings = settingsState.settings;
    const ready = settingsState.ready;
    const view = editorView;
    if (view && ready) applyEditorSettings(view, settings);
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
        const currentWindow = getCurrentWindow();
        unlistenNativeClose = await currentWindow.listen("save-before-close", handleNativeCloseRequest);
        nativeCloseReady = true;
        unlistenOpen = await currentWindow.listen<OpenFileRequest>("open-file-request", ({ payload }) => {
          if (payload?.path) void openFile(payload.path);
        });
        unlistenNativeDrop = await currentWindow.listen<{ paths?: string[] }>("tauri://drag-drop", ({ payload }) => {
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
        const pendingFormat = await invoke<string | null>("take_pending_format");
        if (pendingFormat) {
          try {
            const created = await invoke<NewDocument>("new_document", { formatId: pendingFormat });
            resetDocument(created.format, created.text);
            startScreenDismissed = true;
            rebuildEditor(true);
          } catch (error) {
            reportError(error);
          }
        }
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

<svelte:window onkeydown={handleWindowKeydown} />

<svelte:head>
  <title>{title}</title>
</svelte:head>

<div class="app-shell" inert={!nativeCloseReady} aria-busy={!nativeCloseReady}>
  <TitleBar title={title} onClose={() => void requestClose()} onError={reportError} />

  <div class="menu-row">
    <MenuBar
      formats={formatsState.items}
      {menuState}
      title={documentLabel}
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

  <TabBar
    onNewTab={handleOpenNewTab}
    onSelectTab={handleSelectTab}
    onCloseTab={(id) => void handleCloseTab(id)}
  />

  <div class="notice-row">
    {#if documentState.externalChange === "changed"}
      <Notice
        preset="file-changed"
        onAction={(action) => action === "reload" ? void reloadExternalFile() : keepMine()}
      />
    {:else if documentState.externalChange === "deleted"}
      <Notice preset="file-deleted" onAction={(action) => action === "save" ? void saveNow() : undefined} />
    {:else if lossyNoticeOpen}
      <Notice preset="lossy-warning" onAction={handleLossyAction} onClose={closeLossyNotice} />
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
      <div class="notice" role="alert" aria-label={errorMessage}>{errorMessage}</div>
    {/if}
  </main>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="status-area"
    role="region"
    aria-label={showStartScreen
      ? t("status.bar")
      : t("document.formatChars", {
          format: formatLabel(documentState.format.id, documentState.format.label),
          count: stats.chars,
        })}
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
    <StatusBar format={documentState.format} {stats} showFormat={!showStartScreen} />
    {#if formatPickerOpen}
      <div class="format-picker-popover">
        <FormatPicker
          mode="list"
          formats={formatsState.items}
          selectedId={documentState.format.id}
          onSelect={handleFormatSelect}
          onClose={() => {
            formatPickerOpen = false;
            formatChoiceResolve?.(null);
            formatChoiceResolve = null;
          }}
        />
      </div>
    {/if}
  </div>

  <ContextMenu editable={!isReadOnly} formatId={documentState.format.id} onSelect={handleContextMenuAction} />

  {#if helpMode}
    <HelpDialog mode={helpMode} onClose={() => (helpMode = null)} />
  {/if}

  {#if settingsOpen}
    <SettingsWindow
      {editorView}
      onClose={() => (settingsOpen = false)}
      onFocusEditor={() => editorView?.focus()}
    />
  {/if}

  {#if closePromptOpen}
    <div class="modal-backdrop">
      <div class="close-dialog" role="dialog" aria-modal="true" aria-labelledby="close-dialog-title">
        <h2 id="close-dialog-title">{t("dialog.close.title")}</h2>
        <p>{closePromptMessage}</p>
        {#if closePromptTabs.length > 1}
          <ul class="close-dialog-tabs">
            {#each closePromptTabs as tab (tab.id)}
              <li>{getTabDisplayName(tab)}</li>
            {/each}
          </ul>
        {/if}
        <div class="close-dialog-actions">
          <button type="button" class="primary" onclick={() => void handleCloseChoice("save")}>{t("dialog.close.save")}</button>
          <button type="button" onclick={() => void handleCloseChoice("discard")}>{t("dialog.close.discard")}</button>
          <button type="button" onclick={() => void handleCloseChoice("cancel")}>{t("dialog.close.cancel")}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if goToLineOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-backdrop" onclick={(event) => event.currentTarget === event.target && (goToLineOpen = false)}>
      <div class="close-dialog goto-line-dialog" role="dialog" aria-modal="true" aria-labelledby="goto-line-title">
        <h2 id="goto-line-title">{t("help.action.goToLine")}</h2>
        <label for="goto-line-input">{t("goToLine.lineNumber")}</label>
        <input
          id="goto-line-input"
          bind:this={goToLineInput}
          bind:value={goToLineValue}
          type="number"
          min="1"
          step="1"
          inputmode="numeric"
          onkeydown={handleGoToLineKeydown}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .app-shell {
    display: grid;
    grid-template-rows: auto auto auto auto minmax(0, 1fr) auto;
    height: 100vh;
    overflow: hidden;
    background: var(--bg-primary);
  }

  .menu-row {
    position: relative;
    min-width: 0;
  }

  :global(.menu-row .menu-tabs) { order: 0; }
  :global(.menu-row .window-title) {
    order: 1;
    margin-inline-start: 8px;
    margin-inline-end: 0;
  }

  /* MenuBar has a legacy fallback; the shared component below owns the save state. */
  :global(.menu-row > .menu-bar > .save-controls) { display: none; }

  .save-controls-overlay {
    position: absolute;
    top: 0;
    inset-inline-end: 12px;
    z-index: 25;
    display: flex;
    align-items: center;
    height: calc(var(--menubar-height) - 1px);
    padding-inline-start: 8px;
    background: var(--bg-secondary);
  }


  .editor-stage {
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-primary);
    outline: none;
  }

  .editor-stage:focus,
  .editor-stage:focus-visible {
    outline: none;
  }

  .notice-row {
    min-width: 0;
  }

  .editor-host {
    height: 100%;
    overflow: hidden;
    outline: none;
  }

  .editor-host:focus,
  .editor-host:focus-visible {
    outline: none;
  }

  .status-area {
    position: relative;
    z-index: 15;
  }

  .format-picker-popover {
    position: absolute;
    bottom: calc(var(--statusbar-height) + 4px);
    inset-inline-start: 8px;
    z-index: 40;
  }

  .notice {
    position: absolute;
    inset-inline-end: 16px;
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
  .close-dialog-tabs {
    margin: 0 0 18px;
    padding-inline-start: 20px;
    max-height: 160px;
    overflow-y: auto;
    color: var(--text-normal);
    font-size: var(--font-size-ui);
  }
  .close-dialog-tabs li {
    margin-bottom: 4px;
    word-break: break-all;
  }
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
  .goto-line-dialog { display: grid; gap: 8px; }
  .goto-line-dialog label { color: var(--text-muted); font-size: var(--font-size-ui); }
  .goto-line-dialog input {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 8px;
    border: 1px solid var(--bg-modifier-border);
    border-radius: var(--radius-s);
    background: var(--background-primary);
    color: var(--text-normal);
    font: inherit;
  }

  @media (max-width: 760px) {
    .save-controls-overlay { inset-inline-end: 4px; padding-inline-start: 4px; }
  }
</style>
