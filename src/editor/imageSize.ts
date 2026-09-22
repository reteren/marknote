/**
 * The optional image dimensions use the Obsidian convention in the alt text.
 * Keeping this parser separate makes the rendering and resize paths agree on
 * which pipes are part of the accessible alt text.
 */
export interface ImageSize {
  width: number;
  height?: number;
}

export interface ParsedImageAlt {
  alt: string;
  size?: ImageSize;
}

// A dimension is deliberately bounded.  Apart from avoiding unsafe numeric
// conversion, this prevents an accidental pasted integer from becoming an
// enormous CSS value while leaving that text visible as the alt text.
export const MAX_IMAGE_DIMENSION = 1_000_000;

const DIMENSION_SUFFIX = /\|([0-9]+)(?:x([0-9]+))?$/i;

function positiveDimension(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_IMAGE_DIMENSION) return null;
  return parsed;
}

/** Parses only a final, valid dimension suffix; every other pipe is alt text. */
export function parseImageAlt(rawAlt: string): ParsedImageAlt {
  const match = DIMENSION_SUFFIX.exec(rawAlt);
  if (!match) return { alt: rawAlt };

  const width = positiveDimension(match[1]);
  if (width === null) return { alt: rawAlt };
  if (match[2] === undefined) {
    return { alt: rawAlt.slice(0, match.index), size: { width } };
  }
  const height = positiveDimension(match[2]);
  if (height === null) return { alt: rawAlt };

  return {
    alt: rawAlt.slice(0, match.index),
    size: { width, height },
  };
}

/** Serializes the canonical form used when a resize is committed. */
export function serializeImageAlt(alt: string, size?: ImageSize): string {
  if (!size) return alt;
  return `${alt}|${size.width}${size.height === undefined ? "" : `x${size.height}`}`;
}
