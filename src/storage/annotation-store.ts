import { App, normalizePath } from "obsidian";
import {
  ANNOTATION_SCHEMA_VERSION,
  Annotation,
  AnnotationStatus,
  NewAnnotation
} from "../domain/annotation";
import {
  parseAnnotation,
  serializeAnnotation
} from "./annotation-markdown";

export const DEFAULT_ANNOTATION_DIRECTORY = ".siden-plus/annotations";
export const DEFAULT_TRASH_DIRECTORY = ".siden-plus/trash";

export interface AnnotationDiagnostic {
  path: string;
  message: string;
}

export class AnnotationStore {
  private readonly byId = new Map<string, Annotation>();
  private readonly idsBySource = new Map<string, Set<string>>();
  private diagnostics: AnnotationDiagnostic[] = [];

  constructor(
    private readonly app: App,
    private readonly directory = DEFAULT_ANNOTATION_DIRECTORY,
    private readonly onChange: () => void = () => undefined
  ) {}

  async load(): Promise<void> {
    this.byId.clear();
    this.idsBySource.clear();
    this.diagnostics = [];
    await this.ensureDirectory();

    const listing = await this.app.vault.adapter.list(this.directory);
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
      } catch (error) {
        this.diagnostics.push({
          path,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    this.onChange();
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
      updatedAt: now
    };

    if (this.byId.has(annotation.id)) {
      throw new Error(`Annotation ${annotation.id} already exists.`);
    }
    await this.write(annotation);
    this.index(annotation);
    this.onChange();
    return annotation;
  }

  async update(
    id: string,
    changes: Partial<Pick<Annotation, "body" | "anchor" | "status">>
  ): Promise<Annotation> {
    const current = this.require(id);
    const updated: Annotation = {
      ...current,
      ...changes,
      updatedAt: new Date().toISOString()
    };
    await this.write(updated);
    this.index(updated);
    this.onChange();
    return updated;
  }

  resolve(id: string): Promise<Annotation> {
    return this.setStatus(id, "resolved");
  }

  reopen(id: string): Promise<Annotation> {
    return this.setStatus(id, "open");
  }

  async delete(id: string): Promise<void> {
    const annotation = this.require(id);
    await this.ensureDirectoryPath(DEFAULT_TRASH_DIRECTORY);
    const trashPath = normalizePath(
      `${DEFAULT_TRASH_DIRECTORY}/${annotation.id}-${Date.now()}.md`
    );
    await this.app.vault.adapter.rename(this.pathFor(annotation.id), trashPath);
    this.unindex(annotation);
    this.onChange();
  }

  async renameSource(oldPath: string, newPath: string): Promise<void> {
    const annotations = this.forSource(oldPath);
    for (const annotation of annotations) {
      this.unindex(annotation);
      const updated: Annotation = {
        ...annotation,
        sourcePath: normalizePath(newPath),
        updatedAt: new Date().toISOString()
      };
      await this.write(updated);
      this.index(updated);
    }
    if (annotations.length > 0) this.onChange();
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

  private async write(annotation: Annotation): Promise<void> {
    await this.ensureDirectory();
    await this.app.vault.adapter.write(
      this.pathFor(annotation.id),
      serializeAnnotation(annotation)
    );
  }

  private pathFor(id: string): string {
    return normalizePath(`${this.directory}/${id}.md`);
  }

  private async ensureDirectory(): Promise<void> {
    await this.ensureDirectoryPath(this.directory);
  }

  private async ensureDirectoryPath(directory: string): Promise<void> {
    const segments = normalizePath(directory).split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }
}
