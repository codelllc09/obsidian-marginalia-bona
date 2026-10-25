import { describe, expect, it } from "vitest";
import { AnnotationStore } from "../src/storage/annotation-store";
import { MemoryAdapter } from "./memory-adapter";
import { serializeAnnotation } from "../src/storage/annotation-markdown";
import { buildAnchor } from "../src/rest-bridge/anchor";
import type { Annotation, NewAnnotation } from "../src/domain/annotation";

const NOTE = "Notes/Test.md";
const NOTE_TEXT =
  "The quick brown fox jumps over the lazy dog.\nSecond line with quick brown fox again.";

function anchor(text: string, quote: string): Annotation["anchor"] {
  return buildAnchor(text, quote, text.indexOf(quote));
}

/** A store over a bare MemoryAdapter: notes are written by the test. */
function makeStore(): { store: AnnotationStore; adapter: MemoryAdapter } {
  const adapter = new MemoryAdapter();
  return {
    adapter,
    store: new AnnotationStore({ vault: { adapter } } as never)
  };
}

function input(overrides: Partial<NewAnnotation> = {}): NewAnnotation {
  return {
    sourcePath: NOTE,
    sourceType: "markdown",
    status: "open",
    body: "x",
    anchor: anchor(NOTE_TEXT, "lazy dog"),
    ...overrides
  };
}

async function create(
  store: AnnotationStore,
  overrides: Partial<NewAnnotation> = {}
): Promise<Annotation> {
  return store.create(input(overrides));
}

describe("store / input validation", () => {
  it("refuses a duplicate id with a clear error", async () => {
    const { store } = makeStore();
    await create(store, { id: "dup-1" });
    await expect(create(store, { id: "dup-1" })).rejects.toThrow(/already exists/);
  });

  it("refuses a markdown anchor without quote metadata instead of crashing", async () => {
    const { store } = makeStore();
    const broken = input();
    (broken.anchor as { quote?: unknown }).quote = undefined;
    await expect(store.create(broken)).rejects.toThrow();
  });

  it("refuses non-finite or negative anchor offsets", async () => {
    const { store } = makeStore();
    const negative = input({
      anchor: {
        ...anchor(NOTE_TEXT, "lazy dog"),
        startOffset: -4,
        endOffset: 4
      } as Annotation["anchor"]
    });
    await expect(store.create(negative)).rejects.toThrow();

    const nan = input({
      anchor: {
        ...anchor(NOTE_TEXT, "lazy dog"),
        startOffset: Number.NaN,
        endOffset: Number.NaN
      } as Annotation["anchor"]
    });
    await expect(store.create(nan)).rejects.toThrow();
  });

  it("refuses an anchor whose span disagrees with the quote length", async () => {
    const { store } = makeStore();
    const mismatched = input({
      anchor: { ...anchor(NOTE_TEXT, "lazy dog"), endOffset: 99 } as Annotation["anchor"]
    });
    await expect(store.create(mismatched)).rejects.toThrow();
  });

  it("refuses updates that would corrupt the anchor", async () => {
    const { store } = makeStore();
    const created = await create(store);
    await expect(
      store.update(created.id, {
        anchor: { ...created.anchor, endOffset: 9999 } as Annotation["anchor"]
      })
    ).rejects.toThrow();
  });
});

describe("store / trash consistency", () => {
  it("refuses to restore an id that is live on disk (would fork the thread)", async () => {
    const { store } = makeStore();
    await store.create(input({ id: "live-1", body: "original" }));
    await store.delete("live-1");
    // The same id comes back through a different route (sync conflict,
    // manual copy) while the trash entry still exists.
    await store.create(input({ id: "live-1", body: "resurrected" }));
    await expect(store.restoreFromTrash("live-1")).rejects.toThrow(/active|live/i);
    // The live thread is untouched and still parseable on disk.
    expect(store.get("live-1")?.body).toBe("resurrected");
  });

  it("restore throws for unknown ids and keeps the bin intact", async () => {
    const { store } = makeStore();
    const created = await create(store);
    await store.delete(created.id);
    await expect(store.restoreFromTrash("nope")).rejects.toThrow(/No trash entry/);
    expect((await store.listTrash()).map((e) => e.id)).toContain(created.id);
  });

  it("restore skips unparseable trash files instead of dying on them", async () => {
    const { store, adapter } = makeStore();
    await adapter.write(".marginalia-bona/trash/garbage.md", "not an annotation");
    const created = await create(store);
    await store.delete(created.id);
    const restored = await store.restoreFromTrash(created.id);
    expect(restored.id).toBe(created.id);
  });

  it("delete twice throws the second time", async () => {
    const { store } = makeStore();
    const created = await create(store);
    await store.delete(created.id);
    await expect(store.delete(created.id)).rejects.toThrow(/Unknown/);
  });

  it("purgeTrash keeps entries exactly at the cutoff (strictly older purges)", async () => {
    const { store, adapter } = makeStore();
    await adapter.mkdir(".marginalia-bona/trash");
    const now = Date.now();
    adapter.mtimes.set(".marginalia-bona/trash/old.md", now - 31 * 86_400_000);
    adapter.mtimes.set(".marginalia-bona/trash/edge.md", now - 30 * 86_400_000);
    adapter.mtimes.set(".marginalia-bona/trash/new.md", now - 1000);
    await adapter.write(".marginalia-bona/trash/old.md", "x");
    await adapter.write(".marginalia-bona/trash/edge.md", "x");
    await adapter.write(".marginalia-bona/trash/new.md", "x");
    const purged = await store.purgeTrash(now - 30 * 86_400_000);
    expect(purged).toBe(1);
    expect(await adapter.exists(".marginalia-bona/trash/edge.md")).toBe(true);
    expect(await adapter.exists(".marginalia-bona/trash/old.md")).toBe(false);
  });

  it("delete Reply-only lifecycle: removing an unknown reply is a no-op update", async () => {
    const { store } = makeStore();
    const created = await create(store);
    const after = await store.deleteReply(created.id, "ghost-reply");
    expect(after.replies).toHaveLength(0);
    expect(after.updatedAt >= created.updatedAt).toBe(true);
  });
});

