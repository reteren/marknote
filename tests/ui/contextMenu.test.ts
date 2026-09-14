import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import ContextMenu from "../../src/ui/ContextMenu.svelte";
import { settle } from "./helpers";

afterEach(() => cleanup());

describe("ContextMenu user interactions", () => {
  it("shows editing and formatting actions for a selection, and inserts for empty space", async () => {
    const onSelect = vi.fn();
    const { unmount } = render(ContextMenu, {
      props: { open: true, targetType: "selection", canPaste: false, onSelect },
    });
    expect(document.body.textContent).toContain("Cut");
    expect(document.body.textContent).toContain("Bold");
    expect(document.body.textContent).not.toContain("Table");
    const paste = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Paste"));
    expect(paste?.disabled).toBe(true);
    await fireEvent.click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Bold"))!);
    expect(onSelect).toHaveBeenCalledWith("bold", undefined);
    unmount();

    render(ContextMenu, {
      props: { open: true, targetType: "empty", onSelect },
    });
    expect(document.body.textContent).toContain("Select All");
    expect(document.body.textContent).toContain("Table");
    expect(document.body.textContent).not.toContain("Cut");
  });

  it("offers link actions without mistaking an ordinary context for a link", async () => {
    const onSelect = vi.fn();
    render(ContextMenu, {
      props: { open: true, targetType: "link", linkUrl: "https://example.test/note", onSelect },
    });
    expect(document.body.textContent).toContain("Open Link");
    expect(document.body.textContent).toContain("Copy Link Address");
    expect(document.body.textContent).not.toContain("Select All");
    await fireEvent.click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Open Link"))!);
    expect(onSelect).toHaveBeenCalledWith("open-link", "https://example.test/note");
  });

  it("suppresses the native menu and opens on a right click, then closes via Escape or outside click", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const onClose = vi.fn();
    render(ContextMenu, { props: { targetElement: target, onClose } });

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 12, clientY: 18 });
    target.dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).not.toBeNull();

    await fireEvent.keyDown(menu!, { key: "Escape" });
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();

    const event2 = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    target.dispatchEvent(event2);
    await settle();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();

    const link = document.createElement("a");
    link.href = "https://example.test/link";
    link.textContent = "a link";
    target.append(link);
    const linkEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    link.dispatchEvent(linkEvent);
    await settle();
    expect(document.body.textContent).toContain("Open Link");
    expect(linkEvent.defaultPrevented).toBe(true);
  });
});
