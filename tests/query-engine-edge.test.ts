import { describe, expect, it } from "vitest";
import { queryAnnotations } from "../src/storage/query";
import type { Annotation } from "../src/domain/annotation";

function make(overrides: Partial<Annotation> & { id: string }): Annotation {
  const { id, ...rest } = overrides;
  return {
    schemaVersion: 1,
    id,
    sourcePath: `Notes/${id}.md`,
    sourceType: "markdown",
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    body: "",
    anchor: {
      kind: "markdown",
      startOffset: 0,
      endOffset: 4,
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: 4,
      quote: { exact: "body", prefix: "", suffix: "" },
      originalQuote: "body"
    },
    replies: [],
    ...rest
  };
}

describe("query engine / q filter", () => {
  const items = [
    make({ id: "a", body: "Discusses the TRANSFORMER paper" }),
    make({ id: "b", body: "nothing here", replies: [{ id: "r1", createdAt: "2026-01-01T00:00:00.000Z", body: "see transformer note" }] }),
    make({ id: "c", body: "x", anchor: { kind: "markdown", startOffset: 0, endOffset: 11, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 11, quote: { exact: "transformer" }, originalQuote: "transformer" } }),
    make({ id: "d", body: "x", sourcePath: "Zettel/transformer.md" }),
    make({ id: "e", body: "x" })
  ];

  it("searches body, replies, quote and source path, case-insensitively", () => {
    const hits = queryAnnotations(items, { q: "transformer" }).map((a) => a.id);
    expect(hits).toEqual(["a", "b", "c", "d"]);
  });

  it("treats regex metacharacters as literal text", () => {
    const withDots = [make({ id: "dot", body: "a.c" }), make({ id: "abc", body: "abc" })];
    expect(queryAnnotations(withDots, { q: "a.c" }).map((a) => a.id)).toEqual(["dot"]);
    expect(queryAnnotations(withDots, { q: ".*" }).map((a) => a.id)).toEqual([]);
  });

  it("ignores a whitespace-only q", () => {
    expect(queryAnnotations(items, { q: "   " })).toHaveLength(5);
  });

  it("matches CJK needles without word boundaries", () => {
    const cjk = [make({ id: "zh", body: "讨论注意力机制与位置编码" })];
    expect(queryAnnotations(cjk, { q: "注意力" })).toHaveLength(1);
    expect(queryAnnotations(cjk, { q: "注意 力" })).toHaveLength(0);
  });

  it("does not match across the field separator", () => {
    // body ends with "end", sourcePath begins with "start" - a naive
    // concatenated haystack would match "endstart".
    const glued = [make({ id: "g", body: "end", sourcePath: "start.md" })];
    expect(queryAnnotations(glued, { q: "endstart" })).toHaveLength(0);
    // The empty replies field and the quote text separate body and path,
    // so cross-field matches only happen through the literal gaps.
    expect(queryAnnotations(glued, { q: "end\n\nbody\nstart" })).toHaveLength(1);
  });
});

describe("query engine / orthogonal filters", () => {
  const items = [
    make({ id: "open-unread" }),
    make({ id: "resolved-unread", status: "resolved" }),
    make({ id: "open-read", readAt: "2026-02-01T00:00:00.000Z" }),
    make({ id: "orphan", status: "orphaned", anchor: { kind: "markdown", startOffset: 0, endOffset: 4, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 4, quote: { exact: "now" }, originalQuote: "then" } })
  ];

  it("filters by status", () => {
    expect(queryAnnotations(items, { status: "open" }).map((a) => a.id)).toEqual(["open-read", "open-unread"]);
    expect(queryAnnotations(items, { status: "orphaned" }).map((a) => a.id)).toEqual(["orphan"]);
  });

  it("derives drifted from the anchor, not a stored flag", () => {
    expect(queryAnnotations(items, { drifted: true }).map((a) => a.id)).toEqual(["orphan"]);
    expect(queryAnnotations(items, { drifted: false })).toHaveLength(3);
  });

  it("read and unread partition the set; combined they match nothing", () => {
    expect(queryAnnotations(items, { read: true }).map((a) => a.id)).toEqual(["open-read"]);
    expect(queryAnnotations(items, { read: false }).map((a) => a.id)).toEqual([
      "open-unread", "orphan", "resolved-unread"
    ]);
    expect(queryAnnotations(items, { read: true, unread: true })).toHaveLength(0);
  });

  it("unread means readAt absent, regardless of status", () => {
    expect(queryAnnotations(items, { unread: true })).toHaveLength(3);
  });

  it("author falls back to 'user' when absent", () => {
    const authored = [
      make({ id: "agent", author: "Pi" }),
      make({ id: "anon" })
    ];
    expect(queryAnnotations(authored, { author: "user" }).map((a) => a.id)).toEqual(["anon"]);
    expect(queryAnnotations(authored, { author: "pi" })).toHaveLength(0); // case-sensitive by design
  });
});

