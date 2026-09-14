import { WidgetType, type EditorView } from "@codemirror/view";

export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return widget instanceof CheckboxWidget && widget.checked === this.checked && widget.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className = `cm-marknote-checkbox${this.checked ? " is-checked" : ""}`;
    element.setAttribute("role", "checkbox");
    element.setAttribute("aria-checked", String(this.checked));
    element.setAttribute("aria-label", this.checked ? "Completed" : "Incomplete");
    element.tabIndex = -1;
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = view.state.doc.sliceString(this.from, this.from + 3);
      const checked = /^\[[xX]\]$/.test(current);
      view.dispatch({ changes: { from: this.from, to: this.from + 3, insert: checked ? "[ ]" : "[x]" } });
    });
    return element;
  }
}
