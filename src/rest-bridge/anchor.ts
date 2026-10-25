import { MarkdownAnchor } from "../domain/annotation";

/** All offsets where `exact` occurs in `text`, left to right. */
export function passageOffsets(text: string, exact: string): number[] {
  const offsets: number[] = [];
  if (!exact) return offsets;
  let cursor = 0;
  while (cursor <= text.length) {
    const found = text.indexOf(exact, cursor);
    if (found < 0) break;
    offsets.push(found);
    cursor = found + Math.max(1, exact.length);
  }
  return offsets;
}

export type PassageLookup =
  | { kind: "found"; startOffset: number; matches: number }
  | { kind: "missing" }
  | { kind: "ambiguous"; matches: number };

/** Resolve which occurrence of `exact` the caller means. Ambiguous unless
 *  the requested occurrence exists - callers turn that into a 409 that
 *  asks the agent to pass `occurrence`. */
export function findPassage(
  text: string,
  exact: string,
  occurrence?: number
): PassageLookup {
  const offsets = passageOffsets(text, exact);
  if (offsets.length === 0) return { kind: "missing" };
  if (offsets.length === 1) {
    return { kind: "found", startOffset: offsets[0], matches: 1 };
  }
  if (occurrence !== undefined && occurrence >= 1 && occurrence <= offsets.length) {
    return {
      kind: "found",
      startOffset: offsets[occurrence - 1],
      matches: offsets.length
    };
  }
  return { kind: "ambiguous", matches: offsets.length };
}

/** FNV-1a, matching the plugin's own quote hashing. */
export function quoteHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Build a full anchor for a passage found in the note text: offsets,
 *  lines, 64-char context, quote hash, and the drift baseline. */
export function buildAnchor(
  text: string,
  exact: string,
  startOffset: number
): MarkdownAnchor {
  const endOffset = startOffset + exact.length;
  const before = text.slice(0, startOffset);
  const startLine = before.split("\n").length - 1;
  const startCharacter = startOffset - (before.lastIndexOf("\n") + 1);
  const endBefore = text.slice(0, endOffset);
  const endLine = endBefore.split("\n").length - 1;
  const endCharacter = endOffset - (endBefore.lastIndexOf("\n") + 1);
  return {
    kind: "markdown",
    startOffset,
    endOffset,
    startLine,
    startCharacter,
    endLine,
    endCharacter,
    quote: {
      exact,
      prefix: text.slice(Math.max(0, startOffset - 64), startOffset),
      suffix: text.slice(endOffset, endOffset + 64)
    },
    quoteHash: quoteHash(exact),
    originalQuote: exact
  };
}
