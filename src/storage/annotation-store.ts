import { App, normalizePath } from "obsidian";
import {
  ANNOTATION_SCHEMA_VERSION,
  Annotation,
  AnnotationReply,
  AnnotationStatus,
  NewAnnotation
} from "../domain/annotation";
import {
  parseAnnotation,
  serializeAnnotation
} from "./annotation-markdown";
import {
  ANNOTATIONS_DIRECTORY,
  annotationFolderFor,
  ensureDirectoryPath,
  threadPathFor
} from "./annotation-paths";
import { shardPathFor, rebuildIndex, writeShard } from "./annotation-index";

export const DEFAULT_ANNOTATION_DIRECTORY = ANNOTATIONS_DIRECTORY;
export const DEFAULT_TRASH_DIRECTORY = ".marginalia-bona/trash";
/** Pre-rename data roots, migrated wholesale on first load. */
const LEGACY_DATA_ROOTS = [".siden-plus", ".marginalia"];

function newReply(body: string, author?: string): AnnotationReply {
  return {
    id: crypto.randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    ...(author ? { author } : {}),
    body: body.trim()
  };
}

export interface AnnotationDiagnostic {
  path: string;
  message: string;
}

export class AnnotationStore {
  private readonly byId = new Map<string, Annotation>();
  private readonly idsBySource = new Map<string, Set<string>>();
  /** Current on-disk path of each thread file (file names are minted once). */
  private readonly paths = new Map<string, string>();
  private diagnostics: AnnotationDiagnostic[] = [];

  constructor(
    private readonly app: App,
    private readonly directory = DEFAULT_ANNOTATION_DIRECTORY,
    private readonly onChange: () => void = () => undefined
  ) {}

  async load(): Promise<void> {
    this.byId.clear();
    this.idsBySource.clear();
    this.paths.clear();
    this.diagnostics = [];
    await this.migrateLegacyRoot();
    await this.ensureDirectory();
    await this.loadDirectory(this.directory);
    // Self-heal shards: rewrites changed ones, removes stale ones (including
    // pre-mirror flat names). Unchanged shards are not rewritten.
    try {
      await rebuildIndex(this.app.vault.adapter, this.all());
    } catch (error) {
      console.warn("Marginalia index rebuild failed", error);
    }
    this.onChange();
  }

  /**
   * One-time rename of pre-"Marginalia Bona" data roots (`.siden-plus` or
   * `.marginalia` → `.marginalia-bona`). Thread files keep their internal
   * format markers, so a plain directory rename is lossless.
   */
  private async migrateLegacyRoot(): Promise<void> {
    const root = normalizePath(this.directory.split("/")[0] ?? this.directory);
    if (await this.app.vault.adapter.exists(root)) return;
    for (const legacyRoot of LEGACY_DATA_ROOTS) {
      if (!(await this.app.vault.adapter.exists(legacyRoot))) continue;
      try {
        await this.app.vault.adapter.rename(legacyRoot, root);
      } catch (error) {
        console.warn("Marginalia Bona data migration failed", error);
      }
      break;
    }
  }

