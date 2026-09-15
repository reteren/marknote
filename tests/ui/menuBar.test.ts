import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import MenuBar from "../../src/ui/MenuBar.svelte";
import { format, settle } from "./helpers";

afterEach(() => cleanup());

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
    expect(document.querySelector('[role="menu"][aria-label="File"]')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await settle();
    const newMarkdown = document.querySelector<HTMLElement>('[data-menu-item-id="file.new.markdown"]');
    const newJson = document.querySelector<HTMLElement>('[data-menu-item-id="file.new.json"]');
    expect(newMarkdown).not.toBeNull();
    expect(newJson).not.toBeNull();
    expect(document.body.textContent).toContain("JSON");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(onAction).toHaveBeenCalledWith("file.new.markdown");
    expect(document.querySelector('[role="menu"][aria-label="File"]')).toBeNull();
  });

  it("closes on Escape and restores editor focus, and closes on outside pointerdown", async () => {
    const onFocusEditor = vi.fn();
    render(MenuBar, { props: { onFocusEditor } });
    const fileButton = document.querySelector<HTMLButtonElement>('[role="menubar"] button');
    expect(fileButton).not.toBeNull();
    await fireEvent.click(fileButton!);
    expect(document.querySelector('[role="menu"][aria-label="File"]')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    expect(document.querySelector('[role="menu"][aria-label="File"]')).toBeNull();
    expect(onFocusEditor).toHaveBeenCalledTimes(1);

    await fireEvent.click(fileButton!);
    expect(document.querySelector('[role="menu"][aria-label="File"]')).not.toBeNull();
    document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await settle();
    expect(document.querySelector('[role="menu"][aria-label="File"]')).toBeNull();
  });

  it("does not expose a Format top-level section and keeps disabled Save unavailable", async () => {
    const onAction = vi.fn();
    render(MenuBar, {
      props: { menuState: { editable: false, canSave: false }, onAction },
    });
    const sectionLabels = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menubar"] button'))
      .map((button) => button.textContent);
    expect(sectionLabels).toEqual(["File", "Edit", "View", "Help"]);
    await fireEvent.click(document.querySelector<HTMLButtonElement>('[role="menubar"] button')!);
    const save = document.querySelector<HTMLButtonElement>('[data-menu-item-id="file.save"]');
    expect(save?.disabled).toBe(true);
    await fireEvent.click(save!);
    expect(onAction).not.toHaveBeenCalledWith("file.save");
  });
});
