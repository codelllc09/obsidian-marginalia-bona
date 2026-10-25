import { anchorDrift, type Annotation } from "../domain/annotation";

/** One query engine for annotation filtering and ordering. Both the
 *  sidebar and the REST/MCP surfaces call this - the semantics live here
 *  and nowhere else.
 *
 *  Pseudo-filters (drifted/unread) are plain booleans here; the API layer
 *  keeps accepting the legacy `status=drifted`/`status=unread` aliases and
 *  translates them before calling in. */

export type AnnotationSort = "source" | "created" | "updated";

export interface AnnotationQuery {
  /** Restrict to one note. Omit for the whole vault. */
  source?: string;
  status?: "open" | "resolved" | "orphaned";
  drifted?: boolean;
  unread?: boolean;
  author?: string;
  /** true = read only, false = unread only. */
  read?: boolean;
  /** Case-insensitive substring across body, replies, quote, note path. */
  q?: string;
  sort?: AnnotationSort;
  dir?: "asc" | "desc";
}

function anchorPosition(annotation: Annotation): number {
  return annotation.anchor.kind === "markdown"
    ? annotation.anchor.startOffset
    : annotation.anchor.kind === "pdf"
      ? annotation.anchor.page
      : 0;
}

/** Filters, then sorts. Returns everything matching - callers apply any
 *  output cap themselves (the API layer caps at 200). */
export function queryAnnotations(
  all: Annotation[],
  options: AnnotationQuery
): Annotation[] {
  let items = all;
  if (options.source !== undefined) {
    items = items.filter((a) => a.sourcePath === options.source);
  }
  if (options.status !== undefined) {
    items = items.filter((a) => a.status === options.status);
  }
  if (options.drifted !== undefined) {
    items = items.filter((a) => (anchorDrift(a) !== null) === options.drifted);
  }
  if (options.unread !== undefined) {
    items = items.filter((a) => (a.readAt === undefined) === options.unread);
  }
  if (options.read !== undefined) {
    items = items.filter((a) => (a.readAt !== undefined) === options.read);
  }
  if (options.author !== undefined) {
    items = items.filter((a) => (a.author ?? "user") === options.author);
  }
  if (options.q !== undefined && options.q.trim()) {
    const needle = options.q.trim().toLocaleLowerCase();
    items = items.filter((a) => {
      const quote =
        a.anchor.kind === "document" ? "" : a.anchor.quote.exact;
      const replies = a.replies.map((reply) => reply.body).join("\n");
      return `${a.body}\n${replies}\n${quote}\n${a.sourcePath}`
        .toLocaleLowerCase()
        .includes(needle);
    });
  }
  const sort = options.sort ?? "source";
  const dir = options.dir === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    let cmp = 0;
    if (sort === "source") {
      // Document order: grouped by note path, then by position in the note.
      cmp = a.sourcePath.localeCompare(b.sourcePath);
      if (cmp === 0) cmp = anchorPosition(a) - anchorPosition(b);
    } else {
      const key = sort === "created" ? "createdAt" : "updatedAt";
      cmp = a[key].localeCompare(b[key]);
      if (cmp === 0) cmp = anchorPosition(a) - anchorPosition(b);
    }
    return cmp * dir;
  });
}
