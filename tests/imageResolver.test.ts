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
    tauri.invoke.mockResolvedValue("http://marknote.localhost/image-1");
    const documentPath = "C:\\notes\\document.md";
    const resolver = createImageResolver(documentPath);

    await expect(resolver("./assets/logo.png")).resolves.toBe("http://marknote.localhost/image-1");
    await expect(resolver("./assets/logo.png")).resolves.toBe("http://marknote.localhost/image-1");

    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(tauri.invoke).toHaveBeenCalledWith("resolve_image", {
      docPath: documentPath,
      src: "./assets/logo.png",
    });
  });

  it("clears the cache when the document path changes", async () => {
    tauri.invoke
      .mockResolvedValueOnce("http://marknote.localhost/image-1")
      .mockResolvedValueOnce("http://marknote.localhost/image-2");
    const resolver = createImageResolver("C:\\one\\document.md");

    await expect(resolver("./assets/logo.png")).resolves.toBe("http://marknote.localhost/image-1");
    resolver.setDocumentPath("C:\\two\\document.md");
    await expect(resolver("./assets/logo.png")).resolves.toBe("http://marknote.localhost/image-2");

    expect(tauri.invoke).toHaveBeenCalledTimes(2);
    expect(tauri.invoke).toHaveBeenLastCalledWith("resolve_image", {
      docPath: "C:\\two\\document.md",
      src: "./assets/logo.png",
    });
  });

  it("resolves marknote-cache sources even when document is not saved", async () => {
    tauri.invoke.mockResolvedValue("http://marknote.localhost/cached-image");
    const resolver = createImageResolver(null);

    await expect(resolver("marknote-cache/photo.png")).resolves.toBe("http://marknote.localhost/cached-image");
    expect(tauri.invoke).toHaveBeenCalledWith("resolve_image", {
      docPath: null,
      src: "marknote-cache/photo.png",
    });
  });

  it("reports that relative paths cannot resolve before the document is saved unless marknote-cache", async () => {
    const resolver = createImageResolver(null);

    await expect(resolver("./assets/logo.png")).rejects.toThrow(/saved document path/iu);
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("invalidates cache for a specific src or all entries", async () => {
    tauri.invoke
      .mockResolvedValueOnce("http://marknote.localhost/img-v1")
      .mockResolvedValueOnce("http://marknote.localhost/img-v2")
      .mockResolvedValueOnce("http://marknote.localhost/img-v3");
    const resolver = createImageResolver("C:\\notes\\doc.md");

    await expect(resolver("./img.png")).resolves.toBe("http://marknote.localhost/img-v1");
    await expect(resolver("./img.png")).resolves.toBe("http://marknote.localhost/img-v1");
    expect(tauri.invoke).toHaveBeenCalledTimes(1);

    resolver.invalidate("./img.png");
    await expect(resolver("./img.png")).resolves.toBe("http://marknote.localhost/img-v2");
    expect(tauri.invoke).toHaveBeenCalledTimes(2);

    resolver.invalidate();
    await expect(resolver("./img.png")).resolves.toBe("http://marknote.localhost/img-v3");
    expect(tauri.invoke).toHaveBeenCalledTimes(3);
  });

  it("turns read errors into a handled rejected promise", async () => {
    tauri.invoke.mockRejectedValue(new Error("file is missing"));
    const resolver = createImageResolver("C:\\notes\\document.md");

    await expect(resolver("./missing.png")).rejects.toThrow(/Failed to load image.*file is missing/iu);
    await expect(resolver("./missing.png")).rejects.toThrow(/Failed to load image/iu);
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
  });
});
