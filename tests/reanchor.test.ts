import { beforeEach, describe, expect, it } from "vitest";

import { AnnotationStore } from "../src/storage/annotation-store";
import { MemoryAdapter } from "./memory-adapter";

describe("AnnotationStore.reanchor", () => {
  let adapter: MemoryAdapter;
  let store: AnnotationStore;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    store = new AnnotationStore({ vault: { adapter } } as never);
    await store.load();
  });

  it("replaces the anchor and clears the orphaned status", async () => {
    const created = await store.create({
      sourcePath: "Notes/Test.md",
      sourceType: "markdown",
      status: "orphaned",
      body: "Comment about a passage that was deleted.",
      anchor: {
        kind: "markdown",
        startOffset: 100,
        endOffset: 110,
        startLine: 5,
        startCharacter: 0,
        endLine: 5,
        endCharacter: 10,
        quote: { exact: "deleted passage" }
      },
      author: "user"
    });

    const newAnchor = {
      kind: "markdown" as const,
      startOffset: 0,
      endOffset: 8,
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: 8,
      quote: { exact: "new text" },
      quoteHash: "abcd1234",
      originalQuote: "new text"
    };
    const reanchored = await store.reanchor(created.id, newAnchor);

    expect(reanchored.status).toBe("open");
    expect(reanchored.anchor).toEqual(newAnchor);
    // The thread survives re-anchoring.
    expect(reanchored.body).toBe("Comment about a passage that was deleted.");
    expect(store.get(created.id)?.status).toBe("open");
  });
});
