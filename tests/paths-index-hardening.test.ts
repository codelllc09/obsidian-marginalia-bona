import { describe, expect, it } from "vitest";
import {
  ANNOTATIONS_DIRECTORY,
  annotationFolderFor,
  ensureDirectoryPath,
  shortIdFor,
  threadFileNameFor,
  threadPathFor
} from "../src/storage/annotation-paths";
import { entryFor, rebuildIndex, shardNameFor, shardPathFor, writeShard } from "../src/storage/annotation-index";
import { MemoryAdapter } from "./memory-adapter";
import type { Annotation } from "../src/domain/annotation";

function make(overrides: Partial<Annotation> = {}): Annotation {
  return {
    schemaVersion: 1,
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    sourcePath: "Notes/Test.md",
    sourceType: "markdown",
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    body: "x",
    anchor: {
      kind: "markdown",
      startOffset: 0,
      endOffset: 4,
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: 4,
      quote: { exact: "body", prefix: "", suffix: "" }
    },
    replies: [],
    ...overrides
  };
}

describe("thread file names", () => {
  it("derives quote label + short id, minted once", () => {
    expect(threadFileNameFor(make())).toBe("body-aaaaaaaa.md");
    expect(shortIdFor("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe("aaaaaaaa");
  });

  it("falls back to 'annotation' for quotes made only of forbidden characters", () => {
    const annotation = make({
      anchor: { kind: "markdown", startOffset: 0, endOffset: 3, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 3, quote: { exact: "???" } }
    });
    expect(threadFileNameFor(annotation)).toBe("annotation-aaaaaaaa.md");
  });

  it("uses 'note' for document anchors", () => {
    expect(threadFileNameFor(make({ anchor: { kind: "document" } }))).toBe("note-aaaaaaaa.md");
  });

  it("strips path/hostile characters and collapses whitespace", () => {
    const annotation = make({
      anchor: { kind: "markdown", startOffset: 0, endOffset: 12, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 12, quote: { exact: "a/b:c*d?e#f" } }
    });
    const name = threadFileNameFor(annotation);
    expect(name).not.toMatch(/[\\/:*?#"<>|%]/);
    expect(name.startsWith("a b c d e f")).toBe(true);
  });

  it("caps CJK labels at 16 columns (8 characters) and drops trailing punctuation", () => {
    const annotation = make({
      anchor: { kind: "markdown", startOffset: 0, endOffset: 19, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 19, quote: { exact: "一二三四五六七八九十十一十二十三十四；" } }
    });
    expect(threadFileNameFor(annotation)).toBe(`一二三四五六七八-${shortIdFor(annotation.id)}.md`);
  });

  it("falls back to 'annotation' for symbol-only quotes (emoji are stripped)", () => {
    // Trailing punctuation/symbol stripping removes pure-emoji labels; the
    // short id keeps the file unique and recognizable.
    const annotation = make({
      anchor: { kind: "markdown", startOffset: 0, endOffset: 4, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 4, quote: { exact: "🎉🎉" } }
    });
    expect(threadFileNameFor(annotation)).toBe(`annotation-${shortIdFor(annotation.id)}.md`);
    // Emoji plus CJK keeps the CJK label.
    const mixed = make({
      anchor: { kind: "markdown", startOffset: 0, endOffset: 4, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 4, quote: { exact: "庆祝🎉" } }
    });
    expect(threadFileNameFor(mixed)).toBe(`庆祝-${shortIdFor(mixed.id)}.md`);
  });

  it("mirrors the source folder under the annotations directory", () => {
    expect(annotationFolderFor(ANNOTATIONS_DIRECTORY, "Daily/2026-10-24.md"))
      .toBe(".marginalia-bona/annotations/Daily/2026-10-24.md");
    expect(annotationFolderFor(ANNOTATIONS_DIRECTORY, "Root.md"))
      .toBe(".marginalia-bona/annotations/Root.md");
    expect(threadPathFor(ANNOTATIONS_DIRECTORY, make()))
      .toBe(".marginalia-bona/annotations/Notes/Test.md/body-aaaaaaaa.md");
  });
});

describe("ensureDirectoryPath", () => {
  it("creates every missing segment without recursing into adapter.mkdir", async () => {
    const adapter = new MemoryAdapter();
    await ensureDirectoryPath(adapter, "a/b/c/d");
    expect(await adapter.exists("a/b/c/d")).toBe(true);
    // Idempotent on the second call.
    await ensureDirectoryPath(adapter, "a/b/c/d");
    expect(await adapter.exists("a/b/c/d")).toBe(true);
  });
});

describe("index shards", () => {
  it("mirrors the source path and percent-encodes hostile bytes", () => {
    expect(shardPathFor("Daily/2026-10-24.md")).toBe(".marginalia-bona/index/Daily/2026-10-24.md.jsonl");
    expect(shardNameFor("Notes/a%b.md")).toContain("%25");
    expect(shardNameFor("Notes/中.md")).toContain("中");
  });

  it("entryFor captures identity, position, drift, and reply count", () => {
    const entry = entryFor(make({
      color: "#ffcc00",
      markStyle: "wavy",
      author: "Pi",
      replies: [{ id: "r", createdAt: "2026-01-01T00:00:00.000Z", body: "b" }]
    }));
    expect(entry).toMatchObject({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      source: "Notes/Test.md",
      line: 0,
      replies: 1,
      author: "Pi",
      color: "#ffcc00",
      markStyle: "wavy"
    });
    expect(entry.drifted).toBeUndefined();
    const drifted = entryFor(make({
      anchor: { kind: "markdown", startOffset: 0, endOffset: 3, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 3, quote: { exact: "now" }, originalQuote: "then" }
    }));
    expect(drifted.drifted).toBe(true);
    const doc = entryFor(make({ anchor: { kind: "document" } }));
    expect(doc.line).toBe(-1);
    expect(doc.quote).toBe("");
  });

  it("writeShard is a no-op when content is unchanged and removes empty shards", async () => {
    const adapter = new MemoryAdapter();
    const annotation = make();
    await writeShard(adapter, "Notes/Test.md", [annotation]);
    const path = shardPathFor("Notes/Test.md");
    const first = await adapter.read(path);
    await writeShard(adapter, "Notes/Test.md", [annotation]);
    expect(await adapter.read(path)).toBe(first);
    expect(first.split("\n")).toHaveLength(2); // one entry + trailing newline

    await writeShard(adapter, "Notes/Test.md", []);
    expect(await adapter.exists(path)).toBe(false);
  });

  it("writeShard orders entries by position; document anchors first", async () => {
    const adapter = new MemoryAdapter();
    const late = make({
      id: "11111111-1111-1111-1111-111111111111",
      anchor: { kind: "markdown", startOffset: 40, endOffset: 44, startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 4, quote: { exact: "body" } }
    });
    const doc = make({ id: "22222222-2222-2222-2222-222222222222", anchor: { kind: "document" } });
    await writeShard(adapter, "Notes/Test.md", [late, doc]);
    const lines = (await adapter.read(shardPathFor("Notes/Test.md"))).trim().split("\n");
    const entries = lines.map((line) => JSON.parse(line) as { id: string });
    expect(entries[0].id).toBe(doc.id);
    expect(entries[1].id).toBe(late.id);
  });

  it("rebuildIndex removes shards whose source no longer has annotations", async () => {
    const adapter = new MemoryAdapter();
    await adapter.write(".marginalia-bona/index/Gone.md.jsonl", "{}\n");
    const keep = make();
    await writeShard(adapter, "Notes/Test.md", [keep]);
    const result = await rebuildIndex(adapter, [keep]);
    expect(await adapter.exists(".marginalia-bona/index/Gone.md.jsonl")).toBe(false);
    expect(result).toBe(2); // 1 live source + 1 removed shard
  });

  it("keeps quote previews valid JSON even at the 120-char boundary", async () => {
    const long = "x".repeat(119) + "🎉"; // surrogate pair straddles the cut
    const adapter = new MemoryAdapter();
    const annotation = make({
      anchor: { kind: "markdown", startOffset: 0, endOffset: 121, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 121, quote: { exact: long } }
    });
    await writeShard(adapter, "Notes/Test.md", [annotation]);
    const lines = (await adapter.read(shardPathFor("Notes/Test.md"))).trim().split("\n");
    // Must parse: no lone-surrogate corruption in the shard.
    expect(() => {
      JSON.parse(lines[0]);
    }).not.toThrow();
  });
});
