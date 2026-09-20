// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  focusChanged: vi.fn(),
  handlers: new Map<string, Set<(event: { payload?: unknown }) => void>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: tauri.listen,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTitle: vi.fn().mockResolvedValue(undefined),
    listen: tauri.listen,
    onFocusChanged: tauri.focusChanged,
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));
// The close listener belongs to the WEBVIEW window, not the window object:
// Rust sends the event targeting webview_window, and ordinary-window listeners
// never receive it. This used to mock only getCurrentWindow; the test passed
// while the program closed without asking after five seconds. A mock must not
// be more convenient than the real mechanism, or it hides the defect.
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    setTitle: vi.fn().mockResolvedValue(undefined),
    listen: tauri.listen,
    onFocusChanged: tauri.focusChanged,
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

import App from "../../src/App.svelte";
import { documentState, resetDocument } from "../../src/state/document.svelte";
import { workspace, createDocumentState } from "../../src/state/workspace.svelte";
import { markdownFormat } from "../../src/state/formats.svelte";
import { translate as t } from "../../src/i18n";
import { formatLabel } from "../../src/i18n";

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

async function createEditedUntitled(): Promise<void> {
  const markdownTile = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.includes(formatLabel("markdown", "Markdown")) && button.textContent.includes(".md"));
  expect(markdownTile).toBeDefined();
  await fireEvent.click(markdownTile!);
  await settle();
  expect(document.querySelector(".start-screen")).toBeNull();

  const editorContent = document.querySelector<HTMLElement>(".cm-content");
  expect(editorContent).not.toBeNull();
  editorContent!.textContent = "qa-unsaved";
  await fireEvent.input(editorContent!);
  await settle();
  expect(documentState.path).toBeNull();
  expect(documentState.dirty).toBe(true);
}

