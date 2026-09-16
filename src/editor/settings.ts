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

import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Settings } from "../state/settings.svelte";

/** Отсек, в котором живут все зависящие от настроек расширения. */
export const settingsCompartment = new Compartment();

/** Расширения, соответствующие текущим настройкам.
 *
 *  Настройки могут отсутствовать: редактор поднимается раньше, чем Rust
 *  успевает отдать settings.json, и до этого момента работают умолчания.
 *  Поэтому каждая проверка написана так, чтобы отсутствие значения давало то
 *  же поведение, что было зашито в createEditor до появления настроек. */
export function editorSettingsExtensions(settings: Settings | null): Extension[] {
  const editor = settings?.editor;
  const extensions: Extension[] = [];

  // Мягкий перенос: без него появляется горизонтальная прокрутка.
  if (editor?.softWrap !== false) extensions.push(EditorView.lineWrapping);

  return extensions;
}

/** Применить настройки к живому редактору, не пересоздавая его. */
export function applyEditorSettings(view: EditorView, settings: Settings | null): void {
  view.dispatch({
    effects: settingsCompartment.reconfigure(editorSettingsExtensions(settings)),
  });
}
