import type { EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { BlockBuilder, BuilderContext } from "./types";

export const KNOWN_CALLOUT_TYPES = new Set([
  "note",
  "tip",
  "warning",
  "danger",
  "info",
  "success",
  "question",
  "quote",
  "example",
]);

export function normalizeCalloutType(type: string): string {
  const lower = type.toLowerCase();
  return KNOWN_CALLOUT_TYPES.has(lower) ? lower : "note";
}

/** Inline SVG icons for the nine standard Obsidian callout types. */
export function calloutSvg(type: string): string {
  const normalized = normalizeCalloutType(type);
  switch (normalized) {
    case "tip":
      // Lightbulb
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.5 4.5 3 6h8c1.5-1.5 3-3.5 3-6a7 7 0 0 0-7-7z"/></svg>`;
    case "warning":
      // Alert triangle
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    case "danger":
      // Alert octagon
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    case "info":
      // Info circle
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    case "success":
      // Check circle
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    case "question":
      // Help circle
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    case "quote":
      // Quote icon
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/></svg>`;
    case "example":
      // List / clipboard
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
    case "note":
    default:
      // Edit / pencil
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  }
}

export class CalloutIconWidget extends WidgetType {
  constructor(readonly type: string) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof CalloutIconWidget && other.type === this.type;
  }

  toDOM(): HTMLElement {
    if (typeof document === "undefined") return {} as HTMLElement;
    const span = document.createElement("span");
    span.className = "cm-marknote-callout-icon";
    span.innerHTML = calloutSvg(this.type);
    return span;
  }
}

export class CalloutHeaderWidget extends WidgetType {
  constructor(
    readonly type: string,
    readonly title: string,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof CalloutHeaderWidget &&
      other.type === this.type &&
      other.title === this.title
    );
  }

  toDOM(): HTMLElement {
    if (typeof document === "undefined") return {} as HTMLElement;
    const container = document.createElement("span");
    container.className = "cm-marknote-callout-header";

    const icon = document.createElement("span");
    icon.className = "cm-marknote-callout-icon";
    icon.innerHTML = calloutSvg(this.type);
    container.appendChild(icon);

    const titleSpan = document.createElement("span");
    titleSpan.className = "cm-marknote-callout-title";
    titleSpan.textContent = this.title;
    container.appendChild(titleSpan);

    return container;
  }
}

type ParsedCallout = {
  isCallout: true;
  type: string;
  normalizedType: string;
  hasCustomTitle: boolean;
  title: string;
  quoteFrom: number;
  quoteTo: number;
  markerFrom: number;
  markerTo: number;
  titleFrom: number;
  titleTo: number;
};

const CALLOUT_RE = /^\s*>\s*\[!([^\]\s]+)\][ \t]*(.*)$/;

function parseCallout(node: SyntaxNode, state: EditorState): ParsedCallout | null {
  const firstLine = state.doc.lineAt(node.from);
  const text = firstLine.text;
  const match = CALLOUT_RE.exec(text);
  if (!match) return null;

  const rawType = match[1];
  const normalizedType = normalizeCalloutType(rawType);
  const customTitle = match[2].trim();
  const hasCustomTitle = customTitle.length > 0;
  const defaultTitle = normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1);
  const title = hasCustomTitle ? customTitle : defaultTitle;

  const quoteIdx = text.indexOf(">");
  const quoteFrom = firstLine.from + quoteIdx;
  const quoteTo = quoteFrom + 1;

  const markerIdx = text.indexOf("[!");
  const markerEndIdx = text.indexOf("]", markerIdx) + 1;
  const markerFrom = firstLine.from + markerIdx;
  const markerTo = firstLine.from + markerEndIdx;

  let titleFrom = markerTo;
  while (titleFrom < firstLine.to && /\s/.test(state.doc.sliceString(titleFrom, titleFrom + 1))) {
    titleFrom++;
  }
  const titleTo = firstLine.to;

  return {
    isCallout: true,
    type: rawType,
    normalizedType,
    hasCustomTitle,
    title,
    quoteFrom,
    quoteTo,
    markerFrom,
    markerTo,
    titleFrom,
    titleTo,
  };
}

/** Decoration builder for callout blocks and quotes (W6). */
export const calloutBuilder: BlockBuilder = (ctx: BuilderContext): boolean => {
  if (ctx.node.name !== "Blockquote" && ctx.node.name !== "Callout") return false;

  // Recognize a callout either from the tree or from a regular expression on the first line.
  const callout = parseCallout(ctx.node, ctx.view.state);

  if (callout) {
    // Cursor inside the block: show the original Markdown without hiding decorations.
    if (ctx.active) return true;

    const hide = Decoration.replace({});
    const firstLine = ctx.view.state.doc.lineAt(ctx.node.from);
    const lastLine = ctx.view.state.doc.lineAt(ctx.node.to);

    // 1. Style the whole callout block (colored left bar and background).
    ctx.add({
      from: ctx.node.from,
      to: ctx.node.to,
      value: Decoration.mark({
        class: `cm-marknote-callout cm-marknote-callout-${callout.normalizedType}`,
      }),
    });

    // 2. Hide the `>` marker on the first line.
    if (callout.quoteTo > callout.quoteFrom) {
      ctx.add({ from: callout.quoteFrom, to: callout.quoteTo, value: hide });
      ctx.atomic({ from: callout.quoteFrom, to: callout.quoteTo, value: hide });
    }

    // 3. The [!TYPE] marker and heading.
    if (callout.hasCustomTitle) {
      // Custom heading: replace `[!TYPE]` and the spaces with an icon widget,
      // and style the heading text as a heading.
      const iconWidget = Decoration.replace({
        widget: new CalloutIconWidget(callout.normalizedType),
      });
      ctx.add({ from: callout.markerFrom, to: callout.titleFrom, value: iconWidget });
      ctx.atomic({ from: callout.markerFrom, to: callout.titleFrom, value: iconWidget });

      if (callout.titleTo > callout.titleFrom) {
        ctx.add({
          from: callout.titleFrom,
          to: callout.titleTo,
          value: Decoration.mark({ class: "cm-marknote-callout-title" }),
        });
      }
    } else {
      // Without a custom heading: replace `[!TYPE]` (and the rest of the line)
      // with a widget containing the icon and type name.
      const headerWidget = Decoration.replace({
        widget: new CalloutHeaderWidget(callout.normalizedType, callout.title),
      });
      const endPos = Math.max(callout.markerTo, callout.titleTo);
      ctx.add({ from: callout.markerFrom, to: endPos, value: headerWidget });
      ctx.atomic({ from: callout.markerFrom, to: endPos, value: headerWidget });
    }

    // 4. Hide `>` markers on subsequent lines of the callout block.
    for (let lineNo = firstLine.number + 1; lineNo <= lastLine.number; lineNo++) {
      const line = ctx.view.state.doc.line(lineNo);
      const lineStartInNode = Math.max(0, ctx.node.from - line.from);
      const qIdx = line.text.indexOf(">", lineStartInNode);
      if (qIdx >= 0) {
        const qFrom = line.from + qIdx;
        const qTo = qFrom + 1;
        ctx.add({ from: qFrom, to: qTo, value: hide });
        ctx.atomic({ from: qFrom, to: qTo, value: hide });
      }
    }

    return true;
  }

  // Ordinary quote without [!TYPE].
  if (ctx.node.name === "Blockquote") {
    // Cursor inside the quote: show the original text.
    if (ctx.active) return true;

    const hide = Decoration.replace({});

    // 1. Style the quote (vertical line on the left).
    ctx.add({
      from: ctx.node.from,
      to: ctx.node.to,
      value: Decoration.mark({ class: "cm-marknote-blockquote" }),
    });

    // 2. Hide quote `>` markers on every line.
    const startLine = ctx.view.state.doc.lineAt(ctx.node.from);
    const endLine = ctx.view.state.doc.lineAt(ctx.node.to);
    for (let l = startLine.number; l <= endLine.number; l++) {
      const line = ctx.view.state.doc.line(l);
      const lineStartInNode = Math.max(0, ctx.node.from - line.from);
      const qIdx = line.text.indexOf(">", lineStartInNode);
      if (qIdx >= 0) {
        const qFrom = line.from + qIdx;
        const qTo = qFrom + 1;
        ctx.add({ from: qFrom, to: qTo, value: hide });
        ctx.atomic({ from: qFrom, to: qTo, value: hide });
      }
    }

    return true;
  }

  return false;
};

/** CSS theme for callout blocks and quotes. Uses tokens from theme.css. */
export const calloutTheme = EditorView.baseTheme({
  ".cm-marknote-callout": {
    display: "inline-block",
    width: "100%",
    boxSizing: "border-box",
    borderLeft: "3px solid rgba(var(--callout-color, var(--callout-note)), 1)",
    backgroundColor: "rgba(var(--callout-color, var(--callout-note)), 0.08)",
    padding: "0.4em 0.8em",
    borderRadius: "var(--radius-s)",
    margin: "0.4em 0",
  },
  ".cm-marknote-callout-note": { "--callout-color": "var(--callout-note)" },
  ".cm-marknote-callout-tip": { "--callout-color": "var(--callout-tip)" },
  ".cm-marknote-callout-info": { "--callout-color": "var(--callout-info)" },
  ".cm-marknote-callout-success": { "--callout-color": "var(--callout-success)" },
  ".cm-marknote-callout-question": { "--callout-color": "var(--callout-question)" },
  ".cm-marknote-callout-warning": { "--callout-color": "var(--callout-warning)" },
  ".cm-marknote-callout-danger": { "--callout-color": "var(--callout-danger)" },
  ".cm-marknote-callout-example": { "--callout-color": "var(--callout-example)" },
  ".cm-marknote-callout-quote": { "--callout-color": "var(--callout-quote)" },

  ".cm-marknote-callout-header": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4em",
    fontWeight: "var(--h3-weight)",
    color: "rgba(var(--callout-color, var(--callout-note)), 1)",
  },
  ".cm-marknote-callout-icon": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    height: "16px",
    marginRight: "0.35em",
    verticalAlign: "-0.15em",
    color: "rgba(var(--callout-color, var(--callout-note)), 1)",
  },
  ".cm-marknote-callout-icon svg": {
    width: "16px",
    height: "16px",
    display: "block",
  },
  ".cm-marknote-callout-title": {
    fontWeight: "var(--h3-weight)",
    color: "rgba(var(--callout-color, var(--callout-note)), 1)",
  },
  ".cm-marknote-blockquote": {
    borderLeft: "2px solid var(--bg-modifier-border)",
    paddingLeft: "0.8em",
    margin: "0.2em 0",
    color: "var(--text-muted)",
  },
});
