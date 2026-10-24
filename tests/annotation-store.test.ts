import { beforeEach, describe, expect, it } from "vitest";

import { AnnotationStore } from "../src/storage/annotation-store";
import { serializeAnnotation } from "../src/storage/annotation-markdown";
import { threadPathFor } from "../src/storage/annotation-paths";
import type { AnnotationIndexEntry } from "../src/storage/annotation-index";
import { Annotation } from "../src/domain/annotation";
import { MemoryAdapter } from "./memory-adapter";

describe("AnnotationStore", () => {
  let adapter: MemoryAdapter;
  let store: AnnotationStore;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    store = new AnnotationStore({ vault: { adapter } } as never);
    await store.load();
  });

  it("creates human-readable annotation files", async () => {
    const annotation = await store.create({
      sourcePath: "Notes/Test.md",
      sourceType: "markdown",
      status: "open",
      body: "Review this claim.",
      anchor: {
        kind: "markdown",
        startOffset: 6,
        endOffset: 10,
        startLine: 0,
        startCharacter: 6,
        endLine: 0,
        endCharacter: 10,
        quote: { exact: "beta", prefix: "alpha ", suffix: " gamma" }
      }
    });
    const path = threadPathFor(".siden-plus/annotations", annotation);
    expect(path).toBe(
      `.siden-plus/annotations/Notes/Test.md/beta-${annotation.id
        .replace(/-/g, "")
        .slice(0, 8)}.md`
    );
    const file = adapter.files.get(path);
    expect(file).toContain("# Annotation\n\nReview this claim.");
    expect(file).toContain('"exact": "beta"');
  });

  it("migrates legacy flat files into per-document folders", async () => {
    const legacy: Annotation = {
      schemaVersion: 1,
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      sourcePath: "Notes/Old.md",
      sourceType: "markdown",
      status: "open",
      createdAt: "2026-10-24T00:00:00.000Z",
      updatedAt: "2026-10-24T00:00:00.000Z",
      body: "Legacy body",
      anchor: {
        kind: "markdown",
        startOffset: 0,
        endOffset: 3,
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        endCharacter: 3,
        quote: { exact: "old quote text" }
      },
      replies: []
    };
    adapter.files.set(
      `.siden-plus/annotations/${legacy.id}.md`,
      serializeAnnotation(legacy)
    );
    const fresh = new AnnotationStore({ vault: { adapter } } as never);
    await fresh.load();
    expect(adapter.files.has(`.siden-plus/annotations/${legacy.id}.md`)).toBe(
      false
    );
    const expected = threadPathFor(".siden-plus/annotations", legacy);
    expect(expected).toBe(
      ".siden-plus/annotations/Notes/Old.md/old quote text-aaaaaaaa.md"
    );
    expect(adapter.files.get(expected)).toContain("Legacy body");
    expect(fresh.get(legacy.id)?.body).toBe("Legacy body");
  });

  it("keeps the file name stable when the anchor text drifts", async () => {
    const anchor = {
      kind: "markdown" as const,
      startOffset: 0,
      endOffset: 4,
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: 4,
      quote: { exact: "beta", prefix: "alpha ", suffix: " gamma" }
    };
    const annotation = await store.create({
      sourcePath: "Notes/Test.md",
      sourceType: "markdown",
      status: "open",
      body: "Comment",
      anchor
    });
    const before = threadPathFor(".siden-plus/annotations", annotation);
    const updated = await store.update(annotation.id, {
      anchor: {
        ...anchor,
        quote: { exact: "completely different text now" }
      }
    });
    const after = threadPathFor(".siden-plus/annotations", updated);
    expect(after).not.toBe(before); // would differ if we derived from quote
    // but the on-disk file did NOT move:
    expect(adapter.files.has(before)).toBe(true);
    expect(
      [...adapter.files.keys()].filter((path) =>
        path.startsWith(".siden-plus/annotations/Notes/Test.md/")
      )
    ).toHaveLength(1);
  });

  it("moves thread files when the source note is renamed", async () => {
    const annotation = await store.create({
      sourcePath: "Notes/Test.md",
      sourceType: "markdown",
      status: "open",
      body: "Comment",
      anchor: {
        kind: "markdown",
        startOffset: 0,
        endOffset: 4,
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        endCharacter: 4,
        quote: { exact: "beta", prefix: "alpha ", suffix: " gamma" }
      }
    });
    const oldPath = threadPathFor(".siden-plus/annotations", annotation);
    await store.renameSource("Notes/Test.md", "Notes/Renamed.md");
    expect(adapter.files.has(oldPath)).toBe(false);
    const moved = store.get(annotation.id);
    expect(moved?.sourcePath).toBe("Notes/Renamed.md");
    expect(
      [...adapter.files.keys()].some((path) =>
        path.startsWith(".siden-plus/annotations/Notes/Renamed.md/")
      )
    ).toBe(true);
    expect(
      [...adapter.files.keys()].some((path) =>
        path.startsWith(".siden-plus/annotations/Notes/Test.md/")
      )
    ).toBe(false);
  });

  it("caps file names at 16 display columns and drops trailing punctuation", async () => {
    const annotation = await store.create({
      sourcePath: "Notes/长文.md",
      sourceType: "markdown",
      status: "open",
      body: "Comment",
      anchor: {
        kind: "markdown",
        startOffset: 0,
        endOffset: 20,
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        endCharacter: 20,
        quote: { exact: "一二三四五六七八九十十一十二十三十四；" }
      }
    });
    const path = threadPathFor(".siden-plus/annotations", annotation);
    expect(path).toBe(
      `.siden-plus/annotations/Notes/长文.md/一二三四五六七八-${annotation.id
        .replace(/-/g, "")
        .slice(0, 8)}.md`
    );
    expect(adapter.files.has(path)).toBe(true);
  });

  it("re-mints stale file names and stale shards on the next load", async () => {
    const annotation = await store.create({
      sourcePath: "Notes/Test.md",
      sourceType: "markdown",
      status: "open",
      body: "Comment",
      anchor: {
        kind: "markdown",
        startOffset: 0,
        endOffset: 4,
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        endCharacter: 4,
        quote: { exact: "beta", prefix: "alpha ", suffix: " gamma" }
      }
    });
    const current = threadPathFor(".siden-plus/annotations", annotation);
    const staleName = current.replace(
      /beta-\w{8}\.md$/,
      "一二三四五六七八九十十一十二十三十四-beta.md"
    );
    await adapter.rename(current, staleName);
    adapter.files.set(".siden-plus/index/Notes__Test.md.jsonl", "{}\n");

    const fresh = new AnnotationStore({ vault: { adapter } } as never);
    await fresh.load();
    expect(adapter.files.has(staleName)).toBe(false);
    expect(adapter.files.has(current)).toBe(true);
    expect(adapter.files.has(".siden-plus/index/Notes__Test.md.jsonl")).toBe(
      false
    );
    expect(adapter.files.has(".siden-plus/index/Notes/Test.md.jsonl")).toBe(
      true
    );
  });

  it("recovers a moved unique passage", async () => {
    const annotation = await store.create({
      sourcePath: "Notes/Test.md",
      sourceType: "markdown",
      status: "open",
      body: "Comment",
      anchor: {
        kind: "markdown",
        startOffset: 0,
        endOffset: 4,
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        endCharacter: 4,
        quote: { exact: "beta", prefix: "alpha ", suffix: " gamma" }
      }
    });
    await store.reconcileMarkdownSource(
      "Notes/Test.md",
      "new line\nalpha beta gamma"
    );
    const recovered = store.get(annotation.id);
    expect(recovered?.status).toBe("open");
    expect(
      recovered?.anchor.kind === "markdown" && recovered.anchor.startOffset
    ).toBe(15);
  });

  it("orphans an ambiguous passage", async () => {
    const annotation = await store.create({
      sourcePath: "Notes/Test.md",
      sourceType: "markdown",
      status: "open",
      body: "Comment",
      anchor: {
        kind: "markdown",
        startOffset: 100,
        endOffset: 104,
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        endCharacter: 4,
        quote: { exact: "same" }
      }
    });
    await store.reconcileMarkdownSource("Notes/Test.md", "same and same");
    expect(store.get(annotation.id)?.status).toBe("orphaned");
  });

  it("moves deleted annotations to recoverable trash", async () => {
    const annotation = await store.create({
      sourcePath: "Notes/Test.md",
      sourceType: "markdown",
      status: "open",
      body: "Comment",
      anchor: { kind: "document" }
    });
    await store.delete(annotation.id);
    expect(store.get(annotation.id)).toBeUndefined();
    expect(
      [...adapter.files.keys()].some((path) =>
        path.startsWith(`.siden-plus/trash/${annotation.id}-`)
      )
    ).toBe(true);
  });

  it("adds and deletes replies inside the same file", async () => {
    const annotation = await store.create({
      sourcePath: "Notes/Test.md",
      sourceType: "markdown",
      status: "open",
      body: "Root",
      anchor: { kind: "document" }
    });
    await store.addReply(annotation.id, "First reply");
    await store.addReply(annotation.id, "Second reply");
    let current = store.get(annotation.id);
    expect(current?.replies.map((reply) => reply.body)).toEqual([
      "First reply",
      "Second reply"
    ]);
    const file = adapter.files.get(
      threadPathFor(".siden-plus/annotations", annotation)
    );
    expect(file).toContain("## Replies");
    expect(file).toContain("First reply");

    await store.deleteReply(annotation.id, current!.replies[0].id);
    current = store.get(annotation.id);
    expect(current?.replies.map((reply) => reply.body)).toEqual([
      "Second reply"
    ]);
  });

  it("keeps the per-document index shard in sync", async () => {
    const first = await store.create({
      sourcePath: "Notes/Test.md",
      sourceType: "markdown",
      status: "open",
      body: "One",
      anchor: { kind: "document" },
      color: "#90caf9",
      markStyle: "underline"
    });
    await store.create({
      sourcePath: "Notes/Other.md",
      sourceType: "markdown",
      status: "open",
      body: "Two",
      anchor: { kind: "document" }
    });
    const shard = adapter.files.get(".siden-plus/index/Notes/Test.md.jsonl");
    expect(shard).toBeTruthy();
    const entry = JSON.parse(shard!.trim()) as AnnotationIndexEntry;
    expect(entry).toMatchObject({
      id: first.id,
      color: "#90caf9",
      markStyle: "underline",
      replies: 0,
      path: threadPathFor(".siden-plus/annotations", first)
    });
    expect(adapter.files.has(".siden-plus/index/Notes/Other.md.jsonl")).toBe(
      true
    );

    await store.renameSource("Notes/Test.md", "Notes/Renamed.md");
    expect(adapter.files.has(".siden-plus/index/Notes/Test.md.jsonl")).toBe(
      false
    );
    const renamed = adapter.files.get(".siden-plus/index/Notes/Renamed.md.jsonl");
    expect(
      (JSON.parse(renamed!.trim()) as AnnotationIndexEntry).source
    ).toBe("Notes/Renamed.md");
  });
});
