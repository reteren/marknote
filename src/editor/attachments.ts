import { invoke } from "@tauri-apps/api/core";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { translate as t } from "../i18n";

export const ACCEPTED_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "ico",
] as const;

export type AcceptedImageExtension = (typeof ACCEPTED_IMAGE_EXTENSIONS)[number];

export type AttachmentRef = {
  src: string;
  path: string;
  cached: boolean;
};

export type ImageSource =
  | { type: "path"; path: string }
  | { type: "data"; data: Uint8Array | number[]; fileName?: string };

export type InsertImageOptions = {
  docPath?: string | null;
  targetPos?: number;
  onNotice?: (message: string, severity?: "info" | "warning" | "error") => void;
};

/**
 * Checks whether a given path or file name has an accepted image extension.
 */
export function isImageExtension(filePathOrName: string): boolean {
  const dotIndex = filePathOrName.lastIndexOf(".");
  if (dotIndex === -1) return false;
  const ext = filePathOrName.slice(dotIndex + 1).toLowerCase();
  return (ACCEPTED_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Extracts a human-readable file stem without extension or folder path,
 * falling back to "image".
 */
export function extractFileStem(fileNameOrPath: string): string {
  if (!fileNameOrPath) return "image";
  const baseName = fileNameOrPath.split(/[/\\]/).pop() || "image";
  const dotIndex = baseName.lastIndexOf(".");
  if (dotIndex > 0) {
    return baseName.slice(0, dotIndex);
  }
  return baseName || "image";
}

/**
 * Encodes special characters in Markdown link destination URLs:
 * spaces, parentheses, brackets, and quotes are percent-encoded while
 * forward slashes and dots remain readable.
 */
export function encodeMarkdownUrl(url: string): string {
  return url.replace(/[ ()[\]"]/g, (char) => {
    switch (char) {
      case " ":
        return "%20";
      case "(":
        return "%28";
      case ")":
        return "%29";
      case "[":
        return "%5B";
      case "]":
        return "%5D";
      case '"':
        return "%22";
      default:
        return char;
    }
  });
}

/**
 * Computes block insertion text ensuring the image sits on its own line:
 * - Prepending a newline if not at line start
 * - Appending a newline if not at line end (and trailing newline on empty lines)
 */
export function computeBlockPlacement(
  doc: { lineAt(pos: number): { from: number; to: number; text: string } },
  from: number,
  to: number,
  blockContent: string,
): { insertText: string; from: number; to: number } {
  const line = doc.lineAt(from);
  const isAtLineStart = from === line.from;
  const isAtLineEnd = to === line.to;
  const isEmptyLine = line.text.length === 0;

  let prefix = "";
  let suffix = "";

  if (isEmptyLine) {
    suffix = "\n";
  } else {
    if (!isAtLineStart) {
      prefix = "\n";
    }
    suffix = "\n";
  }

  return {
    insertText: `${prefix}${blockContent}${suffix}`,
    from,
    to,
  };
}

/**
 * Maps a command error or exception to a localized user notice message.
 */
export function mapAttachmentError(error: unknown): string {
  const message =
    typeof error === "string"
      ? error
      : (error as { message?: string })?.message ?? String(error);
  const lower = message.toLowerCase();

  if (lower.includes("too large") || lower.includes("imagetoolarge") || lower.includes("16 mi") || lower.includes("16 mb")) {
    return t("image.tooLarge");
  }
  if (lower.includes("not supported") || lower.includes("imageunsupported") || lower.includes("file type")) {
    return t("image.unsupported");
  }
  if (lower.includes("document") || lower.includes("documentpathrequired") || lower.includes("save the document")) {
    return t("image.needsDocument");
  }
  return t("image.insertFailed");
}

/**
 * Single insertion pipeline:
 * Saves image sources via Rust IPC, formats Markdown image links with stem alt text,
 * percent-encoded destinations, and inserts them in a single batch undoable transaction.
 */
export async function insertImage(
  view: EditorView,
  sources: string | ImageSource | Array<string | ImageSource>,
  options?: InsertImageOptions,
): Promise<boolean> {
  const sourceArray: ImageSource[] = (Array.isArray(sources) ? sources : [sources]).map((s) => {
    if (typeof s === "string") return { type: "path", path: s };
    return s;
  });

  if (sourceArray.length === 0) return false;

  const docPath = options?.docPath ?? null;
  const results: Array<{ ref: AttachmentRef; alt: string }> = [];
  const failures: string[] = [];

  for (const source of sourceArray) {
    try {
      if (source.type === "path") {
        const alt = extractFileStem(source.path);
        const ref = await invoke<AttachmentRef>("save_attachment_from_path", {
          docPath,
          sourcePath: source.path,
        });
        results.push({ ref, alt });
      } else {
        const fileName = source.fileName || "image.png";
        const alt = extractFileStem(fileName);
        const data = source.data instanceof Uint8Array ? Array.from(source.data) : source.data;
        if (data.length > 16 * 1024 * 1024) {
          failures.push(t("image.tooLarge"));
          continue;
        }
        const ref = await invoke<AttachmentRef>("save_attachment", {
          docPath,
          fileName,
          data,
        });
        results.push({ ref, alt });
      }
    } catch (err) {
      failures.push(mapAttachmentError(err));
    }
  }

  if (failures.length > 0) {
    const uniqueFailures = Array.from(new Set(failures));
    options?.onNotice?.(uniqueFailures.join(" — "), "error");
  }

  if (results.length === 0) return false;

  const markdownLines = results
    .map(({ ref, alt }) => `![${alt}](${encodeMarkdownUrl(ref.src)})`)
    .join("\n");

  const state = view.state;
  const selection = state.selection.main;
  const from = options?.targetPos !== undefined ? options.targetPos : selection.from;
  const to = options?.targetPos !== undefined ? options.targetPos : selection.to;

  const { insertText, from: insertFrom, to: insertTo } = computeBlockPlacement(
    state.doc,
    from,
    to,
    markdownLines,
  );

  view.dispatch({
    changes: {
      from: insertFrom,
      to: insertTo,
      insert: insertText,
    },
    selection: { anchor: insertFrom + insertText.length },
    scrollIntoView: true,
    userEvent: "input.paste",
  });

  return true;
}

/**
 * Reads a Blob or File into an ArrayBuffer across browser, WebView2, and test environments.
 */
export async function readFileAsArrayBuffer(file: Blob | File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return await file.arrayBuffer();
  }
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Handles paste events for image files or blobs.
 * Returns true if the paste was intercepted and handled, false otherwise.
 */
export function handlePasteEvent(
  event: ClipboardEvent,
  view: EditorView,
  getDocPath: (view: EditorView) => string | null,
  onNotice?: (message: string, severity?: "info" | "warning" | "error") => void,
): boolean {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return false;

  const items = clipboardData.items ? Array.from(clipboardData.items) : [];
  const imageItems = items.filter((item) => item.type.startsWith("image/"));
  const files = clipboardData.files ? Array.from(clipboardData.files) : [];
  const imageFiles = files.filter(
    (file) => isImageExtension(file.name) || file.type.startsWith("image/"),
  );

  if (imageItems.length === 0 && imageFiles.length === 0) {
    return false;
  }

  event.preventDefault();

  void (async () => {
    const sources: ImageSource[] = [];

    if (imageFiles.length > 0) {
      for (const file of imageFiles) {
        try {
          const buffer = await readFileAsArrayBuffer(file);
          sources.push({
            type: "data",
            data: new Uint8Array(buffer),
            fileName: file.name,
          });
        } catch (error) {
          onNotice?.(mapAttachmentError(error), "error");
          return;
        }
      }
    } else {
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) {
          try {
            const buffer = await readFileAsArrayBuffer(file);
            sources.push({
              type: "data",
              data: new Uint8Array(buffer),
              fileName: file.name || "image.png",
            });
          } catch (error) {
            onNotice?.(mapAttachmentError(error), "error");
            return;
          }
        }
      }
    }

    if (sources.length > 0) {
      const docPath = getDocPath(view);
      await insertImage(view, sources, { docPath, onNotice });
    }
  })();

  return true;
}

/**
 * Creates a CodeMirror extension to handle pasting image blobs and files from clipboard.
 * Preserves default handling for plain text and non-image content.
 */
export function createImagePasteHandler(
  getDocPath: (view: EditorView) => string | null,
  onNotice?: (message: string, severity?: "info" | "warning" | "error") => void,
): Extension {
  return EditorView.domEventHandlers({
    paste(event: ClipboardEvent, view: EditorView): boolean {
      return handlePasteEvent(event, view, getDocPath, onNotice);
    },
  });
}
