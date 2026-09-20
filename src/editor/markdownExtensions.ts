import {
  BlockContext,
  InlineContext,
  GFM,
  type BlockParser,
  type Element,
  type InlineParser,
  type Line,
  type MarkdownConfig,
  type MarkdownExtension,
} from "@lezer/markdown";
import { tags as t } from "@lezer/highlight";

const highlightDelimiter = { resolve: "Highlight", mark: "HighlightMark" };
const commentDelimiter = { resolve: "Comment", mark: "CommentMark" };

/**
 * Brackets used by extended inline constructs. Lezer accepts these delimiters
 * in the same pass as the standard `~~`.
 */
const pairedInline = (config: {
  name: string;
  open: string;
  node: string;
  mark: string;
  delimiter: { resolve: string; mark: string };
  before?: string;
}): MarkdownConfig => {
  const width = config.open.length;
  return {
    defineNodes: [
      { name: config.node, style: t.content },
      { name: config.mark, style: t.processingInstruction },
    ],
    parseInline: [
      {
        name: config.name,
        before: config.before,
        parse(cx: InlineContext, next: number, pos: number) {
          if (next !== config.open.charCodeAt(0) || cx.slice(pos, pos + width) !== config.open)
            return -1;

          // A longer sequence belongs to a different pair.
          if (cx.slice(pos - 1, pos) === config.open[0] || cx.slice(pos + width, pos + width + 1) === config.open[0])
            return -1;

          const before = cx.slice(pos - 1, pos);
          const after = cx.slice(pos + width, pos + width + 1);
          const canOpen = !/\s/.test(after) && after.length > 0;
          const canClose = !/\s/.test(before) && before.length > 0;
          return cx.addDelimiter(config.delimiter, pos, pos + width, canOpen, canClose);
        },
      } as InlineParser,
    ],
  };
};

const Highlight: MarkdownConfig = pairedInline({
  name: "Highlight",
  open: "==",
  node: "Highlight",
  mark: "HighlightMark",
  delimiter: highlightDelimiter,
  before: "Emphasis",
});

const Comment: MarkdownConfig = pairedInline({
  name: "Comment",
  open: "%%",
  node: "Comment",
  mark: "CommentMark",
  delimiter: commentDelimiter,
  before: "Emphasis",
});

const InlineMath: MarkdownConfig = {
  defineNodes: [
    { name: "InlineMath", style: t.special(t.content) },
    { name: "MathMark", style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: "InlineMath",
      before: "Emphasis",
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 36 || cx.char(pos + 1) === 36) return -1;
        const before = cx.slice(pos - 1, pos);
        if (before === "\\") return -1;

        for (let end = pos + 1; end < cx.end; end++) {
          if (cx.char(end) !== 36 || cx.char(end - 1) === 92 || cx.char(end + 1) === 36) continue;
          return cx.addElement(
            cx.elt("InlineMath", pos, end + 1, [
              cx.elt("MathMark", pos, pos + 1),
              cx.elt("MathMark", end, end + 1),
            ]),
          );
        }
        return -1;
      },
    },
  ],
};

function endOfLine(cx: BlockContext, line: Line) {
  return cx.lineStart + line.text.length;
}

/** `$$ ... $$` blocks are collected as one node so the widget can replace them. */
const MathBlockParser: BlockParser = {
  name: "MarknoteMathBlock",
  before: "FencedCode",
  // A display-math opener is allowed to interrupt a paragraph.  Without
  // this hook the default paragraph leaf consumes `$$` when it follows text
  // without a blank line, so the block parser never gets a chance to see it.
  endLeaf(_cx: BlockContext, line: Line, _leaf) {
    const text = line.text.slice(line.pos);
    return /^\$\$(?!\$)/.test(text);
  },
  parse(cx: BlockContext, line: Line) {
    const text = line.text.slice(line.pos);
    if (!/^\$\$/.test(text) || /^\$\$\$/.test(text)) return false;

    const from = cx.lineStart + line.pos;
    const children: Element[] = [cx.elt("MathMark", from, from + 2)];
    let to = endOfLine(cx, line);
    const sameLine = text.slice(2).match(/\$\$/);
    if (sameLine) {
      const close = from + 2 + sameLine.index!;
      children.push(cx.elt("MathMark", close, close + 2));
      to = close + 2;
      cx.addElement(cx.elt("MathBlock", from, to, children));
      cx.nextLine();
      return true;
    }

    while (cx.nextLine()) {
      const next = line.text;
      if (/^\s*\$\$\s*$/.test(next)) {
        const closeStart = cx.lineStart + next.search(/\$\$/);
        children.push(cx.elt("MathMark", closeStart, closeStart + 2));
        to = endOfLine(cx, line);
        cx.addElement(cx.elt("MathBlock", from, to, children));
        cx.nextLine();
        return true;
      }
      to = endOfLine(cx, line);
    }

    // An unclosed formula still gets a node and remains editable.
    cx.addElement(cx.elt("MathBlock", from, to, children));
    cx.nextLine();
    return true;
  },
};

