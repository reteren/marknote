import { cleanup, fireEvent, render } from "@testing-library/svelte";
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

import ContextMenu from "../../src/ui/ContextMenu.svelte";
import App from "../../src/App.svelte";
import { documentState, resetDocument } from "../../src/state/document.svelte";
import { markdownFormat } from "../../src/state/formats.svelte";
import { formatLabel, setInterfaceLanguage, translate as t } from "../../src/i18n";
import { settle } from "./helpers";

afterEach(async () => {
  cleanup();
  await setInterfaceLanguage("en");
  vi.restoreAllMocks();
  tauri.handlers.clear();
  tauri.invoke.mockReset();
  tauri.listen.mockReset();
  resetDocument(markdownFormat, "");
});

describe("ContextMenu user interactions", () => {
  it("offers the three nested groups and the complete editing command set", async () => {
    const onSelect = vi.fn();
    render(ContextMenu, { props: { open: true, targetType: "empty", onSelect } });

    expect(Array.from(document.querySelectorAll<HTMLButtonElement>(".submenu-trigger")).map((button) => button.textContent?.replace("›", "").trim())).toEqual([
      t("contextMenu.formatting"), t("contextMenu.paragraph"), t("contextMenu.insert"),
    ]);
    for (const label of [t("menu.cut"), t("menu.copy"), t("menu.paste"), t("menu.pastePlainText"), t("contextMenu.delete"), t("menu.selectAll")]) {
      expect(Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.includes(label))).toBe(true);
    }
    expect(document.querySelector(`[aria-label="${t("contextMenu.formatting")}"]`)).toBeNull();
    const cut = document.querySelector<HTMLButtonElement>('[data-menu-action="cut"]')!;
    expect(cut.disabled).toBe(true);
    await fireEvent.click(cut);
    expect(onSelect).not.toHaveBeenCalled();

    const formatting = Array.from(document.querySelectorAll<HTMLButtonElement>(".submenu-trigger"))
      .find((button) => button.textContent?.includes(t("contextMenu.formatting")))!;
    await fireEvent.mouseEnter(formatting);
    await settle();
    const formattingMenu = document.querySelector<HTMLElement>(`[role="menu"][aria-label="${t("contextMenu.formatting")}"]`);
    expect(formattingMenu).not.toBeNull();
    expect(formattingMenu?.textContent).toContain(t("format.strikethrough"));
    expect(formattingMenu?.textContent).toContain(t("format.highlight"));
    expect(formattingMenu?.textContent).toContain(t("format.code"));
    expect(formattingMenu?.textContent).toContain(t("format.link"));

    await fireEvent.click(Array.from(formattingMenu!.querySelectorAll("button")).find((button) => button.textContent?.includes(t("format.bold")))!);
    expect(onSelect).toHaveBeenCalledWith("format.bold", undefined);
  });

  it("opens submenus by hover and keyboard, navigates items, and selects the focused action", async () => {
    const onSelect = vi.fn();
    render(ContextMenu, { props: { open: true, targetType: "selection", onSelect } });
    const root = document.querySelector<HTMLElement>('[role="menu"][data-menu-level="root"]')!;

    await fireEvent.keyDown(root, { key: "ArrowDown" });
    await settle();
    expect(document.activeElement?.getAttribute("data-submenu-label")).toBe(t("contextMenu.formatting"));
    await fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    await settle();
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    await settle();
    expect(document.querySelector(`[role="menu"][aria-label="${t("contextMenu.formatting")}"]`)).not.toBeNull();
    expect(document.activeElement?.textContent).toContain(t("format.bold"));

    await fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    await settle();
    expect(document.activeElement?.textContent).toContain(t("format.italic"));
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    await settle();
    expect(document.activeElement?.textContent).toContain(t("format.bold"));
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    await settle();
    expect(document.activeElement?.textContent).toContain(t("format.italic"));
    await fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    await settle();
    expect(onSelect).toHaveBeenCalledWith("format.italic", undefined);
    expect(document.querySelector('[data-menu-level="root"]')).toBeNull();
  });

  it("closes a submenu with ArrowLeft and closes the whole menu on Escape, restoring focus", async () => {
    const target = document.createElement("button");
    target.textContent = "Editor";
    document.body.append(target);
    target.focus();
    const onClose = vi.fn();
    render(ContextMenu, { props: { targetElement: target, onClose } });

    const contextEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    target.dispatchEvent(contextEvent);
    await settle();
    expect(contextEvent.defaultPrevented).toBe(true);
    const formatting = Array.from(document.querySelectorAll<HTMLButtonElement>(".submenu-trigger"))
      .find((button) => button.textContent?.includes(t("contextMenu.formatting")))!;
    await fireEvent.mouseEnter(formatting);
    await settle();
    await fireEvent.keyDown(formatting, { key: "ArrowRight" });
    await settle();
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    await settle();
    expect(document.querySelector(`[role="menu"][aria-label="${t("contextMenu.formatting")}"]`)).toBeNull();
    expect(document.activeElement).toBe(formatting);

    await fireEvent.keyDown(formatting, { key: "Escape" });
    await settle();
    expect(document.querySelector('[data-menu-level="root"]')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(target);
  });

  it("flips a submenu left and clamps it vertically near the viewport edges", async () => {
    const previousWidth = window.innerWidth;
    const previousHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 300 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 });
    try {
      render(ContextMenu, { props: { open: true, targetType: "empty" } });
      const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>(".submenu-trigger"))
      .find((button) => button.textContent?.includes(t("contextMenu.formatting")))!;
      vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
        x: 265, y: 270, left: 265, right: 295, top: 270, bottom: 292, width: 30, height: 22,
        toJSON: () => ({}),
      });
      await fireEvent.mouseEnter(trigger);
      await settle();
      const submenu = document.querySelector<HTMLElement>(`[role="menu"][aria-label="${t("contextMenu.formatting")}"]`)!;
      const inlineStart = Number.parseFloat(submenu.style.getPropertyValue("inset-inline-start"));
      expect(inlineStart).toBeLessThan(265);
      expect(inlineStart).toBeGreaterThanOrEqual(8);
      expect(Number.parseFloat(submenu.style.top)).toBeGreaterThanOrEqual(8);
      expect(Number.parseFloat(submenu.style.top)).toBeLessThan(270);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: previousHeight });
    }
  });

  it("places and navigates the submenu from the inline end in RTL", async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
    await setInterfaceLanguage("ar");
    try {
      render(ContextMenu, { props: { open: true, targetType: "empty" } });
      const trigger = document.querySelector<HTMLButtonElement>(".submenu-trigger")!;
      vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
        x: 340, y: 20, left: 340, right: 370, top: 20, bottom: 42, width: 30, height: 22,
        toJSON: () => ({}),
      });
      await fireEvent.mouseEnter(trigger);
      await settle();
      const submenu = document.querySelector<HTMLElement>(`[role="menu"][aria-label="${t("contextMenu.formatting")}"]`)!;
      expect(Number.parseFloat(submenu.style.getPropertyValue("inset-inline-start"))).toBe(260);

      await fireEvent.keyDown(trigger, { key: "ArrowLeft" });
      await settle();
      await fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
      await settle();
      expect(document.querySelector("[data-menu-level='submenu']")).toBeNull();
      await fireEvent.keyDown(trigger, { key: "ArrowLeft" });
      await settle();
      expect(document.querySelector("[data-menu-level='submenu']")).not.toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
    }
  });

  it("keeps link-specific actions and suppresses the native context menu", async () => {
    const onSelect = vi.fn();
    const target = document.createElement("div");
    document.body.append(target);
    render(ContextMenu, { props: { targetElement: target, onSelect } });
    const link = document.createElement("a");
    link.href = "https://example.test/note";
    link.textContent = "a link";
    target.append(link);

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    link.dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(document.body.textContent).toContain(t("contextMenu.openLink"));
    expect(document.body.textContent).toContain(t("contextMenu.copyLinkAddress"));
    expect(document.body.textContent).not.toContain(t("contextMenu.formatting"));
    await fireEvent.click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes(t("contextMenu.openLink")))!);
    expect(onSelect).toHaveBeenCalledWith("open-link", "https://example.test/note");

    const plainArea = document.createElement("span");
    plainArea.textContent = "plain text";
    target.append(plainArea);
    const plainEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    plainArea.dispatchEvent(plainEvent);
    await settle();
    expect(document.body.textContent).toContain(t("contextMenu.formatting"));
    expect(document.body.textContent).not.toContain(t("contextMenu.openLink"));
  });

  it("routes existing format action IDs from the context submenu into the document", async () => {
    resetDocument(markdownFormat, "");
    tauri.handlers.clear();
    tauri.invoke.mockReset();
    tauri.focusChanged.mockResolvedValue(async () => undefined);
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

    render(App);
    await settle();
    const markdownTile = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes(formatLabel("markdown", "Markdown")) && button.textContent.includes(".md"));
    expect(markdownTile).toBeDefined();
    await fireEvent.click(markdownTile!);
    await settle();

    const editorContent = document.querySelector<HTMLElement>(".cm-content")!;
    const contextEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 });
    editorContent.dispatchEvent(contextEvent);
    await settle();
    expect(contextEvent.defaultPrevented).toBe(true);

    const insertTrigger = Array.from(document.querySelectorAll<HTMLButtonElement>(".submenu-trigger"))
      .find((button) => button.textContent?.includes(t("contextMenu.insert")))!;
    await fireEvent.mouseEnter(insertTrigger);
    await fireEvent.click(Array.from(document.querySelectorAll<HTMLButtonElement>(`[role="menu"][aria-label="${t("contextMenu.insert")}"] button`))
      .find((button) => button.textContent?.includes(t("format.table")))!);
    // Пустая строка после таблицы: иначе набранный под ней текст стал бы её строкой.
    expect(documentState.text).toBe("|  |  |\n| --- | --- |\n|  |  |\n\n");
  });

  it("routes horizontal rule action into the document with proper separation and renders hr widget", async () => {
    tauri.invoke.mockReset();
    tauri.focusChanged.mockResolvedValue(async () => undefined);
    tauri.listen.mockImplementation(async (name: string, handler: (event: { payload?: unknown }) => void) => {
      const handlers = tauri.handlers.get(name) ?? new Set();
      handlers.add(handler);
      tauri.handlers.set(name, handlers);
      return () => handlers.delete(handler);
    });
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "list_creatable_formats") return [markdownFormat];
      if (command === "new_document") return { text: "Some preceding paragraph", format: markdownFormat };
      if (command === "take_pending_file") return null;
      return undefined;
    });

    render(App);
    await settle();
    const markdownTile = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes(formatLabel("markdown", "Markdown")) && button.textContent.includes(".md"));
    expect(markdownTile).toBeDefined();
    await fireEvent.click(markdownTile!);
    await settle();

    const editorContent = document.querySelector<HTMLElement>(".cm-content")!;
    const contextEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 });
    editorContent.dispatchEvent(contextEvent);
    await settle();
    expect(contextEvent.defaultPrevented).toBe(true);

    const insertTrigger = Array.from(document.querySelectorAll<HTMLButtonElement>(".submenu-trigger"))
      .find((button) => button.textContent?.includes(t("contextMenu.insert")))!;
    await fireEvent.mouseEnter(insertTrigger);
    await settle();
    await fireEvent.click(Array.from(document.querySelectorAll<HTMLButtonElement>(`[role="menu"][aria-label="${t("contextMenu.insert")}"] button`))
      .find((button) => button.textContent?.includes(t("format.horizontalRule")))!);
    await settle();

    // Линия в начале документа: ни пустой строки перед ней, ни лишней после.
    expect(documentState.text).toBe("---\nSome preceding paragraph");
    const hrElement = document.querySelector<HTMLElement>(".cm-marknote-hr");
    expect(hrElement).not.toBeNull();
  });
});
