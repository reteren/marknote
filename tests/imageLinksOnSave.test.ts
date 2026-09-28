import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

import { documentState, resetDocument } from "../src/state/document.svelte";
import { createActions } from "../src/state/actions";
import { markdownFormat } from "../src/state/formats.svelte";

describe("saving leaves image links alone", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
  });

  it("does not move images or rewrite links when a new document is saved", async () => {
    const text = "Hello ![Pic](marknote-images/pic.png) and ![Old](marknote-cache/old.gif)";
    resetDocument(markdownFormat, text);
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "save_as") {
        return { path: "C:\notes\doc.md", savedAt: new Date().toISOString(), format: markdownFormat };
      }
      return null;
    });

    const notify = vi.fn();
    const actions = createActions({ state: documentState, notify });
    expect(await actions.saveAs()).toBe(true);

    const commands = tauri.invoke.mock.calls.map(([command]) => command);
    expect(commands).toEqual(["save_as"]);
    expect(documentState.text).toBe(text);
    expect(documentState.dirty).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});
