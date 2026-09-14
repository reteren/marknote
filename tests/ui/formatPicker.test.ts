import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import FormatPicker from "../../src/ui/FormatPicker.svelte";
import { format, settle } from "./helpers";

afterEach(() => cleanup());

describe("FormatPicker format registry", () => {
  it("builds tiles from the supplied formats, omits non-creatable formats, and emits the selected format", async () => {
    const onSelect = vi.fn();
    const formats = [
      format("md", { label: "Markdown" }),
      format("json", { label: "JSON" }),
      format("pdf", { label: "PDF", creatable: false }),
    ];
    render(FormatPicker, { props: { formats, mode: "grid", onSelect } });
    expect(document.body.textContent).toContain("Markdown");
    expect(document.body.textContent).toContain("JSON");
    expect(document.body.textContent).not.toContain("PDF");
    await fireEvent.click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("JSON"))!);
    expect(onSelect).toHaveBeenCalledWith(formats[1]);
    await settle();
  });

  it("expands rare types with More…", async () => {
    const formats = Array.from({ length: 5 }, (_, index) => format(`f${index}`, { label: `Format ${index}` }));
    render(FormatPicker, { props: { formats, mode: "grid", showMoreThreshold: 2 } });
    expect(document.body.textContent).toContain("Format 0");
    expect(document.body.textContent).toContain("Format 1");
    expect(document.body.textContent).not.toContain("Format 4");
    await fireEvent.click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("More"))!);
    expect(document.body.textContent).toContain("Format 4");
  });
});
