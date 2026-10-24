import { normalizePath } from "obsidian";
import {
  Annotation,
  AnnotationStatus,
  MarkStyle,
  SourceType
} from "../domain/annotation";
import { ANNOTATIONS_DIRECTORY, ensureDirectoryPath, threadPathFor } from "./annotation-paths";

export const INDEX_DIRECTORY = ".siden-plus/index";

/**
 * One line of `<doc>.jsonl`. The index is a rebuildable cache that lets
 * agents (and the sidebar) locate threads without reading every file:
 * Markdown annotations remain the single source of truth.
 */
export interface AnnotationIndexEntry {
  id: string;
  /** Source path (Phase 2: stable source-id). */
  source: string;
  status: AnnotationStatus;
  type: SourceType;
  color?: string;
  markStyle?: MarkStyle;
  /** 0-based start line for Markdown, page for PDF, -1 for document anchors. */
  line: number;
  /** First 120 characters of the anchored quote. */
  quote: string;
  replies: number;
  /** Annotation file path inside the vault. */
  path: string;
  updated: string;
}

export interface VaultAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/**
 * Shard path mirroring the source note inside the index directory:
 * `index/Daily/2026-10-24.md.jsonl`.
 */
export function shardNameFor(sourcePath: string): string {
  const encoded = normalizePath(sourcePath)
    .split("/")
    .map((segment) =>
      segment.replaceAll(/[%\r\n]/g, (char) => encodeURIComponent(char))
    )
    .join("/");
  return `${encoded}.jsonl`;
}

export function shardPathFor(sourcePath: string): string {
  return normalizePath(`${INDEX_DIRECTORY}/${shardNameFor(sourcePath)}`);
}

export function entryFor(annotation: Annotation): AnnotationIndexEntry {
  const line =
    annotation.anchor.kind === "markdown"
      ? annotation.anchor.startLine
      : annotation.anchor.kind === "pdf"
        ? annotation.anchor.page
        : -1;
  const quote =
    annotation.anchor.kind === "document"
      ? ""
      : annotation.anchor.quote.exact.slice(0, 120);
  return {
    id: annotation.id,
    source: annotation.sourcePath,
    status: annotation.status,
    type: annotation.sourceType,
    ...(annotation.color ? { color: annotation.color } : {}),
    ...(annotation.markStyle ? { markStyle: annotation.markStyle } : {}),
    line,
    quote,
    replies: annotation.replies.length,
    path: threadPathFor(ANNOTATIONS_DIRECTORY, annotation),
    updated: annotation.updatedAt
  };
}

/** Rewrite the shard for one source document from the given annotations. */
export async function writeShard(
  adapter: VaultAdapter,
  sourcePath: string,
  annotations: Annotation[]
): Promise<void> {
  const path = shardPathFor(sourcePath);
  const entries = annotations
    .filter((annotation) => annotation.sourcePath === normalizePath(sourcePath))
    .sort((a, b) => entryFor(a).line - entryFor(b).line)
    .map((annotation) => JSON.stringify(entryFor(annotation)));
  if (entries.length === 0) {
    if (await adapter.exists(path)) await adapter.remove(path);
    return;
  }
  const parent = path.slice(0, path.lastIndexOf("/"));
  await ensureDirectoryPath(adapter, parent);
  await adapter.write(path, `${entries.join("\n")}\n`);
}

async function listJsonlRecursive(
  adapter: VaultAdapter,
  directory: string
): Promise<string[]> {
  const listing = await adapter.list(directory);
  const files = listing.files.filter((file) => file.endsWith(".jsonl"));
  const nested = await Promise.all(
    listing.folders.map((folder) => listJsonlRecursive(adapter, folder))
  );
  return [...files, ...nested.flat()];
}

/**
 * Rebuild every shard from the given annotations and remove shards for
 * documents that no longer have annotations.
 */
export async function rebuildIndex(
  adapter: VaultAdapter,
  annotations: Annotation[]
): Promise<number> {
  const bySource = new Map<string, Annotation[]>();
  for (const annotation of annotations) {
    const list = bySource.get(annotation.sourcePath) ?? [];
    list.push(annotation);
    bySource.set(annotation.sourcePath, list);
  }
  for (const [sourcePath, list] of bySource) {
    await writeShard(adapter, sourcePath, list);
  }
  const keep = new Set(
    [...bySource.keys()].map((sourcePath) => shardPathFor(sourcePath))
  );
  let removed = 0;
  for (const file of await listJsonlRecursive(adapter, INDEX_DIRECTORY)) {
    if (!keep.has(normalizePath(file))) {
      await adapter.remove(file);
      removed += 1;
    }
  }
  return bySource.size + removed;
}
