import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import FindPanel from "../../src/ui/FindPanel.svelte";
import { settle } from "./helpers";

afterEach(() => cleanup());

const searchMock = vi.hoisted(() => ({
  findNext: vi.fn(),
  findPrevious: vi.fn(),
  replaceNext: vi.fn(),
  replaceAll: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@codemirror/search", () => ({
  setSearchQuery: { of: (query: unknown) => query },
  openSearchPanel: vi.fn(),
}));

vi.mock("../../src/editor/search", () => ({
  createSearchQuery: (config: { search: string; regexp?: boolean; replace?: string; caseSensitive?: boolean; wholeWord?: boolean }) => ({
    ...config,
    valid: !config.regexp || !/[([*+?\\]$/u.test(config.search),
  }),
  getInitialSearchText: () => null,
  getRegExpError: (source: string) => (/[([*+?\\]$/u.test(source) ? "Invalid regular expression" : null),
  isValidRegExp: (source: string) => !/[([*+?\\]$/u.test(source),
  getSearchStats: (state: FakeView["state"], query: { search: string; valid: boolean }) => {
    if (!query.search || !query.valid) return { total: 0, current: 0 };
    const total = query.search === "alpha" ? 2 : 0;
    const current = state.selection.main.from === 0 && state.selection.main.to === 5 ? 1
      : state.selection.main.from === 11 && state.selection.main.to === 16 ? 2 : 0;
    return { total, current };
  },
  searchCommands: searchMock,
  SEARCH_CLOSE_EVENT: "marknote:search-close",
  SEARCH_OPEN_EVENT: "marknote:search-open",
}));

type FakeView = {
  state: {
    doc: string;
    selection: { main: { from: number; to: number } };
  };
  dispatch: (transaction: unknown) => void;
  focus: () => void;
};

function createView(): EditorView {
  const state = {
    doc: "alpha beta alpha",
    selection: { main: { from: 0, to: 0 } },
  };
  const view: FakeView = {
    state,
    dispatch: () => undefined,
    focus: () => undefined,
  };
  return view as unknown as EditorView;
}

describe("FindPanel interaction contract", () => {
  it("opens Find and Replace from Ctrl+F/Ctrl+H and closes with Escape", async () => {
    const view = createView();
    const onClose = vi.fn();
    render(FindPanel, { props: { view, onClose } });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }));
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Строка поиска"]')?.value).toBe("");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "h", ctrlKey: true, bubbles: true }));
    await settle();
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Строка замены"]')).not.toBeNull();

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Строка поиска"]')!;
    await fireEvent.keyDown(input, { key: "Escape" });
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("updates the counter and toggles case, whole-word, and regexp modes", async () => {
    const view = createView();
    render(FindPanel, { props: { view, isOpen: true } });
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Строка поиска"]')!;
    await fireEvent.input(input, { target: { value: "alpha" } });
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(document.body.textContent).toContain("2 совпадений");

    const toggles = document.querySelectorAll<HTMLButtonElement>(".toggle-btn");
    await fireEvent.click(toggles[0]!);
    await fireEvent.click(toggles[1]!);
    await fireEvent.click(toggles[2]!);
    expect(toggles[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(toggles[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(toggles[2]?.getAttribute("aria-pressed")).toBe("true");

    await fireEvent.input(input, { target: { value: "(" } });
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.body.textContent).toContain("Ошибка regex");
  });

  it("moves through matches with Enter and Shift+Enter", async () => {
    const view = createView();
    searchMock.findNext.mockImplementation((candidate: FakeView) => {
      candidate.state.selection.main = candidate.state.selection.main.from === 0
        ? { from: 11, to: 16 }
        : { from: 0, to: 5 };
      return true;
    });
    searchMock.findPrevious.mockImplementation((candidate: FakeView) => {
      candidate.state.selection.main = { from: 0, to: 5 };
      return true;
    });
    render(FindPanel, { props: { view, isOpen: true } });
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Строка поиска"]')!;
    await fireEvent.input(input, { target: { value: "alpha" } });
    await new Promise((resolve) => setTimeout(resolve, 70));

    await fireEvent.keyDown(input, { key: "Enter" });
    expect((view as unknown as FakeView).state.selection.main.from).toBe(11);
    expect((view as unknown as FakeView).state.selection.main.to).toBe(16);
    await fireEvent.keyDown(input, { key: "Enter" });
    expect((view as unknown as FakeView).state.selection.main.from).toBe(0);
    expect((view as unknown as FakeView).state.selection.main.to).toBe(5);
    await fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(searchMock.findPrevious).toHaveBeenCalled();
    expect((view as unknown as FakeView).state.selection.main.from).toBe(0);
  });
});
