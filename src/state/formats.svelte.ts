import { invoke } from "@tauri-apps/api/core";

/** Format capabilities received from Rust in camelCase. */
export type FormatCapabilities = {
  id: string;
  label: string;
  defaultExtension: string;
  extensions: string[];
  editable: boolean;
  creatable: boolean;
  livePreview: boolean;
  autosave: boolean;
  lossy: boolean;
  syntaxMode: string | null;
  template: string;
};

/**
 * Markdown commands are available only while the editor is using its
 * Markdown/live-preview language.  `livePreview` is a capability rather than
 * an extension-name convention, so formats that intentionally expose the
 * same Markdown editing surface (such as the lossy rich-text adapter) keep
 * their commands, while code/data formats do not.
 */
export function supportsMarkdownCommands(format: Pick<FormatCapabilities, "editable" | "livePreview" | "syntaxMode"> | null | undefined): boolean {
  return Boolean(format?.editable && format.livePreview && format.syntaxMode === null);
}

export const markdownFormat: FormatCapabilities = {
  id: "markdown",
  label: "Markdown",
  defaultExtension: "md",
  extensions: ["md", "markdown", "mdown", "mkd"],
  editable: true,
  creatable: true,
  livePreview: true,
  autosave: true,
  lossy: false,
  syntaxMode: null,
  template: "",
};

export const plainFormat: FormatCapabilities = {
  id: "plain",
  label: "Plain Text",
  defaultExtension: "txt",
  extensions: ["txt", "text"],
  editable: true,
  creatable: true,
  livePreview: false,
  autosave: true,
  lossy: false,
  syntaxMode: null,
  template: "",
};

const fallbackFormats = [markdownFormat, plainFormat];

export type FormatsState = {
  items: FormatCapabilities[];
  loading: boolean;
  error: string | null;
};

/** Shared state for the format-type list used by the start screen and menu. */
export const formatsState = $state<FormatsState>({
  items: fallbackFormats,
  loading: false,
  error: null,
});

export async function loadCreatableFormats(): Promise<FormatCapabilities[]> {
  formatsState.loading = true;
  formatsState.error = null;

  try {
    const formats = await invoke<FormatCapabilities[]>("list_creatable_formats");
    formatsState.items = formats.length > 0 ? formats : fallbackFormats;
    return formatsState.items;
  } catch (error) {
    // Before Tauri starts (and while developing the shell before W1), the UI
    // remains usable.
    formatsState.items = fallbackFormats;
    formatsState.error = error instanceof Error ? error.message : String(error);
    return formatsState.items;
  } finally {
    formatsState.loading = false;
  }
}
