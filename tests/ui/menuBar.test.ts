import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import MenuBar from "../../src/ui/MenuBar.svelte";
import { format, settle } from "./helpers";
import { formatLabel, setInterfaceLanguage, translate as t } from "../../src/i18n";

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await setInterfaceLanguage("en");
});

function mockPopupBounds(width: number, height: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("menu-popup")) {
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) };
    }
    return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  });
}

describe("MenuBar keyboard and pointer behavior", () => {
  it("opens with Alt, enters File/New, and dispatches a dynamic format id", async () => {
    const onAction = vi.fn();
    render(MenuBar, {
      props: {
        formats: [format("markdown", { label: "Markdown" }), format("json", { label: "JSON" })],
        onAction,
      },
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true }));
    await settle();
    expect(document.querySelector(`[role="menu"][aria-label="${t("menu.file")}"]`)).not.toBeNull();
    expect(document.querySelector(".submenu-panel")).toBeNull();
    expect(document.querySelector('[data-menu-item-id="file.new.markdown"]')).toBeNull();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await settle();
    const newMarkdown = document.querySelector<HTMLElement>('[data-menu-item-id="file.new.markdown"]');
    const newJson = document.querySelector<HTMLElement>('[data-menu-item-id="file.new.json"]');
    expect(newMarkdown).not.toBeNull();
    expect(newJson).not.toBeNull();
    expect(document.body.textContent).toContain(formatLabel("json", "JSON"));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(onAction).toHaveBeenCalledWith("file.new.markdown");
    expect(document.querySelector(`[role="menu"][aria-label="${t("menu.file")}"]`)).toBeNull();
  });

  it("прячет форматы обратно, когда курсор уходит с пункта New", async () => {
    render(MenuBar, { props: { formats: [format("markdown"), format("json")] } });
    const fileButton = document.querySelector<HTMLButtonElement>('[role="menubar"] button')!;
    await fireEvent.click(fileButton, { clientX: 80, clientY: 15, detail: 1 });
    await settle();

    const newItem = document.querySelector<HTMLElement>('[data-menu-item-id="file.new"]')!;
    await fireEvent.mouseEnter(newItem);
    await settle();
    expect(document.querySelector(".submenu-panel")).not.toBeNull();

    // Список форматов оставался висеть, пока курсор гулял по соседним пунктам,
    // и выглядело это так, будто он открылся сам по нажатию на File.
    const newWindowItem = document.querySelector<HTMLElement>('[data-menu-item-id="file.newWindow"]')!;
    await fireEvent.mouseEnter(newWindowItem);
    await settle();
    expect(document.querySelector(".submenu-panel")).toBeNull();
  });

  it("keeps File → New formats hidden until New is hovered or entered by keyboard", async () => {
    render(MenuBar, { props: { formats: [format("markdown"), format("json")] } });
    const fileButton = document.querySelector<HTMLButtonElement>('[role="menubar"] button')!;
    await fireEvent.click(fileButton, { clientX: 80, clientY: 15, detail: 1 });
    await settle();

    expect(document.querySelector(".submenu-panel")).toBeNull();
    expect(document.querySelector('[data-menu-item-id="file.new.markdown"]')).toBeNull();

    const newItem = document.querySelector<HTMLElement>('[data-menu-item-id="file.new"]')!;
    await fireEvent.mouseEnter(newItem);
    await settle();
    expect(document.querySelector(".submenu-panel")).not.toBeNull();
    expect(document.querySelector('[data-menu-item-id="file.new.markdown"]')).not.toBeNull();
  });

  it.each([
    { edge: "upper-left", x: 100, y: 100, left: 98, top: 98 },
    { edge: "right", x: 980, y: 100, left: 702, top: 98 },
    { edge: "bottom", x: 100, y: 760, left: 98, top: 402 },
    { edge: "lower-right", x: 980, y: 760, left: 702, top: 402 },
  ])("anchors the popup to the nearest cursor corner ($edge)", async ({ x, y, left, top }) => {
    const previousWidth = window.innerWidth;
    const previousHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    mockPopupBounds(280, 360);
    try {
      render(MenuBar);
      const fileButton = document.querySelector<HTMLButtonElement>('[role="menubar"] button')!;
      await fireEvent.click(fileButton, { clientX: x, clientY: y, detail: 1 });
      await settle();
      await tick();
      await settle();

      const popup = document.querySelector<HTMLElement>(".menu-popup")!;
      expect(Number.parseFloat(popup.style.left)).toBe(left);
      expect(Number.parseFloat(popup.style.top)).toBe(top);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: previousHeight });
    }
  });

  it("opens sections on click and does not switch them when hovering", async () => {
    render(MenuBar);
    const sectionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menubar"] button'));
    const viewButton = sectionButtons[2];
    const helpButton = sectionButtons[3];
    expect(sectionButtons).toHaveLength(4);

    await fireEvent.mouseEnter(helpButton);
    expect(document.querySelector('[role="menu"]')).toBeNull();

    await fireEvent.click(helpButton, { clientX: 400, clientY: 15, detail: 1 });
    expect(document.querySelector(`[role="menu"][aria-label="${t("menu.help")}"]`)).not.toBeNull();
    await fireEvent.mouseEnter(viewButton);
    expect(document.querySelector(`[role="menu"][aria-label="${t("menu.help")}"]`)).not.toBeNull();

    await fireEvent.click(viewButton, { clientX: 300, clientY: 15, detail: 1 });
    expect(document.querySelector(`[role="menu"][aria-label="${t("menu.view")}"]`)).not.toBeNull();
    expect(document.querySelector(`[role="menu"][aria-label="${t("menu.help")}"]`)).toBeNull();
  });

  it("closes on Escape and restores editor focus, and closes on outside pointerdown", async () => {
    const onFocusEditor = vi.fn();
    render(MenuBar, { props: { onFocusEditor } });
    const fileButton = document.querySelector<HTMLButtonElement>('[role="menubar"] button');
    expect(fileButton).not.toBeNull();
    await fireEvent.click(fileButton!);
    expect(document.querySelector(`[role="menu"][aria-label="${t("menu.file")}"]`)).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    expect(document.querySelector(`[role="menu"][aria-label="${t("menu.file")}"]`)).toBeNull();
    expect(onFocusEditor).toHaveBeenCalledTimes(1);

    await fireEvent.click(fileButton!);
    expect(document.querySelector(`[role="menu"][aria-label="${t("menu.file")}"]`)).not.toBeNull();
    document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await settle();
    expect(document.querySelector(`[role="menu"][aria-label="${t("menu.file")}"]`)).toBeNull();
  });

  it("does not expose a Format top-level section and keeps disabled Save unavailable", async () => {
    const onAction = vi.fn();
    render(MenuBar, {
      props: { menuState: { editable: false, canSave: false }, onAction },
    });
    const sectionLabels = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menubar"] button'))
      .map((button) => button.textContent);
    expect(sectionLabels).toEqual([t("menu.file"), t("menu.edit"), t("menu.view"), t("menu.help")]);
    await fireEvent.click(document.querySelector<HTMLButtonElement>('[role="menubar"] button')!);
    const save = document.querySelector<HTMLButtonElement>('[data-menu-item-id="file.save"]');
    expect(save?.disabled).toBe(true);
    await fireEvent.click(save!);
    expect(onAction).not.toHaveBeenCalledWith("file.save");
  });

  it("opens nested items toward the inline end in RTL", async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
    await setInterfaceLanguage("ar");
    try {
      render(MenuBar, { props: { formats: [format("markdown", { label: "Markdown" })] } });
      const fileButton = document.querySelector<HTMLButtonElement>('[role="menubar"] button')!;
      await fireEvent.click(fileButton, { clientX: 50, clientY: 15, detail: 1 });
      await tick();
      const popup = document.querySelector<HTMLElement>('[role="menu"]')!;
      expect(Number.parseFloat(popup.style.left)).toBe(48);

      const newItem = document.querySelector<HTMLElement>('[data-menu-item-id="file.new"]')!;
      vi.spyOn(newItem, "getBoundingClientRect").mockReturnValue({
        x: 320, y: 30, left: 320, right: 570, top: 30, bottom: 58, width: 250, height: 28,
        toJSON: () => ({}),
      });
      await fireEvent.mouseEnter(newItem);
      await settle();
      expect(document.querySelector(".submenu-panel")?.classList.contains("submenu-opposite")).toBe(false);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
    }
  });
});
