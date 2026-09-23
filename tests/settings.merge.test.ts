import { beforeEach, describe, expect, it } from "vitest";
import { defaultSettings, settingsState, updateSettings } from "../src/state/settings.svelte";

describe("window settings merge", () => {
  beforeEach(() => {
    settingsState.settings = structuredClone(defaultSettings);
    settingsState.dirty = false;
    settingsState.error = null;
  });

  it("defaults external opens to a window and preserves the option across partial patches", () => {
    expect(settingsState.settings.windows.openFilesInTabs).toBe(false);

    updateSettings({ windows: { openFilesInTabs: true } }, { persist: false, applyLanguage: false });
    expect(settingsState.settings.windows.openFilesInTabs).toBe(true);

    updateSettings({ windows: { rememberSizeAndPosition: false } }, { persist: false, applyLanguage: false });
    expect(settingsState.settings.windows.openFilesInTabs).toBe(true);
    expect(settingsState.settings.windows.rememberSizeAndPosition).toBe(false);
    expect(settingsState.settings.windows.raiseExistingWindow).toBe(defaultSettings.windows.raiseExistingWindow);
  });
});
