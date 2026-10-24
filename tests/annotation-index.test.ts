import { beforeEach, describe, expect, it } from "vitest";
import {
  INDEX_DIRECTORY,
  AnnotationIndexEntry,
  entryFor,
  rebuildIndex,
  shardNameFor,
  shardPathFor,
  writeShard
} from "../src/storage/annotation-index";
import { Annotation } from "../src/domain/annotation";
import { threadPathFor } from "../src/storage/annotation-paths";
import { MemoryAdapter } from "./memory-adapter";

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    schemaVersion: 1,
    id: overrides.id ?? "11111111-1111-1111-1111-111111111111",
    sourcePath: "Notes/Test.md",
    sourceType: "markdown",
    status: "open",
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
    body: "Root comment",
    anchor: {
      kind: "markdown",
      startOffset: 6,
      endOffset: 10,
      startLine: 4,
      startCharacter: 6,
      endLine: 4,
      endCharacter: 10,
      quote: { exact: "beta", prefix: "alpha ", suffix: " gamma" }
    },
    replies: [
      { id: "aaaaaaaa", createdAt: "2026-10-24T01:00:00.000Z", body: "Reply 1" }
    ],
    ...overrides
  };
}

describe("annotation index", () => {
  let adapter: MemoryAdapter;

  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

  it("mirrors source paths in shard names", () => {
    expect(shardNameFor("Daily/2026-10-24.md")).toBe(
      "Daily/2026-10-24.md.jsonl"
    );
    expect(shardNameFor("A 100% done.pdf")).toBe("A 100%25 done.pdf.jsonl");
    expect(shardPathFor("Notes/Test.md")).toBe(
      ".marginalia-bona/index/Notes/Test.md.jsonl"
    );
  });

  it("builds one line per annotation with location metadata", () => {
    const entry = entryFor(
      annotation({ id: "abc", color: "#90caf9", markStyle: "underline" })
    );
    expect(entry).toMatchObject({
      id: "abc",
      source: "Notes/Test.md",
      status: "open",
      type: "markdown",
      color: "#90caf9",
      markStyle: "underline",
      line: 4,
      quote: "beta",
      replies: 1,
      path: threadPathFor(".marginalia-bona/annotations", annotation({ id: "abc" }))
    });
  });

  it("writes a shard sorted by line and deletes empty shards", async () => {
    const later = annotation({
      id: "22222222-2222-2222-2222-222222222222",
      anchor: {
        kind: "markdown",
        startOffset: 0,
        endOffset: 2,
        startLine: 1,
        startCharacter: 0,
        endLine: 1,
        endCharacter: 2,
        quote: { exact: "hi" }
      }
    });
    await writeShard(adapter, "Notes/Test.md", [annotation(), later]);
    const path = `${INDEX_DIRECTORY}/Notes/Test.md.jsonl`;
    const lines = (adapter.files.get(path) ?? "").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[0]) as AnnotationIndexEntry).line).toBe(1);
    expect((JSON.parse(lines[1]) as AnnotationIndexEntry).line).toBe(4);

    await writeShard(adapter, "Notes/Test.md", []);
    expect(adapter.files.has(path)).toBe(false);
  });

  it("rebuilds shards and removes stale files in nested folders", async () => {
    await writeShard(adapter, "Notes/Gone.md", [annotation()]);
    adapter.files.set(".marginalia-bona/index/Old/Deep/stale.md.jsonl", "{}\n");
    await rebuildIndex(adapter, [annotation()]);
    expect(adapter.files.has(`${INDEX_DIRECTORY}/Notes/Gone.md.jsonl`)).toBe(
      false
    );
    expect(
      adapter.files.has(".marginalia-bona/index/Old/Deep/stale.md.jsonl")
    ).toBe(false);
    expect(adapter.files.has(`${INDEX_DIRECTORY}/Notes/Test.md.jsonl`)).toBe(
      true
    );
  });
});
