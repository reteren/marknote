import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import StartScreen from "../../src/ui/StartScreen.svelte";
import { format } from "./helpers";

afterEach(() => cleanup());

describe("StartScreen actions", () => {
  it("renders supplied format tiles and forwards format and Open file actions", async () => {
    const onSelect = vi.fn();
    const onOpenFile = vi.fn();
    const formats = [format("md", { label: "Markdown" }), format("txt", { label: "Plain Text" })];
    render(StartScreen, { props: { formats, onSelect, onOpenFile } });
    expect(document.body.textContent).toContain("Markdown");
    expect(document.body.textContent).toContain("Plain Text");
    await fireEvent.click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Plain Text"))!);
    expect(onSelect).toHaveBeenCalledWith(formats[1]);
    await fireEvent.click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Open file"))!);
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });
});
