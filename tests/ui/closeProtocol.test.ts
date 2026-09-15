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

import App from "../../src/App.svelte";
import { documentState, resetDocument } from "../../src/state/document.svelte";
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

  afterEach(() => cleanup());

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
});
