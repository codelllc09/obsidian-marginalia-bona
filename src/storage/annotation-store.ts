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
import { queryAnnotations, type AnnotationQuery } from "./query";
import {
  ANNOTATIONS_DIRECTORY,
  annotationFolderFor,
  ensureDirectoryPath,
  threadPathFor
} from "./annotation-paths";
import { shardPathFor, rebuildIndex, writeShard } from "./annotation-index";
import { assertAnnotation } from "../domain/annotation";

/** Key-order-insensitive JSON comparison: in-memory annotations are built
 *  by different code paths than parseAnnotation, so a plain stringify
 *  would report every freshly created thread as externally "changed". */
function stableStringify(value: unknown): string {
  const replacer = (_key: string, item: unknown): unknown => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = record[key];
    return sorted;
  };
  return JSON.stringify(value, replacer);
}

export const DEFAULT_ANNOTATION_DIRECTORY = ANNOTATIONS_DIRECTORY;
export const DEFAULT_TRASH_DIRECTORY = ".marginalia-bona/trash";
/** Trash files older than this are purged on load. */
export const TRASH_RETENTION_DAYS = 30;
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

  /** Data root (first path segment), e.g. `.marginalia-bona`. */
  get dataRoot(): string {
    return this.directory.split("/")[0] ?? this.directory;
  }

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
    try {
      await this.purgeTrash();
    } catch (error) {
      console.warn("Marginalia trash purge failed", error);
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

  /** Filter + order annotations through the shared query engine - the
   *  single source of filter/sort semantics for sidebar and agents. */
  query(options: AnnotationQuery): Annotation[] {
    return queryAnnotations(this.all(), options);
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
    // Validate before anything touches the disk: a bad anchor must fail
    // with a clear error, not crash filename derivation mid-write.
    assertAnnotation(annotation);
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
        "body" | "anchor" | "status" | "color" | "markStyle" | "replies" | "author" | "readAt"
      >
    >
  ): Promise<Annotation> {
    const current = this.require(id);
    const updated: Annotation = {
      ...current,
      ...changes,
      updatedAt: new Date().toISOString()
    };
    assertAnnotation(updated);
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

  /**
   * Ingest one annotation file written by an external agent (or moved/
   * edited outside Obsidian). The disk is the source of truth: the parsed
   * content replaces any in-memory state for the same id; unchanged
   * content is a no-op. Unparseable files are never rewritten - they are
   * recorded as diagnostics and reported as "invalid".
   */
  async ingestExternal(
    path: string,
    content: string
  ): Promise<"added" | "changed" | "unchanged" | "invalid"> {
    let parsed: Annotation;
    try {
      parsed = parseAnnotation(content);
    } catch (error) {
      this.diagnostics.push({
        path,
        message: error instanceof Error ? error.message : String(error)
      });
      return "invalid";
    }
    const existing = this.byId.get(parsed.id);
    const previousPath = this.paths.get(parsed.id);
    if (
      existing &&
      stableStringify(existing) === stableStringify(parsed) &&
      previousPath === path
    ) {
      return "unchanged";
    }

    // External edit may have changed the source field: move the id between
    // source buckets and refresh both shards.
    const affectedSources = new Set<string>([parsed.sourcePath]);
    if (existing) {
      affectedSources.add(existing.sourcePath);
      this.removeFromIndexes(existing.id);
    }
    // One file replaced wholesale by a different annotation (sync tools do
    // this): the previous id must not stay live pointing at a file that no
    // longer holds it.
    for (const [knownId, knownPath] of this.paths) {
      if (knownPath !== path || knownId === parsed.id) continue;
      const stale = this.byId.get(knownId);
      this.removeFromIndexes(knownId);
      this.paths.delete(knownId);
      if (stale) affectedSources.add(stale.sourcePath);
    }
    this.index(parsed);
    this.paths.set(parsed.id, path);
    await this.syncShard(parsed.sourcePath);
    for (const source of affectedSources) {
      if (source !== parsed.sourcePath) await this.syncShard(source);
    }
    this.onChange();
    return existing ? "changed" : "added";
  }

  /** Forget a thread file that was deleted externally. Returns false when
   *  the path was not known to the store. */
  async forgetExternal(path: string): Promise<boolean> {
    let id: string | undefined;
    for (const [knownId, knownPath] of this.paths) {
      if (knownPath === path) {
        id = knownId;
        break;
      }
    }
    if (!id) return false;
    const annotation = this.byId.get(id);
    this.removeFromIndexes(id);
    this.paths.delete(id);
    if (annotation) await this.syncShard(annotation.sourcePath);
    this.onChange();
    return true;
  }

  /** Drop an id from byId/idsBySource (caller updates paths and shards). */
  private removeFromIndexes(id: string): void {
    const current = this.byId.get(id);
    this.byId.delete(id);
    if (!current) return;
    const ids = this.idsBySource.get(current.sourcePath);
    if (!ids) return;
    ids.delete(id);
    if (ids.size === 0) this.idsBySource.delete(current.sourcePath);
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

  async delete(id: string): Promise<string> {
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
    return trashPath;
  }

  /** Entries in the recycle bin: parsed frontmatter where readable, plus
   *  the file's modification time as the deletion proxy. */
  async listTrash(): Promise<
    Array<{
      name: string;
      id: string | null;
      source: string | null;
      body: string;
      trashedAt: number;
    }>
  > {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(DEFAULT_TRASH_DIRECTORY))) return [];
    const { files } = await adapter.list(DEFAULT_TRASH_DIRECTORY);
    const entries: Array<{
      name: string;
      id: string | null;
      source: string | null;
      body: string;
      trashedAt: number;
    }> = [];
    for (const path of files) {
      // adapter.list returns full vault-relative paths - never re-prefix.
      const stat = await adapter.stat(path);
      let id: string | null = null;
      let source: string | null = null;
      let body = "(unparseable)";
      try {
        const parsed = parseAnnotation(await adapter.read(path));
        id = parsed.id;
        source = parsed.sourcePath;
        body = parsed.body.slice(0, 80);
      } catch {
        // Unparseable trash stays listed but cannot be restored by id.
      }
      entries.push({
        name: path.slice(path.lastIndexOf("/") + 1),
        id,
        source,
        body,
        trashedAt: stat?.mtime ?? 0
      });
    }
    return entries;
  }

  /** Move a trash file back to its canonical annotations location and
   *  re-ingest it. The original note path comes from the file itself. */
  async restoreFromTrash(id: string): Promise<Annotation> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(DEFAULT_TRASH_DIRECTORY))) {
      throw new Error(`No trash entry for ${id}`);
    }
    const { files } = await adapter.list(DEFAULT_TRASH_DIRECTORY);
    for (const path of files) {
      const content = await adapter.read(path);
      let parsed: Annotation;
      try {
        parsed = parseAnnotation(content);
      } catch {
        continue;
      }
      if (parsed.id !== id) continue;
      if (this.byId.has(id)) {
        // Restoring would fork the thread: the id is live on disk and a
        // second file with the same id is unreadable state.
        throw new Error(
          `Cannot restore ${id}: an active annotation already uses this id.`
        );
      }
      const target = threadPathFor(this.directory, parsed);
      if (await adapter.exists(target)) {
        throw new Error(`Cannot restore ${id}: ${target} already exists.`);
      }
      await adapter.rename(path, target);
      await this.ingestExternal(target, content);
      // The note may have changed while the thread sat in the bin: run the
      // same anchor reconciliation an external edit would trigger, so a
      // lost passage comes back ORPHANED instead of silently stale.
      const restored = this.require(id);
      if (restored.anchor.kind !== "document") {
        // Adapter-only file access: the store never reaches into vault APIs.
        if (await adapter.exists(restored.sourcePath)) {
          await this.reconcileMarkdownSource(
            restored.sourcePath,
            await adapter.read(restored.sourcePath)
          );
        } else if (restored.status !== "orphaned") {
          await this.update(id, { status: "orphaned" });
        }
      }
      return this.require(id);
    }
    throw new Error(`No trash entry for ${id}`);
  }

  /** Remove trash files whose modification time precedes `cutoff`.
   *  Called on load with the retention window; returns the count. */
  async purgeTrash(cutoff = Date.now() - TRASH_RETENTION_DAYS * 86_400_000): Promise<number> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(DEFAULT_TRASH_DIRECTORY))) return 0;
    const { files } = await adapter.list(DEFAULT_TRASH_DIRECTORY);
    let purged = 0;
    for (const path of files) {
      const stat = await adapter.stat(path);
      if (stat && stat.mtime < cutoff) {
        await adapter.remove(path);
        purged += 1;
      }
    }
    return purged;
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
      if (atStoredOffsets === anchor.quote.exact) {
        // Anchor is already correct: an orphaned annotation whose passage
        // came back (e.g. fixed by an external agent) is open again.
        if (annotation.status === "orphaned") {
          await this.update(annotation.id, { status: "open" });
        }
        continue;
      }

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
