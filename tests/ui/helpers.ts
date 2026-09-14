import type { FormatCapabilities } from "../../src/state/formats.svelte";

export function format(
  id: string,
  overrides: Partial<FormatCapabilities> = {},
): FormatCapabilities {
  return {
    id,
    label: id,
    defaultExtension: id,
    extensions: [id],
    editable: true,
    creatable: true,
    livePreview: false,
    autosave: true,
    lossy: false,
    syntaxMode: null,
    template: "",
    ...overrides,
  };
}

export async function settle(): Promise<void> {
  // Svelte's event handlers update runes on the next microtask.
  await Promise.resolve();
}
