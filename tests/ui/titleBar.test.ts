import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";

const mocks = vi.hoisted(() => {
  const state = { maximized: false, resizeHandler: undefined as undefined | (() => void) };
  const window = {
    minimize: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => {
      state.maximized = !state.maximized;
    }),
    isMaximized: vi.fn(async () => state.maximized),
    onResized: vi.fn(async (handler: () => void) => {
      state.resizeHandler = handler;
      return vi.fn();
    }),
    startResizeDragging: vi.fn(async (_direction: string) => undefined),
    close: vi.fn(async () => undefined),
  };
  return { state, window };
});

const labels: Record<string, string> = {
  "window.titleBar": "Window title bar",
  "window.controls": "Window controls",
  "window.minimize": "Minimize",
  "window.maximize": "Maximize",
  "window.restore": "Restore down",
  "window.close": "Close window",
};

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => mocks.window }));
vi.mock("../../src/i18n", () => ({ translate: (key: string) => labels[key] ?? key }));

import TitleBar from "../../src/ui/TitleBar.svelte";

describe("TitleBar", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.maximized = false;
    mocks.state.resizeHandler = undefined;
  });

  it("renders the document title in a Tauri drag region", async () => {
    const { container } = render(TitleBar, { title: "notes.md — MarkNote", onClose: vi.fn() });
    await waitFor(() => expect(mocks.window.onResized).toHaveBeenCalledOnce());
    expect(screen.getByText("notes.md — MarkNote")).toBeInTheDocument();
    expect(container.querySelector(".titlebar-drag-region")).toHaveAttribute("data-tauri-drag-region");
    expect(container.querySelector(".window-controls")?.closest("[data-tauri-drag-region]")).toBeNull();
    expect(container.querySelectorAll(".window-control")).toHaveLength(3);
  });

  it("minimizes, toggles maximize, and restores by double-clicking the drag area", async () => {
    const { container } = render(TitleBar, { title: "notes.md — MarkNote", onClose: vi.fn() });
    await fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(mocks.window.minimize).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole("button", { name: "Maximize" }));
    expect(mocks.window.toggleMaximize).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Restore down" })).toBeInTheDocument();
    expect(container.querySelector(".resize-hotspots")).toBeNull();

    await fireEvent.doubleClick(container.querySelector(".titlebar-drag-region")!);
    expect(mocks.window.toggleMaximize).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument();
  });

  it("routes close through the supplied protocol callback, never Window.close", async () => {
    const onClose = vi.fn();
    render(TitleBar, { title: "notes.md — MarkNote", onClose });
    await fireEvent.click(screen.getByRole("button", { name: "Close window" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.window.close).not.toHaveBeenCalled();
  });

  it("keeps all three window controls keyboard operable", async () => {
    const onClose = vi.fn();
    render(TitleBar, { title: "notes.md — MarkNote", onClose });
    const minimize = screen.getByRole("button", { name: "Minimize" });
    minimize.focus();
    await fireEvent.keyDown(minimize, { key: "Enter" });
    expect(mocks.window.minimize).toHaveBeenCalledOnce();

    const maximize = screen.getByRole("button", { name: "Maximize" });
    maximize.focus();
    await fireEvent.keyUp(maximize, { key: " " });
    expect(mocks.window.toggleMaximize).toHaveBeenCalledOnce();

    const close = screen.getByRole("button", { name: "Close window" });
    close.focus();
    await fireEvent.keyDown(close, { key: "Enter" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("requests native resizing from every side and corner hit target", async () => {
    const { container } = render(TitleBar, { title: "notes.md — MarkNote", onClose: vi.fn() });
    const directions = ["North", "South", "West", "East", "NorthWest", "NorthEast", "SouthWest", "SouthEast"];
    expect(container.querySelectorAll("[data-resize-direction]")).toHaveLength(8);
    for (const direction of directions) {
      await fireEvent.mouseDown(container.querySelector(`[data-resize-direction="${direction}"]`)!, { button: 0 });
    }
    await waitFor(() => expect(mocks.window.startResizeDragging).toHaveBeenCalledTimes(8));
    expect(mocks.window.startResizeDragging.mock.calls.map(([direction]) => direction)).toEqual(directions);
  });
});
