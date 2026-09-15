import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import MenuBar from "../../src/ui/MenuBar.svelte";
import { format, settle } from "./helpers";
import { formatLabel, setInterfaceLanguage, translate as t } from "../../src/i18n";

afterEach(async () => {
  cleanup();
  await setInterfaceLanguage("en");
});

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

  it("aligns the menu and opens nested items toward the inline end in RTL", async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
    await setInterfaceLanguage("ar");
    try {
      render(MenuBar, { props: { formats: [format("markdown", { label: "Markdown" })] } });
      const fileButton = document.querySelector<HTMLButtonElement>('[role="menubar"] button')!;
      vi.spyOn(fileButton, "getBoundingClientRect").mockReturnValue({
        x: 550, y: 0, left: 550, right: 590, top: 0, bottom: 28, width: 40, height: 28,
        toJSON: () => ({}),
      });
      await fireEvent.click(fileButton);
      const popup = document.querySelector<HTMLElement>('[role="menu"]')!;
      expect(Number.parseFloat(popup.style.getPropertyValue("inset-inline-start"))).toBe(10);

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
