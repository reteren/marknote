// Файл, бро­шенный в окно, открывается ВКЛАДКОЙ в этом же окне. Сначала он
// уходил в Rust и открывал отдельное окно: владелец сказал, что окно он уже
// открыл сам и второе рядом ему не нужно.

import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  focusChanged: vi.fn(),
  handlers: new Map<string, Set<(event: { payload?: unknown }) => void>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTitle: vi.fn().mockResolvedValue(undefined),
    listen: tauri.listen,
    onFocusChanged: tauri.focusChanged,
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    setTitle: vi.fn().mockResolvedValue(undefined),
    listen: tauri.listen,
    onFocusChanged: tauri.focusChanged,
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

import App from "../../src/App.svelte";
import { markdownFormat } from "../../src/state/formats.svelte";
import { resetDocument } from "../../src/state/document.svelte";
import { workspace, createDocumentState } from "../../src/state/workspace.svelte";
import { settle } from "./helpers";

function resetWorkspace(): void {
  workspace.tabs.splice(0, workspace.tabs.length, {
    id: "tab-1",
    document: createDocumentState({ path: null, text: "" }),
  });
  workspace.activeId = "tab-1";
}

function openedFile(path: string, text: string) {
  // Rust возвращает канонический путь в длинной форме Windows, а брошенный в
  // окно приходит обычной: из-за этого один файл когда-то открывался дважды.
  const canonical = "\\\\?\\" + path.replaceAll("/", "\\");
  return { path: canonical, text, format: markdownFormat, encoding: "UTF-8", lineEnding: "LF", lossy: false };
}

async function drop(paths: string[]): Promise<void> {
  const listeners = tauri.handlers.get("tauri://drag-drop") ?? new Set();
  for (const listener of listeners) listener({ payload: { paths } });
  // Файлы открываются по очереди: каждому нужен свой круг микрозадач.
  for (let i = 0; i < 12; i += 1) await settle();
}

async function renderApp(): Promise<void> {
  tauri.handlers.clear();
  tauri.invoke.mockReset();
  tauri.focusChanged.mockResolvedValue(async () => undefined);
  tauri.listen.mockImplementation(async (name: string, handler: (event: { payload?: unknown }) => void) => {
    const handlers = tauri.handlers.get(name) ?? new Set();
    handlers.add(handler);
    tauri.handlers.set(name, handlers);
    return () => handlers.delete(handler);
  });
  tauri.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "list_creatable_formats") return [markdownFormat];
    if (command === "open_file") return openedFile(String(args?.path), "содержимое");
    if (command === "take_pending_file" || command === "take_pending_format") return null;
    if (command === "get_recent_files") return [];
    return undefined;
  });

  render(App);
  await settle();
  await settle();
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  tauri.handlers.clear();
  tauri.invoke.mockReset();
  tauri.listen.mockReset();
  resetWorkspace();
  resetDocument(markdownFormat, "");
});

describe("перетаскивание файла в окно", () => {
  it("открывает файл вкладкой, а не отдельным окном", async () => {
    resetWorkspace();
    await renderApp();

    await drop(["C:/docs/note.md"]);

    expect(tauri.invoke).toHaveBeenCalledWith("open_file", { path: "C:/docs/note.md" });
    expect(tauri.invoke).not.toHaveBeenCalledWith("open_in_new_window", expect.anything());
    expect(workspace.tabs.some((tab) => (tab.document.path ?? "").endsWith("note.md"))).toBe(true);
  });

  it("на каждый брошенный файл — своя вкладка, пустая вкладка используется первой", async () => {
    resetWorkspace();
    await renderApp();

    await drop(["C:/docs/one.md", "C:/docs/two.md"]);

    const paths = workspace.tabs.map((tab) => tab.document.path ?? "");
    expect(paths.some((path) => path.endsWith("one.md"))).toBe(true);
    expect(paths.some((path) => path.endsWith("two.md"))).toBe(true);
    // Пустая вкладка, с которой начали, занята первым файлом, а не брошена.
    expect(workspace.tabs).toHaveLength(2);
  });

  it("уже открытый файл не открывается второй раз, а показывается", async () => {
    resetWorkspace();
    await renderApp();

    await drop(["C:/docs/note.md"]);
    const tabsAfterFirst = workspace.tabs.length;
    tauri.invoke.mockClear();

    await drop(["C:/docs/note.md"]);

    expect(workspace.tabs).toHaveLength(tabsAfterFirst);
    expect(tauri.invoke).not.toHaveBeenCalledWith("open_file", { path: "C:/docs/note.md" });
  });
});
