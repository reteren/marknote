import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.svelte"), "utf8");

describe("editor zoom application wiring", () => {
  it("installs persisted zoom on each CodeMirror view without scaling the app shell", () => {
    expect(appSource).toContain('import { installZoom, resetZoom, zoomIn, zoomOut } from "./editor/zoom";');
    expect(appSource).toMatch(/editorView\s*=\s*createEditor\([\s\S]*?\);\s*installZoom\(editorView\);/u);
    expect(appSource).not.toContain("documentElement.style.zoom");
    expect(appSource).not.toContain("zoomPercent");
  });

  it("routes menu zoom actions through the shared action callbacks", () => {
    for (const action of ["zoomIn", "zoomOut", "resetZoom"] as const) {
      expect(appSource).toMatch(new RegExp(`${action}: \\(\\) => \\{\\s*if \\(editorView\\) ${action}\\(editorView\\);\\s*\\}`));
      expect(appSource).toContain(`case "view.${action}": void actions.run("view.${action}");`);
    }
  });
});
