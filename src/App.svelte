<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { onMount } from "svelte";
  import { createEditor, type EditorStats } from "./editor/createEditor";
  import { createAutosave, saveAs } from "./state/autosave";
  import {
    documentState,
    markSaved,
    replaceDocument,
    setDocumentText,
    type OpenedFile,
    type SaveResult,
  } from "./state/document.svelte";
  import { formatsState, loadCreatableFormats } from "./state/formats.svelte";
  import MenuBar from "./ui/MenuBar.svelte";
  import StartScreen from "./ui/StartScreen.svelte";
  import StatusBar from "./ui/StatusBar.svelte";
  import type { EditorView } from "@codemirror/view";

  type OpenFileRequest = { path: string };

  let editorHost: HTMLDivElement | undefined = $state();
  let editorView: EditorView | null = null;
  let autosaveController: ReturnType<typeof createAutosave> | null = null;
  let openingPathKey: string | null = null;
  let stats = $state<EditorStats>({
    line: 1,
    col: 1,
    lines: 1,
    words: 0,
    chars: 0,
    selection: null,
  });
  let errorMessage = $state<string | null>(null);

  const title = $derived(
    `${documentState.path ? documentState.path.split(/[\\/]/u).pop() || documentState.path : `Untitled.${documentState.format.defaultExtension}`} — MarkNote`,
  );
  const showStartScreen = $derived(documentState.path === null && documentState.text.length === 0);

  function pathKey(path: string): string {
    return path.replaceAll("/", "\\").toLowerCase();
  }

  function rebuildEditor(): void {
    if (!editorHost) return;
    editorView?.destroy();
    editorView = createEditor({
      parent: editorHost,
      doc: documentState.text,
      format: documentState.format,
      onChange: (text) => {
        setDocumentText(text);
        autosaveController?.schedule();
      },
      onStats: (nextStats) => {
        stats = nextStats;
      },
    });
  }

  async function openFile(path: string): Promise<void> {
    if (!path) return;
    const requestedPathKey = pathKey(path);
    if (
      openingPathKey === requestedPathKey ||
      (documentState.path !== null && pathKey(documentState.path) === requestedPathKey)
    ) {
      return;
    }
    openingPathKey = requestedPathKey;
    try {
      const opened = await invoke<OpenedFile>("open_file", { path });
      replaceDocument(opened);
      errorMessage = null;
      rebuildEditor();
      editorView?.focus();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      if (openingPathKey === requestedPathKey) openingPathKey = null;
    }
  }

  async function saveNow(): Promise<void> {
    if (documentState.path === null) {
      await saveDocumentAs();
      return;
    }
    await autosaveController?.flush(true);
  }

  async function saveDocumentAs(): Promise<void> {
    const extension = documentState.format.defaultExtension;
    const suggestedName = documentState.path?.split(/[\\/]/u).pop() ?? `Untitled.${extension}`;
    try {
      const result = await saveAs(documentState, suggestedName);
      if (result) {
        markSaved(result, documentState.text);
        errorMessage = null;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
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

  onMount(() => {
    let disposed = false;
    let unlistenOpen: UnlistenFn | undefined;
    autosaveController = createAutosave({
      onError: (error) => {
        errorMessage = error instanceof Error ? error.message : String(error);
      },
    });
    void autosaveController.start();
    rebuildEditor();

    const setup = async (): Promise<void> => {
      try {
        unlistenOpen = await listen<OpenFileRequest>("open-file-request", ({ payload }) => {
          if (payload?.path) void openFile(payload.path);
        });
        if (disposed) {
          unlistenOpen();
          return;
        }
        const pendingPath = await invoke<string | null>("take_pending_file");
        if (pendingPath) void openFile(pendingPath);
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      void loadCreatableFormats();
    };
    void setup();

    return () => {
      disposed = true;
      unlistenOpen?.();
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
  <MenuBar
    {title}
    saveStatus={documentState.saveStatus}
    lastSavedAt={documentState.lastSavedAt}
    onSave={saveNow}
    onSaveAs={saveDocumentAs}
  />

  <main class="editor-stage">
    <div class="editor-host" bind:this={editorHost}></div>
    {#if showStartScreen}
      <StartScreen formats={formatsState.items} />
    {/if}
    {#if errorMessage}
      <div class="notice" role="status">{errorMessage}</div>
    {/if}
  </main>

  <StatusBar format={documentState.format} {stats} />
</div>

<style>
  .app-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    height: 100vh;
    overflow: hidden;
    background: var(--bg-primary);
  }

  .editor-stage {
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-primary);
  }

  .editor-host {
    height: 100%;
    overflow: hidden;
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
</style>