  /** Load one directory level, recursing into mirrored source folders. */
  private async loadDirectory(directory: string): Promise<void> {
    const listing = await this.app.vault.adapter.list(directory);
    for (const path of listing.files.filter((file) => file.endsWith(".md"))) {
      try {
        const annotation = parseAnnotation(
          await this.app.vault.adapter.read(path)
        );
        if (this.byId.has(annotation.id)) {
          this.diagnostics.push({
            path,
            message: `Duplicate annotation id ${annotation.id}; both files were preserved.`
          });
          continue;
        }
        this.index(annotation);
        this.paths.set(annotation.id, path);
        await this.relocateThreadFile(annotation, path);
      } catch (error) {
        this.diagnostics.push({
          path,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    for (const folder of listing.folders) {
      await this.loadDirectory(folder);
    }
  }

  /**
   * Self-healing placement: move a thread file to the path derived from
   * its frontmatter. Covers the pre-mirror flat layout, stale file names
   * (quote drift since minting, format changes) and manual moves.
   */
  private async relocateThreadFile(
    annotation: Annotation,
    currentPath: string
  ): Promise<void> {
    const target = threadPathFor(this.directory, annotation);
    if (target === currentPath) return;
    try {
      await ensureDirectoryPath(
        this.app.vault.adapter,
        annotationFolderFor(this.directory, annotation.sourcePath)
      );
      await this.app.vault.adapter.rename(currentPath, target);
      this.paths.set(annotation.id, target);
    } catch (error) {
      this.diagnostics.push({
        path: currentPath,
        message: `Relocation to ${target} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      });
    }
  }

  all(): Annotation[] {
    return [...this.byId.values()];
  }

  forSource(sourcePath: string): Annotation[] {
    const ids = this.idsBySource.get(normalizePath(sourcePath));
    if (!ids) return [];
    return [...ids]
      .map((id) => this.byId.get(id))
      .filter((value): value is Annotation => Boolean(value));
  }

  get(id: string): Annotation | undefined {
    return this.byId.get(id);
  }

  getDiagnostics(): AnnotationDiagnostic[] {
    return [...this.diagnostics];
  }

  async create(input: NewAnnotation): Promise<Annotation> {
    const now = new Date().toISOString();
    const annotation: Annotation = {
      ...input,
      schemaVersion: ANNOTATION_SCHEMA_VERSION,
      id: input.id ?? crypto.randomUUID(),
      sourcePath: normalizePath(input.sourcePath),
      createdAt: input.createdAt ?? now,
      updatedAt: now,
      replies: input.replies ?? []
    };

    if (this.byId.has(annotation.id)) {
      throw new Error(`Annotation ${annotation.id} already exists.`);
    }
    await this.write(annotation);
    this.index(annotation);
    await this.syncShard(annotation.sourcePath);
    this.onChange();
    return annotation;
  }

  async update(
    id: string,
    changes: Partial<
      Pick<
        Annotation,
        "body" | "anchor" | "status" | "color" | "markStyle" | "replies" | "author"
      >
    >
  ): Promise<Annotation> {
    const current = this.require(id);
    const updated: Annotation = {
      ...current,
      ...changes,
      updatedAt: new Date().toISOString()
    };
    await this.write(updated);
    this.index(updated);
    await this.syncShard(updated.sourcePath);
    this.onChange();
    return updated;
  }

  async addReply(id: string, body: string, author?: string): Promise<Annotation> {
    if (!body.trim()) throw new Error("Reply body must not be empty.");
    const current = this.require(id);
    return this.update(id, {
      replies: [...current.replies, newReply(body, author)]
    });
  }

  /** Attach a (typically orphaned) annotation to a newly selected passage:
   *  replaces the whole anchor and clears the orphaned status. The thread
   *  (body + replies) is untouched. */
  async reanchor(id: string, anchor: Annotation["anchor"]): Promise<Annotation> {
    return this.update(id, { anchor, status: "open" });
  }

  async deleteReply(id: string, replyId: string): Promise<Annotation> {
    const current = this.require(id);
    return this.update(id, {
      replies: current.replies.filter((reply) => reply.id !== replyId)
    });
  }

  resolve(id: string): Promise<Annotation> {
    return this.setStatus(id, "resolved");
  }

  reopen(id: string): Promise<Annotation> {
    return this.setStatus(id, "open");
  }

  async delete(id: string): Promise<void> {
    const annotation = this.require(id);
    await ensureDirectoryPath(this.app.vault.adapter, DEFAULT_TRASH_DIRECTORY);
    const trashPath = normalizePath(
      `${DEFAULT_TRASH_DIRECTORY}/${annotation.id}-${Date.now()}.md`
    );
    const currentPath = this.paths.get(annotation.id);
    if (!currentPath) {
      throw new Error(`Annotation ${id} has no file on disk.`);
    }
    await this.app.vault.adapter.rename(currentPath, trashPath);
    this.paths.delete(annotation.id);
    await this.removeEmptyFolders(
      currentPath.slice(0, currentPath.lastIndexOf("/"))
    );
    const sourcePath = annotation.sourcePath;
    this.unindex(annotation);
    await this.syncShard(sourcePath);
    this.onChange();
  }

  async renameSource(oldPath: string, newPath: string): Promise<void> {
    const annotations = this.forSource(oldPath);
    const oldFolder = annotationFolderFor(this.directory, oldPath);
    for (const annotation of annotations) {
      this.unindex(annotation);
      const updated: Annotation = {
        ...annotation,
        sourcePath: normalizePath(newPath),
        updatedAt: new Date().toISOString()
      };
      await this.write(updated, true);
      this.index(updated);
    }
    if (annotations.length > 0) {
      await this.syncShard(newPath);
      await this.removeShard(oldPath);
      await this.removeEmptyFolders(oldFolder);
      this.onChange();
    }
  }

  async reconcileMarkdownSource(
    sourcePath: string,
    documentText: string
  ): Promise<void> {
    for (const annotation of this.forSource(sourcePath)) {
      if (annotation.anchor.kind !== "markdown") continue;
      const anchor = annotation.anchor;
      const atStoredOffsets = documentText.slice(
        anchor.startOffset,
        anchor.endOffset
      );
      if (atStoredOffsets === anchor.quote.exact) continue;

      const candidates: number[] = [];
      let cursor = 0;
      while (cursor <= documentText.length) {
        const found = documentText.indexOf(anchor.quote.exact, cursor);
        if (found < 0) break;
        candidates.push(found);
        cursor = found + Math.max(1, anchor.quote.exact.length);
      }
      const contextual = candidates.filter((candidate) => {
        const prefix = anchor.quote.prefix ?? "";
        const suffix = anchor.quote.suffix ?? "";
        return (
          (!prefix ||
            documentText
              .slice(Math.max(0, candidate - prefix.length), candidate)
              .endsWith(prefix)) &&
          (!suffix ||
            documentText
              .slice(
                candidate + anchor.quote.exact.length,
                candidate + anchor.quote.exact.length + suffix.length
              )
              .startsWith(suffix))
        );
      });
      const resolved =
        contextual.length === 1
          ? contextual[0]
          : candidates.length === 1
            ? candidates[0]
            : null;
      if (resolved === null) {
        if (annotation.status !== "orphaned") {
          await this.update(annotation.id, { status: "orphaned" });
        }
        continue;
      }
      const endOffset = resolved + anchor.quote.exact.length;
      const beforeStart = documentText.slice(0, resolved);
      const beforeEnd = documentText.slice(0, endOffset);
      const startLine = beforeStart.split("\n").length - 1;
      const endLine = beforeEnd.split("\n").length - 1;
      const startCharacter = resolved - (beforeStart.lastIndexOf("\n") + 1);
      const endCharacter = endOffset - (beforeEnd.lastIndexOf("\n") + 1);
      await this.update(annotation.id, {
        status: annotation.status === "orphaned" ? "open" : annotation.status,
        anchor: {
          ...anchor,
          startOffset: resolved,
          endOffset,
          startLine,
          startCharacter,
          endLine,
          endCharacter
        }
      });
    }
  }

  private setStatus(
    id: string,
    status: AnnotationStatus
  ): Promise<Annotation> {
    return this.update(id, { status });
  }

  private require(id: string): Annotation {
    const annotation = this.byId.get(id);
    if (!annotation) throw new Error(`Unknown annotation: ${id}`);
    return annotation;
  }

  private index(annotation: Annotation): void {
    const existing = this.byId.get(annotation.id);
    if (existing) this.unindex(existing);
    this.byId.set(annotation.id, annotation);
    const ids = this.idsBySource.get(annotation.sourcePath) ?? new Set<string>();
    ids.add(annotation.id);
    this.idsBySource.set(annotation.sourcePath, ids);
  }

  private unindex(annotation: Annotation): void {
    this.byId.delete(annotation.id);
    const ids = this.idsBySource.get(annotation.sourcePath);
    ids?.delete(annotation.id);
    if (ids?.size === 0) this.idsBySource.delete(annotation.sourcePath);
  }

  private async write(
    annotation: Annotation,
    relocate = false
  ): Promise<void> {
    await this.ensureDirectory();
    const known = this.paths.get(annotation.id);
    const desired = relocate || !known ? threadPathFor(this.directory, annotation) : known;
    const parent = desired.slice(0, desired.lastIndexOf("/"));
    await ensureDirectoryPath(this.app.vault.adapter, parent);
    await this.app.vault.adapter.write(desired, serializeAnnotation(annotation));
    if (known && known !== desired) {
      try {
        await this.app.vault.adapter.remove(known);
      } catch {
        // Old copy already gone; the new file is authoritative.
      }
    }
    this.paths.set(annotation.id, desired);
  }

  /** Best-effort cleanup of folders left empty by renames/migrations. */
  private async removeEmptyFolders(folder: string): Promise<void> {
    let current = normalizePath(folder);
    const root = normalizePath(this.directory);
    while (current.length > root.length) {
      try {
        await this.app.vault.adapter.rmdir?.(current, false);
      } catch {
        return; // not empty or unsupported: stop walking up
      }
      current = current.slice(0, current.lastIndexOf("/"));
    }
  }

  /** Keep the per-document index shard in sync (best effort; rebuildable). */
  private async syncShard(sourcePath: string): Promise<void> {
    try {
      await writeShard(
        this.app.vault.adapter,
        sourcePath,
        this.forSource(sourcePath)
      );
    } catch (error) {
      console.warn("Marginalia index update failed", error);
    }
  }

  private async removeShard(sourcePath: string): Promise<void> {
    try {
      await this.app.vault.adapter.remove(shardPathFor(sourcePath));
    } catch {
      // Shard may not exist yet; the index is a rebuildable cache.
    }
  }

  private async ensureDirectory(): Promise<void> {
    await ensureDirectoryPath(this.app.vault.adapter, this.directory);
  }
}
