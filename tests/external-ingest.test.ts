import { beforeEach, describe, expect, it } from "vitest";

import { AnnotationStore } from "../src/storage/annotation-store";
import { MemoryAdapter } from "./memory-adapter";

describe("external ingest", () => {
  let adapter: MemoryAdapter;
  let store: AnnotationStore;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    store = new AnnotationStore({ vault: { adapter } } as never);
    await store.load();
  });

  const threadFile = (body: string, status = "open") =>
    `---
siden-schema: 1
id: "ext-0001"
source: "Notes/Test.md"
source-type: "markdown"
status: "${status}"
author: "Pi"
created: "2026-10-25T10:00:00.000Z"
updated: "2026-10-25T10:00:00.000Z"
---

# Annotation

${body}

<!-- siden:anchor -->

## Anchor metadata

\`\`\`json
{"kind":"markdown","startOffset":0,"endOffset":11,"startLine":0,"startCharacter":0,"endLine":0,"endCharacter":11,"quote":{"exact":"new passage"}}
\`\`\`

<!-- /siden:anchor -->
`;

  it("ingests an externally created thread as added", async () => {
    const result = await store.ingestExternal(
      "Notes/Test.md/ext-0001.md",
      threadFile("Agent-written comment.")
    );
    expect(result).toBe("added");
    const stored = store.get("ext-0001");
    expect(stored?.author).toBe("Pi");
    expect(stored?.body).toBe("Agent-written comment.");
  });

  it("reports unchanged when content matches memory", async () => {
    await store.ingestExternal(
      "Notes/Test.md/ext-0001.md",
      threadFile("Agent-written comment.")
    );
    const result = await store.ingestExternal(
      "Notes/Test.md/ext-0001.md",
      threadFile("Agent-written comment.")
    );
    expect(result).toBe("unchanged");
  });

  it("applies external edits over in-memory state (disk wins)", async () => {
    await store.ingestExternal(
      "Notes/Test.md/ext-0001.md",
      threadFile("Original agent text.")
    );
    const result = await store.ingestExternal(
      "Notes/Test.md/ext-0001.md",
      threadFile("Edited by the agent afterwards.")
    );
    expect(result).toBe("changed");
    expect(store.get("ext-0001")?.body).toBe(
      "Edited by the agent afterwards."
    );
  });

  it("never ingests unparseable files and reports them as invalid", async () => {
    const result = await store.ingestExternal(
      "Notes/Test.md/broken.md",
      "not an annotation file at all"
    );
    expect(result).toBe("invalid");
    expect(store.all()).toHaveLength(0);
    // The invalid file is remembered in diagnostics, never rewritten.
    expect(store.getDiagnostics().some((d) => d.path.endsWith("broken.md"))).toBe(
      true
    );
  });

  it("forgets threads whose file was deleted externally", async () => {
    const path = "Notes/Test.md/ext-0001.md";
    await store.ingestExternal(path, threadFile("To be deleted."));
    expect(await store.forgetExternal(path)).toBe(true);
    expect(store.get("ext-0001")).toBeUndefined();
    expect(await store.forgetExternal(path)).toBe(false);
  });
});