describe("store / external ingest identity", () => {
  it("a file replaced by a different annotation id evicts the stale one", async () => {
    const { store, adapter } = makeStore();
    await adapter.write(NOTE, NOTE_TEXT);
    const first = await create(store);
    const path = `.marginalia-bona/annotations/Notes/Test.md/lazy dog-${first.id.slice(0, 8)}.md`;

    // An external tool replaces the file wholesale with a new annotation.
    const second = input({ id: "second-id", body: "replaced" });
    await adapter.write(path, serializeAnnotation({ ...second, schemaVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), replies: [] } as Annotation));
    const result = await store.ingestExternal(path, await adapter.read(path));
    expect(result).toBe("added");
    expect(store.get("second-id")).toBeDefined();
    // The old id must NOT stay live: its only file is gone.
    expect(store.get(first.id)).toBeUndefined();
    expect(store.all()).toHaveLength(1);
  });

  it("ingesting identical content is a no-op", async () => {
    const { store, adapter } = makeStore();
    await adapter.write(NOTE, NOTE_TEXT);
    const created = await create(store);
    const path = store.all().length ? `.marginalia-bona/annotations/Notes/Test.md/lazy dog-${created.id.slice(0, 8)}.md` : "";
    const content = await adapter.read(path);
    expect(await store.ingestExternal(path, content)).toBe("unchanged");
  });

  it("ingesting a moved file with a changed source re-buckets and re-shards", async () => {
    const { store, adapter } = makeStore();
    await adapter.write(NOTE, NOTE_TEXT);
    await adapter.write("Notes/Other.md", NOTE_TEXT);
    const created = await create(store);
    const oldPath = `.marginalia-bona/annotations/Notes/Test.md/lazy dog-${created.id.slice(0, 8)}.md`;
    const moved = { ...created, sourcePath: "Notes/Other.md" };
    const newPath = `.marginalia-bona/annotations/Notes/Other.md/lazy dog-${created.id.slice(0, 8)}.md`;
    await adapter.write(newPath, serializeAnnotation(moved));
    const result = await store.ingestExternal(newPath, serializeAnnotation(moved));
    expect(result).toBe("changed");
    expect(store.forSource("Notes/Test.md")).toHaveLength(0);
    expect(store.forSource("Notes/Other.md")).toHaveLength(1);
    expect(await adapter.exists(oldPath)).toBe(true); // external copy stays; not ours to delete
  });

  it("forgetExternal returns false for unknown paths and true after ingest", async () => {
    const { store, adapter } = makeStore();
    await adapter.write(NOTE, NOTE_TEXT);
    expect(await store.forgetExternal("nowhere/x.md")).toBe(false);
    const created = await create(store);
    const path = `.marginalia-bona/annotations/Notes/Test.md/lazy dog-${created.id.slice(0, 8)}.md`;
    expect(await store.forgetExternal(path)).toBe(true);
    expect(store.get(created.id)).toBeUndefined();
  });
});

describe("store / reconcile edge cases", () => {
  it("re-anchors to the contextual match when the passage moved", async () => {
    const { store, adapter } = makeStore();
    await adapter.write(NOTE, NOTE_TEXT);
    const created = await create(store);
    const movedText = `Prefix padding. ${NOTE_TEXT}`;
    await store.reconcileMarkdownSource(NOTE, movedText);
    const updated = store.get(created.id)!;
    const a = updated.anchor as { startOffset: number };
    expect(movedText.slice(a.startOffset, a.startOffset + 8)).toBe("lazy dog");
    expect(updated.status).toBe("open");
  });

  it("orphans when the passage is gone and recovers when it returns", async () => {
    const { store, adapter } = makeStore();
    await adapter.write(NOTE, NOTE_TEXT);
    const created = await create(store);
    await store.reconcileMarkdownSource(NOTE, "Everything changed.");
    expect(store.get(created.id)?.status).toBe("orphaned");
    await store.reconcileMarkdownSource(NOTE, NOTE_TEXT);
    expect(store.get(created.id)?.status).toBe("open");
  });

  it("orphans on ambiguity instead of guessing (passage duplicated elsewhere)", async () => {
    const { store, adapter } = makeStore();
    await adapter.write(NOTE, NOTE_TEXT);
    const created = await create(store);
    // The original occurrence was destroyed; two fresh identical copies exist.
    const ambiguous = "lazy dog and lazy dog";
    await store.reconcileMarkdownSource(NOTE, ambiguous);
    expect(store.get(created.id)?.status).toBe("orphaned");
  });

  it("never touches document-anchored annotations", async () => {
    const { store, adapter } = makeStore();
    await adapter.write(NOTE, NOTE_TEXT);
    const created = await create(store, { anchor: { kind: "document" } });
    await store.reconcileMarkdownSource(NOTE, "totally different");
    expect(store.get(created.id)?.status).toBe("open");
  });
});
