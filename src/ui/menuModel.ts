import type { FormatCapabilities } from "../state/formats.svelte";
import { formatLabel, interfaceLanguage, translate as t } from "../i18n";
import { settingsState } from "../state/settings.svelte";

export type MenuItemKind = "item" | "separator" | "label";

export type MenuItem = {
  id: string;
  label: string;
  kind?: MenuItemKind;
  shortcut?: string;
  separator: boolean;
  disabled: boolean;
  submenu?: MenuItem[];
  /** Формат заполняется только у пунктов File → New, чтобы обработчик не парсил label. */
  formatId?: string;
};

export type MenuSection = {
  id: string;
  label: string;
  items: MenuItem[];
};

export type MenuGroup = {
  label: string;
  items: MenuItem[];
};

export type MenuState = {
  editable?: boolean;
  readOnly?: boolean;
  hasSelection?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  canSave?: boolean;
  formatId?: string;
  zoomPercent?: number;
};

function item(
  id: string,
  label: string,
  shortcut = "",
  disabled = false,
  submenu?: MenuItem[],
  formatId?: string,
): MenuItem {
  return {
    id,
    label,
    kind: "item",
    ...(shortcut ? { shortcut } : {}),
    separator: false,
    disabled,
    ...(submenu ? { submenu } : {}),
    ...(formatId ? { formatId } : {}),
  };
}

function separator(id: string): MenuItem {
  return { id, label: "", kind: "separator", separator: true, disabled: true };
}

function caption(id: string, label: string): MenuItem {
  return { id, label, kind: "label", separator: false, disabled: false };
}

function formatZoom(percent: number, locale = interfaceLanguage.locale): string {
  const safe = Number.isFinite(percent) ? percent : 100;
  const formatted = new Intl.NumberFormat(locale, { style: "percent" }).format(safe / 100);
  return t("menu.zoomPercent", { percent: formatted });
}

function newItems(formats: readonly FormatCapabilities[], state: MenuState): MenuItem[] {
  const seen = new Set<string>();
  return formats
    .filter((format) => format.creatable !== false && format.id.length > 0)
    .filter((format) => {
      if (seen.has(format.id)) return false;
      seen.add(format.id);
      return true;
    })
    .map((format) =>
      item(
        `file.new.${format.id}`,
        formatLabel(format.id, format.label),
        "",
        format.editable === false || state.readOnly === true,
        undefined,
        format.id,
      ),
    );
}

/**
 * Возвращает данные меню без побочных эффектов. Действия выполняются только
 * обработчиком MenuBar, получившим id выбранного пункта.
 */