describe("query engine / ordering", () => {
  it("document order: source path, then anchor position", () => {
    const items = [
      make({ id: "late", sourcePath: "A.md", anchor: { kind: "markdown", startOffset: 50, endOffset: 54, startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 4, quote: { exact: "body" } } }),
      make({ id: "early", sourcePath: "A.md" }),
      make({ id: "other", sourcePath: "B.md" })
    ];
    expect(queryAnnotations(items, {}).map((a) => a.id)).toEqual(["early", "late", "other"]);
  });

  it("document anchors (position 0) sort before positioned ones within a note", () => {
    const items = [
      make({ id: "pos", sourcePath: "A.md", anchor: { kind: "markdown", startOffset: 30, endOffset: 34, startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 4, quote: { exact: "body" } } }),
      make({ id: "doc", sourcePath: "A.md", anchor: { kind: "document" } })
    ];
    expect(queryAnnotations(items, {}).map((a) => a.id)).toEqual(["doc", "pos"]);
  });

  it("equal positions keep input order (stable sort)", () => {
    const items = [
      make({ id: "first", sourcePath: "A.md" }),
      make({ id: "second", sourcePath: "A.md" })
    ];
    expect(queryAnnotations(items, {}).map((a) => a.id)).toEqual(["first", "second"]);
  });

  it("created desc flips the order; equal timestamps break ties by position", () => {
    const a = make({ id: "a-low", createdAt: "2026-01-01T00:00:00.000Z" });
    const b = make({ id: "b-high", sourcePath: "A.md" });
    (b.anchor as { startOffset: number }).startOffset = 40;
    b.createdAt = "2026-02-01T00:00:00.000Z";
    const asc = queryAnnotations([b, a], { sort: "created", dir: "asc" });
    expect(asc.map((x) => x.id)).toEqual(["a-low", "b-high"]);
    const desc = queryAnnotations([a, b], { sort: "created", dir: "desc" });
    expect(desc.map((x) => x.id)).toEqual(["b-high", "a-low"]);
  });

  it("updated sort uses the mutation timestamp", () => {
    const a = make({ id: "stale", updatedAt: "2026-01-01T00:00:00.000Z" });
    const b = make({ id: "fresh", updatedAt: "2026-06-01T00:00:00.000Z" });
    expect(queryAnnotations([a, b], { sort: "updated" })[0].id).toBe("stale");
    expect(queryAnnotations([a, b], { sort: "updated", dir: "desc" })[0].id).toBe("fresh");
  });

  it("does not mutate the input array", () => {
    const items = [make({ id: "b" }), make({ id: "a", sourcePath: "A.md" })];
    const snapshot = [...items];
    queryAnnotations(items, {});
    expect(items).toEqual(snapshot);
  });

  it("handles empty input and unknown sort values by falling back", () => {
    expect(queryAnnotations([], {})).toEqual([]);
    // Unknown sort strings fall through to the updated-branch; must not crash.
    const items = [make({ id: "a" }), make({ id: "b", updatedAt: "2026-02-01T00:00:00.000Z" })];
    const sorted = queryAnnotations(items, { sort: "banana" as never });
    expect(sorted[0].id).toBe("a");
  });
});
