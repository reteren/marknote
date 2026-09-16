// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  focusChanged: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: tauri.focusChanged }),
}));

import { markdownFormat } from "../src/state/formats.svelte";
import {
  activeTab,
  activateTab,
  closeTab,
  createDocumentState,
  openTab,
  tabLabel,
  workspace,
} from "../src/state/workspace.svelte";
import {
  documentState,
  replaceDocument,
  setDocumentText,
} from "../src/state/document.svelte";
import { createAutosave } from "../src/state/autosave";

function opened(path: string, text = "initial") {
  return {
    path,
    text,
    encoding: "utf-8",
    bom: false,
    lineEnding: "lf" as const,
    format: markdownFormat,
    readonly: false,
  };
}

function resetWorkspace(): void {
  workspace.tabs.splice(0, workspace.tabs.length, {
    id: "test-tab",
    document: createDocumentState(),
  });
  workspace.activeId = "test-tab";
}

beforeEach(() => {
  vi.useFakeTimers();
  tauri.invoke.mockReset();
  tauri.listen.mockResolvedValue(() => undefined);
  tauri.focusChanged.mockResolvedValue(() => undefined);
  resetWorkspace();
  replaceDocument(opened("C:/notes/first.md"));
});

afterEach(() => {
  vi.useRealTimers();
  resetWorkspace();
});

describe("workspace tabs", () => {
  it("opens, activates, and closes tabs while preserving the final tab", () => {
    const documentView = documentState;
    const firstId = activeTab().id;
    const secondId = openTab();
    expect(workspace.tabs).toHaveLength(2);
    expect(workspace.activeId).toBe(secondId);
    setDocumentText("second tab text");
    expect(documentState.text).toBe("second tab text");
    documentState.text = "second tab direct write";
    expect(activeTab().document.text).toBe("second tab direct write");

    activateTab(firstId);
    expect(activeTab().id).toBe(firstId);
    expect(documentState.text).toBe("initial");
    expect(documentState).toBe(documentView);
    closeTab(secondId);
    expect(workspace.tabs.map((tab) => tab.id)).toEqual([firstId]);
    closeTab(firstId);
    expect(workspace.tabs).toHaveLength(1);
    expect(activeTab().id).toBe(firstId);
  });

  it("labels named files and untitled text with their format", () => {
    const namedId = activeTab().id;
    replaceDocument(opened("C:/notes/readme.md"));
    expect(tabLabel(activeTab())).toEqual({ name: "readme.md", format: "Markdown" });

    const untitledId = openTab({ text: "A short draft with words" });
    expect(untitledId).not.toBe(namedId);
    expect(tabLabel(activeTab())).toEqual({ name: "A short draft with words", format: "Markdown" });
  });
});

describe("tab-owned autosave", () => {
  it("saves a dirty inactive tab on its own timer", async () => {
    const firstId = activeTab().id;
    const secondId = openTab();
    replaceDocument(opened("C:/notes/second.md"));
    const controller = createAutosave({
      getSettings: () => ({ files: { autosave: true, autosaveDelayMs: 2_000, saveOnWindowBlur: true } } as never),
    });
    tauri.invoke.mockResolvedValue({ ...opened("C:/notes/second.md"), savedAt: "2026-09-16T00:00:00.000Z" });
    await controller.start();

    setDocumentText("edited second tab");
    activateTab(firstId);
    expect(activeTab().id).toBe(firstId);
    vi.advanceTimersByTime(1_500);
    activateTab(secondId);
    vi.advanceTimersByTime(499);
    await Promise.resolve();
    expect(tauri.invoke).not.toHaveBeenCalledWith("save_file", expect.anything());
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(tauri.invoke).toHaveBeenCalledWith("save_file", expect.objectContaining({
      path: "C:/notes/second.md",
      text: "edited second tab",
    }));
    controller.dispose();
    expect(secondId).not.toBe(firstId);
  });
});