export function createMenuModel(
  formats: readonly FormatCapabilities[] = [],
  state: MenuState = {},
  zoomPercent?: number,
): MenuSection[] {
  const notEditable = state.editable === false || state.readOnly === true;
  const noSelection = state.hasSelection === false;
  const newFormats = newItems(formats, state);
  const currentZoom = zoomPercent ?? state.zoomPercent ?? settingsState.settings.editor.zoomPercent;

  return [
    {
      id: "file",
      label: t("menu.file"),
      items: [
        item("file.new", t("menu.new"), "Ctrl+Shift+N", false, newFormats),
        item("file.newWindow", t("menu.newWindow"), "Ctrl+N"),
        separator("file.separator.open"),
        item("file.open", t("menu.open"), "Ctrl+O"),
        separator("file.separator.save"),
        item("file.save", t("menu.save"), "Ctrl+S", state.canSave === false),
        item("file.saveAs", t("menu.saveAs"), "Ctrl+Shift+S"),
        separator("file.separator.close"),
        item("file.close", t("menu.close"), "Ctrl+W"),
        separator("file.separator.settings"),
        item("file.settings", t("menu.settings"), "Ctrl+,"),
      ],
    },
    {
      id: "edit",
      label: t("menu.edit"),
      items: [
        item("edit.undo", t("menu.undo"), "Ctrl+Z", state.canUndo === false),
        item("edit.redo", t("menu.redo"), "Ctrl+Shift+Z / Ctrl+Y", state.canRedo === false),
        separator("edit.separator.clipboard"),
        item("edit.cut", t("menu.cut"), "Ctrl+X", notEditable || noSelection),
        item("edit.copy", t("menu.copy"), "Ctrl+C", noSelection),
        item("edit.paste", t("menu.paste"), "Ctrl+V", notEditable),
        item("edit.pastePlainText", t("menu.pastePlainText"), "Ctrl+Shift+V", notEditable),
        item("edit.selectAll", t("menu.selectAll"), "Ctrl+A"),
        separator("edit.separator.search"),
        item("edit.find", t("menu.find"), "Ctrl+F"),
        item("edit.replace", t("menu.replace"), "Ctrl+H"),
        separator("edit.separator.lines"),
        item("edit.deleteLine", t("menu.deleteLine"), "Ctrl+D", notEditable),
        item("edit.moveLineUp", t("menu.moveLineUp"), "Alt+↑", notEditable),
        item("edit.moveLineDown", t("menu.moveLineDown"), "Alt+↓", notEditable),
      ],
    },
    {
      id: "view",
      label: t("menu.view"),
      items: [
        caption("view.zoomPercent", formatZoom(currentZoom)),
        item("view.zoomIn", t("menu.zoomIn"), 'Ctrl + “+”'),
        item("view.zoomOut", t("menu.zoomOut"), 'Ctrl + “-”'),
        item("view.resetZoom", t("menu.resetZoom"), "Ctrl+0"),
      ],
    },
    {
      id: "help",
      label: t("menu.help"),
      items: [
        item("help.shortcuts", t("menu.keyboardShortcuts")),
        item("help.markdownReference", t("menu.markdownReference")),
        item("help.about", t("menu.about")),
      ],
    },
  ];
}

/** Formatting commands shared with the context-menu submenus (not a top-level section). */
export function createContextFormatGroups(state: MenuState = {}): MenuGroup[] {
  const notEditable = state.editable === false || state.readOnly === true;
  return [
    {
      label: t("contextMenu.formatting"),
      items: [
        item("format.bold", t("format.bold"), "Ctrl+B", notEditable),
        item("format.italic", t("format.italic"), "Ctrl+I", notEditable),
        item("format.strikethrough", t("format.strikethrough"), "", notEditable),
        item("format.highlight", t("format.highlight"), "", notEditable),
        separator("format.separator.inline-code"),
        item("format.code", t("format.code"), "Ctrl+E", notEditable),
        item("format.link", t("format.link"), "Ctrl+K", notEditable),
        separator("format.separator.clear-formatting"),
        item("format.clearFormatting", t("format.clearFormatting"), "", notEditable),
      ],
    },
    {
      label: t("contextMenu.paragraph"),
      items: [
        item("format.list", t("format.bulletList"), "", notEditable),
        item("format.orderedList", t("format.orderedList"), "", notEditable),
        item("format.taskList", t("format.taskList"), "", notEditable),
        separator("format.separator.headings"),
        ...Array.from({ length: 6 }, (_, index) => {
          const level = index + 1;
          return item(`format.heading${level}`, t("format.heading", { level }), `Ctrl+${level}`, notEditable);
        }),
        separator("format.separator.clear-heading"),
        item("format.clearHeading", t("format.removeHeading"), "Ctrl+0", notEditable),
      ],
    },
    {
      label: t("contextMenu.insert"),
      items: [
        item("format.table", t("format.table"), "", notEditable),
        item("format.callout", t("format.callout"), "", notEditable),
        item("format.codeBlock", t("format.codeBlock"), "Ctrl+Shift+K", notEditable),
        item("format.mathBlock", t("format.mathBlock"), "", notEditable),
        item("format.horizontalRule", t("format.horizontalRule"), "", notEditable),
        ...(state.formatId === "json"
          ? [
              separator("format.separator.json"),
              item("format.jsonValidate", "Validate JSON"),
              item("format.jsonFormat", "Format JSON", "", notEditable),
            ]
          : []),
      ],
    },
  ];
}
