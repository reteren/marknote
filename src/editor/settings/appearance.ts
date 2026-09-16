// Раздел settings.editor: шрифт, размер, ширина колонки, табуляция,
// невидимые символы, подсветка строки, нумерация строк, мягкий перенос.
//
// Поле zoomPercent сюда не входит: масштаб живёт в src/editor/zoom.ts и
// работает по Ctrl +/- отдельно.
//
// Владелец файла — W85. Сборка расширений в ../settings.ts, туда не пишем.

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Settings } from "../../state/settings.svelte";

export function editorAppearanceExtensions(settings: Settings | null): Extension[] {
  const editor = settings?.editor;
  const extensions: Extension[] = [];

  // Мягкий перенос: без него появляется горизонтальная прокрутка. Раньше
  // EditorView.lineWrapping стоял в createEditor безусловно, поэтому
  // отсутствие настройки означает «включён».
  if (editor?.softWrap !== false) extensions.push(EditorView.lineWrapping);

  return extensions;
}
