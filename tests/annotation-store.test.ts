import { beforeEach, describe, expect, it } from "vitest";

import { AnnotationStore } from "../src/storage/annotation-store";
import type { AnnotationIndexEntry } from "../src/storage/annotation-index";

class MemoryAdapter {
  files = new Map<string, string>();
  directories = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.directories.add(path);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    return {
      files: [...this.files.keys()].filter((file) => file.startsWith(`${path}/`)),
      folders: []
    };
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error("Missing file");
    return value;
  }

  async write(path: string, value: string): Promise<void> {
    this.files.set(path, value);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const value = await this.read(oldPath);
    this.files.set(newPath, value);
    this.files.delete(oldPath);
  }
}

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
    const file = adapter.files.get(`.siden-plus/annotations/${annotation.id}.md`);
    expect(file).toContain("# Annotation\n\nReview this claim.");
    expect(file).toContain('"exact": "beta"');
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
    const file = adapter.files.get(`.siden-plus/annotations/${annotation.id}.md`);
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
    const shard = adapter.files.get(".siden-plus/index/Notes__Test.md.jsonl");
    expect(shard).toBeTruthy();
    const entry = JSON.parse(shard!.trim()) as AnnotationIndexEntry;
    expect(entry).toMatchObject({
      id: first.id,
      color: "#90caf9",
      markStyle: "underline",
      replies: 0
    });
    expect(
      adapter.files.has(".siden-plus/index/Notes__Other.md.jsonl")
    ).toBe(true);

    await store.renameSource("Notes/Test.md", "Notes/Renamed.md");
    expect(
      adapter.files.has(".siden-plus/index/Notes__Test.md.jsonl")
    ).toBe(false);
    const renamed = adapter.files.get(".siden-plus/index/Notes__Renamed.md.jsonl");
    expect((JSON.parse(renamed!.trim()) as AnnotationIndexEntry).source).toBe(
      "Notes/Renamed.md"
    );
  });
});
