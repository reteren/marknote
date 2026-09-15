import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import SaveControls from "../../src/ui/SaveControls.svelte";
import { format } from "./helpers";
import { formatTime, translate as t } from "../../src/i18n";

afterEach(() => cleanup());

describe("SaveControls state and actions", () => {
  it.each([
    ["unsaved", `● ${t("save.unsaved")}`],
    ["pending", t("save.saving")],
    ["readonly", t("save.readOnly")],
  ] as const)("renders the %s state", (saveStatus, label) => {
    render(SaveControls, { props: { saveStatus } });
    expect(document.body.textContent).toContain(label);
  });

  it("shows Saved with the last-save time", () => {
    const timestamp = new Date(2025, 0, 2, 13, 4);
    render(SaveControls, { props: { saveStatus: "saved", lastSavedAt: timestamp } });
    expect(document.body.textContent).toContain(t("save.savedAt", { time: formatTime(timestamp) }));
  });

  it("blocks Save but keeps Save as Markdown available for a read-only format", () => {
    render(SaveControls, { props: { path: "report.pdf", format: format("pdf", { label: "PDF", editable: false }) } });
    expect(document.querySelector<HTMLButtonElement>(".save-btn")?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".save-as-btn")?.disabled).toBe(false);
    expect(document.body.textContent).toContain(t("save.saveAsMarkdownButton"));
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