describe("native close confirmation", () => {
  beforeEach(() => {
    tauri.handlers.clear();
    tauri.invoke.mockReset();
    workspace.tabs.splice(0, workspace.tabs.length, {
      id: "tab-1",
      document: createDocumentState(),
    });
    workspace.activeId = "tab-1";
    resetDocument(markdownFormat, "");
    tauri.focusChanged.mockImplementation(async () => () => undefined);
    tauri.listen.mockImplementation(async (name: string, handler: (event: { payload?: unknown }) => void) => {
      const handlers = tauri.handlers.get(name) ?? new Set();
      handlers.add(handler);
      tauri.handlers.set(name, handlers);
      return () => handlers.delete(handler);
    });
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "list_creatable_formats") return [markdownFormat];
      if (command === "new_document") return { text: "", format: markdownFormat };
      if (command === "take_pending_file") return null;
      return undefined;
    });
  });

  afterEach(() => {
    cleanup();
    workspace.tabs.splice(0, workspace.tabs.length, {
      id: "tab-1",
      document: createDocumentState(),
    });
    workspace.activeId = "tab-1";
  });

  it("keeps an edited untitled document open on save-before-close until a choice is made", async () => {
    render(App);
    await settle();
    await createEditedUntitled();
    expect(documentState.path).toBeNull();
    expect(documentState.dirty).toBe(true);

    for (const handler of tauri.handlers.get("save-before-close") ?? []) handler({ payload: {} });
    await settle();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(t("dialog.close.title"));
    expect(tauri.invoke).not.toHaveBeenCalledWith("respond_to_close", expect.anything());
  });

  it("keeps the editor inert until the native close listener is installed", async () => {
    let finishRegistration: (() => void) | undefined;
    tauri.listen.mockImplementation((name: string, handler: (event: { payload?: unknown }) => void) => {
      if (name === "save-before-close") {
        return new Promise<() => void>((resolve) => {
          finishRegistration = () => {
            const handlers = tauri.handlers.get(name) ?? new Set();
            handlers.add(handler);
            tauri.handlers.set(name, handlers);
            resolve(() => handlers.delete(handler));
          };
        });
      }
      const handlers = tauri.handlers.get(name) ?? new Set();
      handlers.add(handler);
      tauri.handlers.set(name, handlers);
      return Promise.resolve(() => handlers.delete(handler));
    });
    render(App);
    await settle();

    const shell = document.querySelector<HTMLElement>(".app-shell");
    expect(shell?.getAttribute("aria-busy")).toBe("true");
    expect(tauri.handlers.has("save-before-close")).toBe(false);

    finishRegistration?.();
    await settle();

    expect(shell?.getAttribute("aria-busy")).toBe("false");
    expect(tauri.handlers.has("save-before-close")).toBe(true);
  });

  it("hides the format in the status bar until a document format is selected", async () => {
    render(App);
    await settle();

    expect(document.querySelector(".start-screen")).not.toBeNull();
    expect(document.querySelector(".status-bar .format-info")).toBeNull();
    expect(document.querySelector(".status-area")?.getAttribute("aria-label")).toBe(t("status.bar"));

    const markdownTile = document.querySelector<HTMLButtonElement>(".start-screen [role='grid'] .tile");
    expect(markdownTile?.textContent).toContain(formatLabel("markdown", "Markdown"));
    await fireEvent.click(markdownTile!);
    await settle();

    expect(document.querySelector(".start-screen")).toBeNull();
    expect(document.querySelector(".status-bar .format-info")?.textContent).toContain(formatLabel("markdown", "Markdown"));
  });

  it("opens Settings from File and Ctrl+, and closes it with Escape", async () => {
    render(App);
    await settle();

    const fileButton = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menubar"] button'))
      .find((button) => button.textContent?.trim() === t("menu.file"));
    expect(fileButton).toBeDefined();
    await fireEvent.click(fileButton!);
    await settle();

    const settingsItem = document.querySelector<HTMLButtonElement>('[data-menu-item-id="file.settings"]');
    expect(settingsItem).not.toBeNull();
    expect(settingsItem?.textContent).toContain(t("menu.settings"));
    await fireEvent.click(settingsItem!);
    await settle();
    await vi.dynamicImportSettled();
    await settle();

    let settingsDialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Settings"]');
    expect(settingsDialog).not.toBeNull();
    await fireEvent.keyDown(settingsDialog!, { key: "Escape" });
    await settle();
    expect(document.querySelector('[role="dialog"][aria-label="Settings"]')).toBeNull();

    await fireEvent.keyDown(window, { code: "Comma", key: ",", ctrlKey: true });
    await settle();
    await vi.dynamicImportSettled();
    await settle();
    settingsDialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Settings"]');
    expect(settingsDialog).not.toBeNull();
    await fireEvent.keyDown(settingsDialog!, { key: "Escape" });
    await settle();
    expect(document.querySelector('[role="dialog"][aria-label="Settings"]')).toBeNull();
  });

  it("autosaves a dirty named document before closing without asking", async () => {
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "list_creatable_formats") return [markdownFormat];
      if (command === "take_pending_file") return null;
      if (command === "open_file") {
        return {
          path: "C:/notes/draft.md",
          text: "original",
          encoding: "utf-8",
          bom: false,
          lineEnding: "lf",
          format: markdownFormat,
          readonly: false,
        };
      }
      if (command === "save_file") {
        return { path: "C:/notes/draft.md", savedAt: "2026-09-15T00:00:00.000Z", format: markdownFormat };
      }
      return undefined;
    });
    render(App);
    await settle();

    for (const handler of tauri.handlers.get("open-file-request") ?? []) {
      handler({ payload: { path: "C:/notes/draft.md" } });
    }
    await settle();
    const editorContent = document.querySelector<HTMLElement>(".cm-content");
    expect(editorContent).not.toBeNull();
    editorContent!.textContent = "edited on disk-backed doc";
    await fireEvent.input(editorContent!);
    await settle();
    expect(documentState.dirty).toBe(true);

    for (const handler of tauri.handlers.get("save-before-close") ?? []) handler({ payload: {} });
    await settle();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(tauri.invoke).toHaveBeenCalledWith("save_file", expect.objectContaining({
      path: "C:/notes/draft.md",
      text: "edited on disk-backed doc",
    }));
    expect(tauri.invoke).toHaveBeenCalledWith("respond_to_close", { allow: true });
  });

  it.each([
    [t("dialog.close.save"), true],
    [t("dialog.close.discard"), true],
    [t("dialog.close.cancel"), false],
  ] as const)("handles the %s choice for an untitled dirty document", async (choice, allowed) => {
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "list_creatable_formats") return [markdownFormat];
      if (command === "new_document") return { text: "", format: markdownFormat };
      if (command === "take_pending_file") return null;
      if (command === "save_as") {
        return { path: "C:/notes/qa-unsaved.md", savedAt: "2026-09-15T00:00:00.000Z", format: markdownFormat };
      }
      return undefined;
    });
    render(App);
    await settle();
    await createEditedUntitled();

    for (const handler of tauri.handlers.get("save-before-close") ?? []) handler({ payload: {} });
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(tauri.invoke).not.toHaveBeenCalledWith("respond_to_close", expect.anything());

    const choiceButton = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent?.trim() === choice);
    expect(choiceButton).toBeDefined();
    await fireEvent.click(choiceButton!);
    await settle();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(tauri.invoke).toHaveBeenCalledWith("respond_to_close", { allow: allowed });
    if (choice === t("dialog.close.save")) {
      expect(tauri.invoke).toHaveBeenCalledWith("save_as", expect.objectContaining({ text: "qa-unsaved" }));
      expect(documentState.dirty).toBe(false);
      expect(documentState.path).toBe("C:/notes/qa-unsaved.md");
    } else {
      expect(tauri.invoke).not.toHaveBeenCalledWith("save_as", expect.anything());
    }
    if (choice === t("dialog.close.cancel")) {
      expect(documentState.dirty).toBe(true);
      expect(documentState.text).toBe("qa-unsaved");
    }
  });

  it("asks before closing a dirty tab, and cancel leaves the tab in place", async () => {
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "list_creatable_formats") return [markdownFormat];
      if (command === "new_document") return { text: "", format: markdownFormat };
      if (command === "take_pending_file") return null;
      return undefined;
    });
    render(App);
    await settle();
    await createEditedUntitled();

    await fireEvent.keyDown(window, { code: "KeyT", key: "t", ctrlKey: true });
    await settle();
    expect(workspace.tabs).toHaveLength(2);

    const secondTabId = workspace.activeId;
    const editorContent = document.querySelector<HTMLElement>(".cm-content");
    expect(editorContent).not.toBeNull();
    editorContent!.textContent = "second-tab-unsaved";
    await fireEvent.input(editorContent!);
    await settle();
    expect(workspace.tabs.find((t) => t.id === secondTabId)?.document.dirty).toBe(true);

    const closeButtons = document.querySelectorAll<HTMLButtonElement>(".tab-close-btn");
    expect(closeButtons.length).toBe(2);
    await fireEvent.click(closeButtons[1]!);
    await settle();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(t("dialog.close.title"));

    const cancelButton = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent?.trim() === t("dialog.close.cancel"));
    expect(cancelButton).toBeDefined();
    await fireEvent.click(cancelButton!);
    await settle();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(workspace.tabs).toHaveLength(2);
    expect(workspace.tabs.find((t) => t.id === secondTabId)?.document.text).toBe("second-tab-unsaved");
    expect(workspace.tabs.find((t) => t.id === secondTabId)?.document.dirty).toBe(true);
  });

  it("closes only the target tab when discard is chosen for that tab", async () => {
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "list_creatable_formats") return [markdownFormat];
      if (command === "new_document") return { text: "", format: markdownFormat };
      if (command === "take_pending_file") return null;
      return undefined;
    });
    render(App);
    await settle();
    await createEditedUntitled();

    await fireEvent.keyDown(window, { code: "KeyT", key: "t", ctrlKey: true });
    await settle();
    expect(workspace.tabs).toHaveLength(2);

    const firstTabId = workspace.tabs[0]!.id;
    const secondTabId = workspace.tabs[1]!.id;
    const editorContent = document.querySelector<HTMLElement>(".cm-content");
    editorContent!.textContent = "second-tab-unsaved";
    await fireEvent.input(editorContent!);
    await settle();

    const closeButtons = document.querySelectorAll<HTMLButtonElement>(".tab-close-btn");
    await fireEvent.click(closeButtons[1]!);
    await settle();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const discardButton = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent?.trim() === t("dialog.close.discard"));
    expect(discardButton).toBeDefined();
    await fireEvent.click(discardButton!);
    await settle();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(workspace.tabs).toHaveLength(1);
    expect(workspace.tabs[0]!.id).toBe(firstTabId);
    expect(workspace.tabs[0]!.document.text).toBe("qa-unsaved");
  });

  it("closing a window with multiple dirty tabs shows aggregated dialog listing all dirty tabs, and cancel keeps all tabs", async () => {
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "list_creatable_formats") return [markdownFormat];
      if (command === "new_document") return { text: "", format: markdownFormat };
      if (command === "take_pending_file") return null;
      return undefined;
    });
    render(App);
    await settle();
    await createEditedUntitled();

    await fireEvent.keyDown(window, { code: "KeyT", key: "t", ctrlKey: true });
    await settle();
    const editorContent = document.querySelector<HTMLElement>(".cm-content");
    editorContent!.textContent = "second-tab-unsaved";
    await fireEvent.input(editorContent!);
    await settle();

    for (const handler of tauri.handlers.get("save-before-close") ?? []) handler({ payload: {} });
    await settle();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(t("dialog.close.title"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(t("dialog.close.unsavedMultiple"));
    const tabListItems = document.querySelectorAll(".close-dialog-tabs li");
    expect(tabListItems.length).toBe(2);
    expect(tauri.invoke).not.toHaveBeenCalledWith("respond_to_close", expect.anything());

    const cancelButton = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent?.trim() === t("dialog.close.cancel"));
    expect(cancelButton).toBeDefined();
    await fireEvent.click(cancelButton!);
    await settle();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(tauri.invoke).toHaveBeenCalledWith("respond_to_close", { allow: false });
    expect(workspace.tabs).toHaveLength(2);
    expect(workspace.tabs[0]!.document.text).toBe("qa-unsaved");
    expect(workspace.tabs[1]!.document.text).toBe("second-tab-unsaved");
  });

  it("closing the window with two dirty tabs and saving stops and preserves unsaved tab if save is cancelled", async () => {
    let saveAsCount = 0;
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "list_creatable_formats") return [markdownFormat];
      if (command === "new_document") return { text: "", format: markdownFormat };
      if (command === "take_pending_file") return null;
      if (command === "save_as") {
        saveAsCount += 1;
        if (saveAsCount === 1) {
          return { path: "C:/notes/first.md", savedAt: "2026-09-16T00:00:00.000Z", format: markdownFormat };
        }
        return null;
      }
      return undefined;
    });
    render(App);
    await settle();
    await createEditedUntitled();

    await fireEvent.keyDown(window, { code: "KeyT", key: "t", ctrlKey: true });
    await settle();
    const editorContent = document.querySelector<HTMLElement>(".cm-content");
    editorContent!.textContent = "second-tab-unsaved";
    await fireEvent.input(editorContent!);
    await settle();

    for (const handler of tauri.handlers.get("save-before-close") ?? []) handler({ payload: {} });
    await settle();

    const saveButton = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent?.trim() === t("dialog.close.save"));
    await fireEvent.click(saveButton!);
    for (let index = 0; index < 50; index += 1) await Promise.resolve();

    expect(tauri.invoke).toHaveBeenCalledWith("respond_to_close", { allow: false });
    expect(workspace.tabs).toHaveLength(2);
    expect(workspace.tabs[0]!.document.path).toBe("C:/notes/first.md");
    expect(workspace.tabs[0]!.document.dirty).toBe(false);
    expect(workspace.tabs[1]!.document.path).toBeNull();
    expect(workspace.tabs[1]!.document.dirty).toBe(true);
    expect(workspace.tabs[1]!.document.text).toBe("second-tab-unsaved");
  });

  it("closing the last remaining tab triggers window close confirmation", async () => {
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "list_creatable_formats") return [markdownFormat];
      if (command === "new_document") return { text: "", format: markdownFormat };
      if (command === "take_pending_file") return null;
      return undefined;
    });
    render(App);
    await settle();
    await createEditedUntitled();
    expect(workspace.tabs).toHaveLength(1);

    await fireEvent.keyDown(window, { code: "KeyW", key: "w", ctrlKey: true });
    await settle();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(t("dialog.close.title"));

    const cancelButton = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent?.trim() === t("dialog.close.cancel"));
    expect(cancelButton).toBeDefined();
    await fireEvent.click(cancelButton!);
    await settle();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(workspace.tabs).toHaveLength(1);
    expect(workspace.tabs[0]!.document.dirty).toBe(true);
    expect(workspace.tabs[0]!.document.text).toBe("qa-unsaved");
  });
});
