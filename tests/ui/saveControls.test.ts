import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import SaveControls from "../../src/ui/SaveControls.svelte";
import { format } from "./helpers";

afterEach(() => cleanup());

describe("SaveControls state and actions", () => {
  it.each([
    ["unsaved", "● Unsaved"],
    ["pending", "Saving…"],
    ["readonly", "Read-only"],
  ] as const)("renders the %s state", (saveStatus, label) => {
    render(SaveControls, { props: { saveStatus } });
    expect(document.body.textContent).toContain(label);
  });

  it("shows Saved with the last-save time", () => {
    render(SaveControls, { props: { saveStatus: "saved", lastSavedAt: new Date(2025, 0, 2, 13, 4) } });
    expect(document.body.textContent).toMatch(/Saved\s+\d{1,2}:\d{2}/u);
  });

  it("blocks Save but keeps Save as Markdown available for a read-only format", () => {
    render(SaveControls, { props: { path: "report.pdf", format: format("pdf", { label: "PDF", editable: false }) } });
    expect(document.querySelector<HTMLButtonElement>(".save-btn")?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".save-as-btn")?.disabled).toBe(false);
    expect(document.body.textContent).toContain("Save as Markdown…");
  });

  it("routes Save for an untitled document to Save As", async () => {
    const onSave = vi.fn();
    const onSaveAs = vi.fn();
    render(SaveControls, {
      props: { path: null, text: "draft", dirty: true, onSave, onSaveAs },
    });
    await fireEvent.click(document.querySelector<HTMLButtonElement>(".save-btn")!);
    expect(onSaveAs).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
