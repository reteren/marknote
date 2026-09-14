import { invoke } from "@tauri-apps/api/core";

export type DocumentImageResolver = ((src: string) => Promise<string>) & {
  /** Обновляет базовый путь и забывает результаты предыдущего документа. */
  setDocumentPath(path: string | null): void;
};

function isRemoteSource(src: string): boolean {
  return /^(?:data:|https?:)/iu.test(src);
}

function isAbsolutePath(src: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/u.test(src);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Создаёт resolver изображений для одного открытого документа.
 * Успешные и неуспешные обращения к одному src разделяют один Promise,
 * поэтому пересборка декораций не вызывает Rust повторно.
 */
export function createImageResolver(documentPath: string | null): DocumentImageResolver {
  let currentPath = documentPath;
  const cache = new Map<string, Promise<string>>();

  const resolveImage = ((src: string): Promise<string> => {
    if (isRemoteSource(src)) return Promise.resolve(src);

    const path = currentPath;
    if (path === null && !isAbsolutePath(src)) {
      return Promise.reject(new Error("Cannot resolve a relative image path without a saved document path"));
    }

    const cacheKey = `${path ?? ""}\u0000${src}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const request = Promise.resolve()
      .then(() => invoke<string>("read_image", { docPath: path, src }))
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

  return resolveImage;
}

