import type { FormatCapabilities } from "../state/formats.svelte";

export type MenuItem = {
  id: string;
  label: string;
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

export type MenuState = {
  editable?: boolean;
  readOnly?: boolean;
  hasSelection?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  canSave?: boolean;
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
    ...(shortcut ? { shortcut } : {}),
    separator: false,
    disabled,
    ...(submenu ? { submenu } : {}),
    ...(formatId ? { formatId } : {}),
  };
}

function separator(id: string): MenuItem {
  return { id, label: "", separator: true, disabled: true };
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
        format.label,
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
): MenuSection[] {
  const notEditable = state.editable === false || state.readOnly === true;
  const noSelection = state.hasSelection === false;
  const newFormats = newItems(formats, state);

  return [
    {
      id: "file",
      label: "File",
      items: [
        item("file.new", "New", "Ctrl+Shift+N", false, newFormats),
        item("file.newWindow", "New Window", "Ctrl+N"),
        separator("file.separator.open"),
        item("file.open", "Open…", "Ctrl+O"),
        separator("file.separator.save"),
        item("file.save", "Save", "Ctrl+S", state.canSave === false),
        item("file.saveAs", "Save As…", "Ctrl+Shift+S"),
        separator("file.separator.close"),
        item("file.close", "Close", "Ctrl+W"),
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        item("edit.undo", "Undo", "Ctrl+Z", state.canUndo === false),
        item("edit.redo", "Redo", "Ctrl+Shift+Z / Ctrl+Y", state.canRedo === false),
        separator("edit.separator.clipboard"),
        item("edit.cut", "Cut", "Ctrl+X", notEditable || noSelection),
        item("edit.copy", "Copy", "Ctrl+C", noSelection),
        item("edit.paste", "Paste", "Ctrl+V", notEditable),
        item("edit.pastePlainText", "Paste as Plain Text", "Ctrl+Shift+V", notEditable),
        item("edit.selectAll", "Select All", "Ctrl+A"),
        separator("edit.separator.search"),
        item("edit.find", "Find…", "Ctrl+F"),
        item("edit.replace", "Replace…", "Ctrl+H"),
        separator("edit.separator.lines"),
        item("edit.deleteLine", "Delete Line", "Ctrl+D", notEditable),
        item("edit.moveLineUp", "Move Line Up", "Alt+↑", notEditable),
        item("edit.moveLineDown", "Move Line Down", "Alt+↓", notEditable),
      ],
    },
    {
      id: "format",
      label: "Format",
      items: [
        item("format.bold", "Bold", "Ctrl+B", notEditable),
        item("format.italic", "Italic", "Ctrl+I", notEditable),
        item("format.strikethrough", "Strikethrough", "", notEditable),
        item("format.highlight", "Highlight", "", notEditable),
        item("format.code", "Code", "Ctrl+E", notEditable),
        item("format.link", "Link", "Ctrl+K", notEditable),
        separator("format.separator.headings"),
        item("format.heading1", "Heading 1", "Ctrl+1", notEditable),
        item("format.heading2", "Heading 2", "Ctrl+2", notEditable),
        item("format.heading3", "Heading 3", "Ctrl+3", notEditable),
        item("format.heading4", "Heading 4", "Ctrl+4", notEditable),
        item("format.heading5", "Heading 5", "Ctrl+5", notEditable),
        item("format.heading6", "Heading 6", "Ctrl+6", notEditable),
        item("format.clearHeading", "Remove Heading", "Ctrl+0", notEditable),
        separator("format.separator.blocks"),
        item("format.list", "List", "", notEditable),
        item("format.table", "Table", "", notEditable),
        item("format.callout", "Callout", "", notEditable),
        item("format.codeBlock", "Code Block", "Ctrl+Shift+K", notEditable),
        item("format.mathBlock", "Math Block", "", notEditable),
        item("format.horizontalRule", "Horizontal Rule", "", notEditable),
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        item("view.zoomIn", "Zoom In", "Ctrl+±"),
        item("view.zoomOut", "Zoom Out", "Ctrl+±"),
        item("view.resetZoom", "Reset Zoom", "Ctrl+0"),
      ],
    },
    {
      id: "help",
      label: "Help",
      items: [
        item("help.shortcuts", "Keyboard Shortcuts"),
        item("help.markdownReference", "Markdown Reference"),
        item("help.about", "About"),
      ],
    },
  ];
}

