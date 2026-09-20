// Editor settings represented as CodeMirror extensions.
//
// The integration point between the settings window and editor. The settings
// window writes values to settings.json through Rust, and the editor reads them
// here. Before this file existed, the settings window was a facade: more than
// thirty toggles were saved but never consulted.
//
// Everything controlled by settings lives in one compartment. Changing a
// setting therefore does not recreate the editor, so undo history, cursor
// position, and scroll position are preserved.
//
// Settings sections live in separate neighboring files, with one owner per
// file. This file only assembles them and should not be edited except by the coordinator.

import { Compartment, StateEffect, StateField, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Settings } from "../state/settings.svelte";
import { editorAppearanceExtensions } from "./settings/appearance";
import { livePreviewSettingsExtensions } from "./settings/preview";
import { spellcheckSettingsExtensions } from "./settings/spellcheck";

/** Compartment containing all settings-dependent extensions. */
export const settingsCompartment = new Compartment();

/** Last settings applied to the state. Tabs need this because after view.setState
 * the compartment is reconfigured with the active state's values instead of
 * reverting to a stale tab snapshot. */
export const setEditorSettingsEffect = StateEffect.define<Settings | null>();

/** Tracks the active format for the settings compartment without importing
 * createEditor back into this module. */
export const setEditorFormatSyntaxEffect = StateEffect.define<boolean>();

export const editorFormatSyntaxStateField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setEditorFormatSyntaxEffect)) return effect.value;
    }
    return value;
  },
});

/**
 * Whether the open format supports Markdown markup. Markup commands (bold,
 * headings, inserts) read this field and stay silent where markup is absent:
 * wrapping text in a .py or .json file with asterisks is pointless.
 * The flag comes from the format state, not from the extension list.
 */
export const setEditorMarkdownCommandsEffect = StateEffect.define<boolean>();

export const editorMarkdownCommandsStateField = StateField.define<boolean>({
  // Enabled by default: the editor outside the app (in tests and the browser)
  // works with Markdown, and commands must work there.
  create: () => true,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setEditorMarkdownCommandsEffect)) return effect.value;
    }
    return value;
  },
});

export const editorSettingsStateField = StateField.define<Settings | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setEditorSettingsEffect)) return effect.value;
    }
    return value;
  },
});

/** Extensions corresponding to the current settings.
 *
 *  Settings may be absent: the editor starts before Rust can provide settings.json,
 *  so defaults apply until then. Each check is therefore written so a missing
 *  value produces the same behavior that createEditor had before settings existed. */
export function editorSettingsExtensions(settings: Settings | null, formatHasSyntaxMode = false): Extension[] {
  return [
    ...editorAppearanceExtensions(settings, formatHasSyntaxMode),
    ...livePreviewSettingsExtensions(settings),
    ...spellcheckSettingsExtensions(settings),
  ];
}

/** Applies settings to a live editor without recreating it. */
export function applyEditorSettings(view: EditorView, settings: Settings | null): void {
  const formatHasSyntaxMode = view.state.field(editorFormatSyntaxStateField, false) ?? false;
  view.dispatch({
    effects: [
      settingsCompartment.reconfigure(editorSettingsExtensions(settings, formatHasSyntaxMode)),
      setEditorSettingsEffect.of(settings),
    ],
    selection: view.state.selection,
  });
}
