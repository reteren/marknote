import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import StartScreen from "../../src/ui/StartScreen.svelte";
import { format } from "./helpers";
import { formatLabel, translate as t } from "../../src/i18n";

afterEach(() => cleanup());

describe("StartScreen actions", () => {
  it("renders supplied format tiles and forwards format and Open file actions", async () => {
    const onSelect = vi.fn();
    const onOpenFile = vi.fn();
    const formats = [format("md", { label: "Markdown" }), format("txt", { label: "Plain Text" })];
    render(StartScreen, { props: { formats, onSelect, onOpenFile } });
    expect(document.querySelector(".start-screen h1")?.textContent).toBe(t("app.name"));
    expect(document.querySelector(".start-screen .mark")).toBeNull();
    expect(document.querySelector(".start-screen .lead")).toBeNull();
    expect(document.querySelector(".start-screen .hint")).toBeNull();
    expect(document.body.textContent).toContain(formatLabel("md", "Markdown"));
    expect(document.body.textContent).toContain(formatLabel("txt", "Plain Text"));
    expect(document.body.textContent).not.toContain("New file");
    expect(document.body.textContent).not.toContain("Start typing to create a Markdown note.");
    const openRow = document.querySelector<HTMLElement>(".start-screen .open-row")!;
    expect(openRow.children).toHaveLength(2);
    expect(openRow.children[0]?.textContent).toBe("Open file");
    expect(openRow.children[1]?.textContent).toBe(t("start.dropFile"));
    await fireEvent.click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes(formatLabel("txt", "Plain Text")))!);
    expect(onSelect).toHaveBeenCalledWith(formats[1]);
    await fireEvent.click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes(t("start.openFile")))!);
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });
});
