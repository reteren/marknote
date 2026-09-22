import { describe, expect, it } from "vitest";
import { formatBytes } from "../src/editor/imageResolver";

describe("formatBytes", () => {
  it("formats zero and non-positive values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-10)).toBe("0 B");
    expect(formatBytes(NaN)).toBe("0 B");
    expect(formatBytes(Infinity)).toBe("0 B");
  });

  it("formats bytes under 1 KB", () => {
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats kilobytes and megabytes", () => {
    expect(formatBytes(1024, "en")).toBe("1 KB");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
    expect(formatBytes(1048576, "en")).toBe("1 MB");
    expect(formatBytes(16 * 1024 * 1024, "en")).toBe("16 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(1073741824, "en")).toBe("1 GB");
    expect(formatBytes(2.5 * 1073741824, "en")).toBe("2.5 GB");
  });

  it("respects locale in number formatting", () => {
    const formattedDe = formatBytes(1536, "de");
    // German locale uses comma as decimal separator: 1,5 KB
    expect(formattedDe).toBe("1,5 KB");
  });
});
