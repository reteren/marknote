import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Notice from "../../src/ui/Notice.svelte";

afterEach(() => cleanup());

describe("Notice actions", () => {
  it.each([
    ["info", "ℹ"],
    ["warning", "⚠"],
    ["error", "✕"],
  ] as const)("renders the %s severity and invokes actions", async (severity, icon) => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(Notice, {
      props: {
        severity,
        message: `${severity} notice`,
        actions: [{ label: "Do it", action: "do-it" }],
        onAction,
        onClose,
      },
    });
    expect(document.body.textContent).toContain(icon);
    await fireEvent.click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Do it"))!);
    expect(onAction).toHaveBeenCalledWith("do-it");
    await fireEvent.click(document.querySelector<HTMLButtonElement>('[aria-label="Закрыть уведомление"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
