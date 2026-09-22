import { invoke } from "@tauri-apps/api/core";

export type DocumentImageResolver = ((src: string) => Promise<string>) & {
  /** Updates the base path and discards results from the previous document. */
  setDocumentPath(path: string | null): void;
  /** Discards cached results for a specific src, or all cached results if omitted. */
  invalidate(src?: string): void;
};

function isRemoteSource(src: string): boolean {
  return /^(?:data:|https?:)/iu.test(src);
}

function isAbsolutePath(src: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/u.test(src);
}

function isCacheSource(src: string): boolean {
  return /^marknote-cache[\\/]/u.test(src) || src === "marknote-cache";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Formats a byte count into a human-readable string (e.g. 1.2 MB, 500 B).
 */
export function formatBytes(bytes: number, locale?: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  if (i === 0) return `${bytes} B`;
  const value = bytes / Math.pow(1024, i);
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
  return `${formatted} ${units[i]}`;
}

/**
 * Creates an image resolver for one open document.
 * Successful and failed requests for the same src share one Promise, so
 * rebuilding decorations does not call Rust again.
 */
export function createImageResolver(documentPath: string | null): DocumentImageResolver {
  let currentPath = documentPath;
  const cache = new Map<string, Promise<string>>();

  const resolveImage = ((src: string): Promise<string> => {
    if (isRemoteSource(src)) return Promise.resolve(src);

    const path = currentPath;
    if (path === null && !isAbsolutePath(src) && !isCacheSource(src)) {
      return Promise.reject(new Error("Cannot resolve a relative image path without a saved document path"));
    }

    const cacheKey = `${path ?? ""}\u0000${src}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const request = Promise.resolve()
      .then(() => invoke<string>("resolve_image", { docPath: path, src }))
      .catch((error: unknown) => {
        throw new Error(`Failed to load image "${src}": ${errorMessage(error)}`);
      });
    cache.set(cacheKey, request);
    return request;
  }) as DocumentImageResolver;

  resolveImage.setDocumentPath = (path: string | null): void => {
    if (path === currentPath) return;
    currentPath = path;
    cache.clear();
  };

  resolveImage.invalidate = (src?: string): void => {
    if (src) {
      cache.delete(`${currentPath ?? ""}\u0000${src}`);
      cache.delete(`\u0000${src}`);
    } else {
      cache.clear();
    }
  };

  if (typeof window !== "undefined") {
    try {
      import("@tauri-apps/api/event")
        .then(({ listen }) => {
          listen<{ path: string }>("file-changed-externally", (event) => {
            if (event?.payload?.path) {
              resolveImage.invalidate();
            }
          }).catch(() => {});
        })
        .catch(() => {});
    } catch {
      // Ignored outside Tauri / in tests
    }
  }

  return resolveImage;
}
