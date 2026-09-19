// Настройки редактора, превращённые в расширения CodeMirror.
//
// Точка стыка между окном настроек и редактором. Окно настроек пишет значения
// в settings.json через Rust, редактор читает их отсюда. До появления этого
// файла окно настроек было витриной: тридцать с лишним переключателей
// сохранялись и никем не спрашивались.
//
// Всё, что зависит от настроек, живёт в одном отсеке (Compartment). Значит,
// смена настройки не пересоздаёт редактор — не теряются ни история отмены, ни
// положение курсора, ни прокрутка.
//
// Разделы настроек живут в отдельных файлах рядом, по одному владельцу на
// файл. Здесь только сборка: этот файл никто, кроме координатора, не правит.

import { Compartment, StateEffect, StateField, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Settings } from "../state/settings.svelte";
import { editorAppearanceExtensions } from "./settings/appearance";
import { livePreviewSettingsExtensions } from "./settings/preview";
import { spellcheckSettingsExtensions } from "./settings/spellcheck";

/** Отсек, в котором живут все зависящие от настроек расширения. */
export const settingsCompartment = new Compartment();

/** Последние настройки, применённые к состоянию. Нужны вкладкам: после
 * view.setState отсек перенастраивается теми же значениями, что были у
 * активного состояния, а не возвращается к устаревшему снимку вкладки. */
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
 * Поддерживает ли открытый формат разметку Markdown. Команды разметки
 * (жирный, заголовки, вставки) читают это поле и молчат там, где разметки
 * нет: в .py или .json оборачивать текст звёздочками бессмысленно.
 * Признак приходит из состояния формата, а не из списка расширений.
 */
export const setEditorMarkdownCommandsEffect = StateEffect.define<boolean>();

export const editorMarkdownCommandsStateField = StateField.define<boolean>({
  // По умолчанию разрешено: редактор вне приложения (в тестах и в браузере)
  // работает с Markdown, и команды там должны действовать.
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

/** Расширения, соответствующие текущим настройкам.
 *
 *  Настройки могут отсутствовать: редактор поднимается раньше, чем Rust
 *  успевает отдать settings.json, и до этого момента работают умолчания.
 *  Поэтому каждая проверка написана так, чтобы отсутствие значения давало то
 *  же поведение, что было зашито в createEditor до появления настроек. */
export function editorSettingsExtensions(settings: Settings | null, formatHasSyntaxMode = false): Extension[] {
  return [
    ...editorAppearanceExtensions(settings, formatHasSyntaxMode),
    ...livePreviewSettingsExtensions(settings),
    ...spellcheckSettingsExtensions(settings),
  ];
}

/** Применить настройки к живому редактору, не пересоздавая его. */
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