const calloutTypes = new Set(["note", "tip", "warning", "danger", "info", "success", "question", "quote", "example"]);
const calloutRE = /^\s*>\s*\[!([A-Za-z]+)\][ \t]*(.*)$/;

/** Extends an ordinary quote with a Callout node containing its type and first heading line. */
const CalloutParser: BlockParser = {
  name: "MarknoteCallout",
  before: "Blockquote",
  parse(cx: BlockContext, line: Line) {
    const text = line.text.slice(line.pos);
    const match = calloutRE.exec(text);
    if (!match) return false;

    const from = cx.lineStart + line.pos;
    const markerFrom = from + text.indexOf(">");
    const calloutMarkerFrom = from + text.indexOf("[!");
    const markerEnd = from + text.indexOf("]", text.indexOf("[!")) + 1;
    const titleFrom = from + (match.index ?? 0) + match[0].length - match[2].length;
    const children: Element[] = [
      cx.elt("CalloutMark", calloutMarkerFrom, Math.max(calloutMarkerFrom + 2, markerEnd), [
        cx.elt("CalloutType", calloutMarkerFrom + 2, Math.max(calloutMarkerFrom + 2, markerEnd - 1)),
      ]),
      cx.elt("CalloutTitle", titleFrom, endOfLine(cx, line), cx.parser.parseInline(match[2], titleFrom)),
    ];
    let to = endOfLine(cx, line);

    while (cx.peekLine() !== "") {
      const next = cx.peekLine();
      if (!/^\s*>/.test(next)) break;
      cx.nextLine();
      const quoteMarker = line.text.indexOf(">");
      if (quoteMarker >= 0) {
        children.push(cx.elt("QuoteMark", cx.lineStart + quoteMarker, cx.lineStart + quoteMarker + 1));
        let contentFrom = quoteMarker + 1;
        while (contentFrom < line.text.length && (line.text.charCodeAt(contentFrom) === 32 || line.text.charCodeAt(contentFrom) === 9)) contentFrom++;
        const contentTo = line.text.length;
        if (contentFrom < contentTo) {
          children.push(cx.elt("CalloutBody", cx.lineStart + contentFrom, cx.lineStart + contentTo,
            cx.parser.parseInline(line.text.slice(contentFrom), cx.lineStart + contentFrom)));
        }
      }
      to = endOfLine(cx, line);
    }
    cx.nextLine();
    const callout = cx.elt("Callout", markerFrom + 1, to, children);
    cx.addElement(cx.elt("Blockquote", from, to, [cx.elt("QuoteMark", markerFrom, markerFrom + 1), callout]));
    return true;
  },
};

const footnoteInlineRE = /^\[\^([^\]\s]+)\]/;

const FootnoteReference: MarkdownConfig = {
  defineNodes: [
    { name: "FootnoteReference", style: t.labelName },
    { name: "FootnoteMark", style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: "FootnoteReference",
      before: "Link",
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 91) return -1;
        const match = footnoteInlineRE.exec(cx.slice(pos, cx.end));
        if (!match) return -1;
        return cx.addElement(
          cx.elt("FootnoteReference", pos, pos + match[0].length, [
            cx.elt("FootnoteMark", pos, pos + match[0].length),
          ]),
        );
      },
    },
  ],
};

const FootnoteDefinitionParser: BlockParser = {
  name: "MarknoteFootnoteDefinition",
  before: "LinkReference",
  parse(cx: BlockContext, line: Line) {
    const text = line.text.slice(line.pos);
    const match = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/.exec(text);
    if (!match) return false;

    const from = cx.lineStart + line.pos;
    const markerEnd = from + match[0].indexOf(":") + 1;
    const bodyFrom = from + match[0].length - match[2].length;
    const children: Element[] = [
      cx.elt("FootnoteDefinitionMark", from, markerEnd),
      cx.elt("FootnoteDefinitionText", bodyFrom, endOfLine(cx, line), cx.parser.parseInline(match[2], bodyFrom)),
    ];
    const to = endOfLine(cx, line);
    cx.nextLine();
    cx.addElement(cx.elt("FootnoteDefinition", from, to, children));
    return true;
  },
};

const MarknoteBlocks: MarkdownConfig = {
  defineNodes: [
    { name: "MathBlock", block: true, style: t.special(t.content) },
    { name: "Callout", block: true, style: t.quote },
    { name: "CalloutMark", style: t.processingInstruction },
    { name: "CalloutType", style: t.atom },
    { name: "CalloutTitle", style: t.heading },
    { name: "CalloutBody", style: t.content },
    { name: "FootnoteDefinition", block: true, style: t.content },
    { name: "FootnoteDefinitionMark", style: t.processingInstruction },
    { name: "FootnoteDefinitionText", style: t.content },
  ],
  parseBlock: [MathBlockParser, CalloutParser, FootnoteDefinitionParser],
};

/** ==highlight==, %%comment%%, $formula$, $$block$$, > [!NOTE], [^1] */
export const marknoteMarkdown: MarkdownExtension[] = [
  GFM,
  Highlight,
  Comment,
  InlineMath,
  FootnoteReference,
  MarknoteBlocks,
];
