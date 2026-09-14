import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import packageInfo from "../../package.json";
import HelpDialog, { type HelpMode } from "../../src/ui/HelpDialog.svelte";

afterEach(() => cleanup());

describe("HelpDialog", () => {
  it.each([
    ["shortcuts", "Горячие клавиши"],
    ["markdownReference", "Справка по Markdown"],
    ["about", "О программе"],
  ] as const)("renders the %s mode", (mode, title) => {
    render(HelpDialog, { props: { mode } });
    expect(document.querySelector("[role=dialog]")?.textContent).toContain(title);
  });

  it("renders a non-empty shortcut table and the package version", () => {
    render(HelpDialog, { props: { mode: "shortcuts" } });
    expect(document.querySelectorAll("tbody tr").length).toBeGreaterThan(0);

    cleanup();
    render(HelpDialog, { props: { mode: "about" } });
    expect(document.body.textContent).toContain(packageInfo.version);
    expect(document.body.textContent).toContain("MIT");
  });

  it.each([
    ["Escape", (dialog: HTMLElement) => fireEvent.keyDown(dialog, { key: "Escape" })],
    ["outside click", (dialog: HTMLElement) => fireEvent.click(dialog.parentElement!)],
    ["close button", (dialog: HTMLElement) => fireEvent.click(dialog.querySelector(".close-button")!)],
  ] as const)("closes on %s", async (_label, close) => {
    const onClose = vi.fn();
    render(HelpDialog, { props: { mode: "shortcuts" as HelpMode, onClose } });
    const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
    await close(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
