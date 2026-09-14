import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
}));

import { createImageResolver } from "../src/editor/imageResolver";

describe("createImageResolver", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
  });

  it("returns data and HTTP sources without calling Rust", async () => {
    const resolver = createImageResolver("C:\\notes\\document.md");
    const dataUrl = "data:image/png;base64,AA==";
    const httpUrl = "https://example.test/image.png";

    await expect(resolver(dataUrl)).resolves.toBe(dataUrl);
    await expect(resolver(httpUrl)).resolves.toBe(httpUrl);
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("caches repeated relative image requests", async () => {
    tauri.invoke.mockResolvedValue("data:image/png;base64,AA==");
    const documentPath = "C:\\notes\\document.md";
    const resolver = createImageResolver(documentPath);

    await expect(resolver("./assets/logo.png")).resolves.toBe("data:image/png;base64,AA==");
    await expect(resolver("./assets/logo.png")).resolves.toBe("data:image/png;base64,AA==");

    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(tauri.invoke).toHaveBeenCalledWith("read_image", {
      docPath: documentPath,
      src: "./assets/logo.png",
    });
  });

  it("clears the cache when the document path changes", async () => {
    tauri.invoke
      .mockResolvedValueOnce("data:image/png;base64,ONE=")
      .mockResolvedValueOnce("data:image/png;base64,TWO=");
    const resolver = createImageResolver("C:\\one\\document.md");

    await expect(resolver("./assets/logo.png")).resolves.toBe("data:image/png;base64,ONE=");
    resolver.setDocumentPath("C:\\two\\document.md");
    await expect(resolver("./assets/logo.png")).resolves.toBe("data:image/png;base64,TWO=");

    expect(tauri.invoke).toHaveBeenCalledTimes(2);
    expect(tauri.invoke).toHaveBeenLastCalledWith("read_image", {
      docPath: "C:\\two\\document.md",
      src: "./assets/logo.png",
    });
  });

  it("reports that relative paths cannot resolve before the document is saved", async () => {
    const resolver = createImageResolver(null);

    await expect(resolver("./assets/logo.png")).rejects.toThrow(/saved document path/iu);
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("turns read errors into a handled rejected promise", async () => {
    tauri.invoke.mockRejectedValue(new Error("file is missing"));
    const resolver = createImageResolver("C:\\notes\\document.md");

    await expect(resolver("./missing.png")).rejects.toThrow(/Failed to load image.*file is missing/iu);
    await expect(resolver("./missing.png")).rejects.toThrow(/Failed to load image/iu);
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
  });
});
