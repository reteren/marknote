import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TabBar from "../../src/ui/TabBar.svelte";
import {
  workspace,
  openTab,
  closeTab,
  activateTab,
  createDocumentState,
} from "../../src/state/workspace.svelte";
import { markdownFormat, plainFormat } from "../../src/state/formats.svelte";
import { translate as t } from "../../src/i18n";

function resetWorkspace(): void {
  workspace.tabs.splice(0, workspace.tabs.length, {
    id: "tab-1",
    document: createDocumentState({ path: null, text: "" }),
  });
  workspace.activeId = "tab-1";
}

beforeEach(() => {
  resetWorkspace();
});

afterEach(() => {
  cleanup();
  resetWorkspace();
});

describe("TabBar UI component", () => {
  it("shows the strip even with one tab, together with the plus button", () => {
    // The strip is permanent: the owner described it as the zone between the
    // menu bar and text, with the plus on the right of the last tab. Hiding it
    // with one tab would place the plus somewhere unrelated.
    expect(workspace.tabs.length).toBe(1);
    const { container } = render(TabBar);
    expect(container.querySelector(".tab-bar-strip")).not.toBeNull();
    expect(container.querySelectorAll('.tab[role="tab"]')).toHaveLength(1);
    expect(container.querySelector(".tab-new-btn")).not.toBeNull();
  });

  it("renders tab strip when 2 or more tabs exist", () => {
    openTab({ path: "C:/docs/first.md" });
    expect(workspace.tabs.length).toBe(2);

    const { container } = render(TabBar);
    const strip = container.querySelector(".tab-bar-strip");
    expect(strip).not.toBeNull();
    const tabs = container.querySelectorAll('.tab[role="tab"]');
    expect(tabs.length).toBe(2);
  });

  it("displays file name, first words of untitled text, and format badges", () => {
    workspace.tabs.splice(0, workspace.tabs.length,
      {
        id: "tab-1",
        document: createDocumentState({ path: "C:/projects/todo.md", format: markdownFormat }),
      },
      {
        id: "tab-2",
        document: createDocumentState({ path: null, text: "Idea for a new feature", format: markdownFormat }),
      },
      {
        id: "tab-3",
        document: createDocumentState({ path: null, text: "", format: plainFormat }),
      },
    );
    workspace.activeId = "tab-1";

    const { container } = render(TabBar);
    const tabElements = container.querySelectorAll('.tab[role="tab"]');
    expect(tabElements.length).toBe(3);

    // Tab 1: file name
    expect(tabElements[0].querySelector(".tab-title")?.textContent).toBe("todo.md");
    expect(tabElements[0].querySelector(".tab-format")?.textContent).toBe(".md");

    // Tab 2: first words of text
    expect(tabElements[1].querySelector(".tab-title")?.textContent).toBe("Idea for a new feature");

    // Tab 3: translated Untitled
    expect(tabElements[2].querySelector(".tab-title")?.textContent).toBe(t("tabs.untitled"));
    expect(tabElements[2].querySelector(".tab-format")?.textContent).toBe(".txt");
  });

  it("highlights active tab and sets accessible aria attributes", () => {
    workspace.tabs.splice(0, workspace.tabs.length,
      {
        id: "tab-1",
        document: createDocumentState({ path: "C:/file1.md" }),
      },
      {
        id: "tab-2",
        document: createDocumentState({ path: "C:/file2.md" }),
      },
    );
    workspace.activeId = "tab-2";

    const { container } = render(TabBar);
    const tab1 = container.querySelector("#workspace-tab-tab-1");
    const tab2 = container.querySelector("#workspace-tab-tab-2");

    expect(tab1?.classList.contains("active")).toBe(false);
    expect(tab1?.getAttribute("aria-selected")).toBe("false");
    expect(tab1?.getAttribute("tabindex")).toBe("-1");

    expect(tab2?.classList.contains("active")).toBe(true);
    expect(tab2?.getAttribute("aria-selected")).toBe("true");
    expect(tab2?.getAttribute("tabindex")).toBe("0");
  });

  it("calls onSelectTab when clicking a tab", async () => {
    const onSelectTab = vi.fn();
    workspace.tabs.splice(0, workspace.tabs.length,
      { id: "tab-1", document: createDocumentState({ path: "C:/file1.md" }) },
      { id: "tab-2", document: createDocumentState({ path: "C:/file2.md" }) },
    );
    workspace.activeId = "tab-1";

    const { container } = render(TabBar, { props: { onSelectTab } });
    const tab2 = container.querySelector("#workspace-tab-tab-2");
    expect(tab2).not.toBeNull();

    await fireEvent.click(tab2!);
    expect(onSelectTab).toHaveBeenCalledWith("tab-2");
  });

  it("calls onCloseTab when clicking tab close button without selecting the tab", async () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    workspace.tabs.splice(0, workspace.tabs.length,
      { id: "tab-1", document: createDocumentState({ path: "C:/file1.md" }) },
      { id: "tab-2", document: createDocumentState({ path: "C:/file2.md" }) },
    );
    workspace.activeId = "tab-1";

    const { container } = render(TabBar, { props: { onSelectTab, onCloseTab } });
    const closeBtn = container.querySelector("#workspace-tab-tab-2 .tab-close-btn");
    expect(closeBtn).not.toBeNull();

    await fireEvent.click(closeBtn!);
    expect(onCloseTab).toHaveBeenCalledWith("tab-2");
    expect(onSelectTab).not.toHaveBeenCalled();
  });

  it("calls onNewTab when clicking the plus button", async () => {
    const onNewTab = vi.fn();
    workspace.tabs.splice(0, workspace.tabs.length,
      { id: "tab-1", document: createDocumentState({ path: "C:/file1.md" }) },
      { id: "tab-2", document: createDocumentState({ path: "C:/file2.md" }) },
    );

    const { container } = render(TabBar, { props: { onNewTab } });
    const newBtn = container.querySelector(".tab-new-btn");
    expect(newBtn).not.toBeNull();

    await fireEvent.click(newBtn!);
    expect(onNewTab).toHaveBeenCalled();
  });

  it("supports keyboard navigation with arrow keys and delete", async () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    workspace.tabs.splice(0, workspace.tabs.length,
      { id: "tab-1", document: createDocumentState({ path: "C:/file1.md" }) },
      { id: "tab-2", document: createDocumentState({ path: "C:/file2.md" }) },
    );
    workspace.activeId = "tab-1";

    const { container } = render(TabBar, { props: { onSelectTab, onCloseTab } });
    const tab1 = container.querySelector("#workspace-tab-tab-1");

    await fireEvent.keyDown(tab1!, { key: "ArrowRight" });
    expect(onSelectTab).toHaveBeenCalledWith("tab-2");

    await fireEvent.keyDown(tab1!, { key: "Delete" });
    expect(onCloseTab).toHaveBeenCalledWith("tab-1");
  });
});
