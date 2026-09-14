import { invoke } from "@tauri-apps/api/core";

/** Возможности формата, которые приходят из Rust в camelCase. */
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

/** Единое состояние списка типов для стартового экрана и меню. */
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
    // До запуска Tauri (и при разработке каркаса раньше W1) интерфейс остаётся рабочим.
    formatsState.items = fallbackFormats;
    formatsState.error = error instanceof Error ? error.message : String(error);
    return formatsState.items;
  } finally {
    formatsState.loading = false;
  }
}

export function formatById(id: string): FormatCapabilities | undefined {
  return formatsState.items.find((format) => format.id === id);
}

export function formatByExtension(extension: string): FormatCapabilities {
  const normalized = extension.replace(/^\./, "").toLowerCase();
  return (
    formatsState.items.find((format) =>
      format.extensions.some((candidate) => candidate.toLowerCase() === normalized),
    ) ?? markdownFormat
  );
}
