import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentState } from "../src/state/workspace.svelte";
import {
  createRecoveryJournal,
  decideRecovery,
  RECOVERY_DEBOUNCE_MS,
  RECOVERY_MAX_WAIT_MS,
} from "../src/state/recovery";

describe("recovery journal timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces snapshots until 300 ms after the last edit", async () => {
    const document = createDocumentState({ text: "first", dirty: true });
    const writeSnapshot = vi.fn(async () => undefined);
    const journal = createRecoveryJournal({
      getState: () => document,
      getWindowLabel: () => "main",
      createJournalTabId: (tabId) => tabId,
      writeSnapshot,
    });

    journal.schedule("tab-1");
    await vi.advanceTimersByTimeAsync(RECOVERY_DEBOUNCE_MS - 1);
    expect(writeSnapshot).not.toHaveBeenCalled();

    document.text = "second";
    journal.schedule("tab-1");
    await vi.advanceTimersByTimeAsync(RECOVERY_DEBOUNCE_MS - 1);
    expect(writeSnapshot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(writeSnapshot).toHaveBeenCalledTimes(1);
    expect(writeSnapshot.mock.calls[0]?.[0].text).toBe("second");
    journal.dispose();
  });

  it("writes during continuous typing at the one-second max wait", async () => {
    const document = createDocumentState({ text: "0", dirty: true });
    const writeSnapshot = vi.fn(async () => undefined);
    const journal = createRecoveryJournal({
      getState: () => document,
      getWindowLabel: () => "main",
      createJournalTabId: (tabId) => tabId,
      writeSnapshot,
    });

    journal.schedule("tab-1");
    for (let elapsed = 250; elapsed < RECOVERY_MAX_WAIT_MS; elapsed += 250) {
      await vi.advanceTimersByTimeAsync(250);
      document.text += ".";
      journal.schedule("tab-1");
    }
    await vi.advanceTimersByTimeAsync(250);

    expect(writeSnapshot).toHaveBeenCalledTimes(1);
    expect(writeSnapshot.mock.calls[0]?.[0].text).toBe("0...");
    journal.dispose();
  });

  it("deletes a tab snapshot when the tab becomes clean", async () => {
    const document = createDocumentState({ text: "unsaved", dirty: true });
    const writeSnapshot = vi.fn(async () => undefined);
    const deleteSnapshot = vi.fn(async () => undefined);
    const journal = createRecoveryJournal({
      getState: () => document,
      getWindowLabel: () => "main",
      createJournalTabId: (tabId) => tabId,
      writeSnapshot,
      deleteSnapshot,
    });

    await journal.writeNow("tab-1");
    expect(writeSnapshot).toHaveBeenCalledTimes(1);
    document.dirty = false;
    journal.schedule("tab-1");
    await vi.waitFor(() => expect(deleteSnapshot).toHaveBeenCalledWith("tab-1", "main"));
    journal.dispose();
  });

  it("deletes a dirty tab snapshot after an explicit discard", async () => {
    const document = createDocumentState({ text: "discarded", dirty: true });
    const deleteSnapshot = vi.fn(async () => undefined);
    const journal = createRecoveryJournal({
      getState: () => document,
      getWindowLabel: () => "main",
      createJournalTabId: (tabId) => tabId,
      writeSnapshot: async () => undefined,
      deleteSnapshot,
    });

    await journal.writeNow("tab-1");
    await journal.discard("tab-1");
    expect(deleteSnapshot).toHaveBeenCalledWith("tab-1", "main");
    journal.dispose();
  });

  it("skips a snapshot when a large document's text and metadata are unchanged", async () => {
    const document = createDocumentState({ text: "large document ".repeat(100_000), dirty: true });
    const writeSnapshot = vi.fn(async () => undefined);
    const journal = createRecoveryJournal({
      getState: () => document,
      getWindowLabel: () => "main",
      createJournalTabId: (tabId) => tabId,
      writeSnapshot,
    });

    await journal.writeNow("tab-1");
    await journal.writeNow("tab-1");
    expect(writeSnapshot).toHaveBeenCalledTimes(1);
    journal.dispose();
  });
});

describe("recovery restore decisions", () => {
  const fingerprint = { size: 12, modified: "456" };

  it("restores an untitled entry as untitled", () => {
    expect(decideRecovery(null, null, null)).toBe("untitled");
  });

  it("keeps a path only while its disk fingerprint still matches", () => {
    expect(decideRecovery("note.md", fingerprint, { ...fingerprint })).toBe("restore-path");
    expect(decideRecovery("note.md", fingerprint, { size: 13, modified: "456" })).toBe("untitled-recovered");
    expect(decideRecovery("note.md", fingerprint, null)).toBe("untitled-recovered");
    expect(decideRecovery("note.md", { size: 12, modified: null }, { size: 12, modified: null }))
      .toBe("untitled-recovered");
  });
});
