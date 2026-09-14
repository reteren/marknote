import { WidgetType, type EditorView } from "@codemirror/view";

export class HrWidget extends WidgetType {
  eq(widget: WidgetType): boolean {
    return widget instanceof HrWidget;
  }

  toDOM(_view: EditorView): HTMLElement {
    const element = document.createElement("div");
    element.className = "cm-marknote-hr";
    element.setAttribute("role", "separator");
    return element;
  }
}
