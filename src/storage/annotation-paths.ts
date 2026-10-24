import { normalizePath } from "obsidian";
import { Annotation } from "../domain/annotation";

/** Root folder holding one Markdown file per discussion thread. */
export const ANNOTATIONS_DIRECTORY = ".siden-plus/annotations";

/**
 * Longest quote excerpt used inside a thread file name, measured in
 * terminal columns: CJK/fullwidth characters count as 2, others as 1.
 * 16 columns ≈ 8 Chinese characters or 16 ASCII characters.
 */
const FILENAME_WIDTH_LIMIT = 16;

function characterWidth(character: string): number {
  const code = character.codePointAt(0) ?? 0;
  const wide =
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd);
  return wide ? 2 : 1;
}

function truncateByWidth(value: string, maxWidth: number): string {
  let width = 0;
  let result = "";
  for (const character of value) {
    const next = characterWidth(character);
    if (width + next > maxWidth) break;
    width += next;
    result += character;
  }
  return result;
}

function sanitizeForFilename(value: string): string {
  const cleaned = value
    .replaceAll(/[\r\n\t]+/g, " ")
    .replaceAll(/[\\/:*?"<>|#%]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return truncateByWidth(cleaned, FILENAME_WIDTH_LIMIT)
    .replace(/[\s\p{P}\p{S}-]+$/u, "")
    .trim();
}

/** Short, still-unique suffix derived from the thread id. */
export function shortIdFor(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}

/**
 * Folder mirroring the annotated source note:
 * `annotations/<source dir>/<source basename>/` — e.g. for
 * `Daily/2026-10-24.md` the folder is `annotations/Daily/2026-10-24.md/`.
 */
export function annotationFolderFor(
  baseDirectory: string,
  sourcePath: string
): string {
  const segments = normalizePath(sourcePath).split("/");
  const name = segments.pop() ?? "unknown";
  const parent = segments.join("/");
  return normalizePath(
    parent
      ? `${baseDirectory}/${parent}/${name}`
      : `${baseDirectory}/${name}`
  );
}

/**
 * Human-readable thread file name: quote excerpt + short id, e.g.
 * `测试文本-a1b2c3d4.md`. The name is minted at creation (or migration)
 * and afterwards stays stable even when the anchor text drifts, so
 * editing an annotated passage never renames files.
 */
export function threadFileNameFor(annotation: Annotation): string {
  const quote =
    annotation.anchor.kind === "document"
      ? ""
      : annotation.anchor.quote.exact;
  const label = sanitizeForFilename(quote);
  const prefix =
    annotation.anchor.kind === "document" ? "note" : label || "annotation";
  return `${prefix}-${shortIdFor(annotation.id)}.md`;
}

export function threadPathFor(
  baseDirectory: string,
  annotation: Annotation
): string {
  return normalizePath(
    `${annotationFolderFor(baseDirectory, annotation.sourcePath)}/${threadFileNameFor(annotation)}`
  );
}

/** Create every missing path segment (adapter.mkdir is not recursive). */
export async function ensureDirectoryPath(
  adapter: {
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
  },
  directory: string
): Promise<void> {
  const segments = normalizePath(directory).split("/");
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!(await adapter.exists(current))) {
      await adapter.mkdir(current);
    }
  }
}
