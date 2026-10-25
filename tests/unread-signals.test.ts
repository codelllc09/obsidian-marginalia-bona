import { describe, expect, it } from "vitest";
import { AnnotationStore } from "../src/storage/annotation-store";
import { MemoryAdapter } from "./memory-adapter";
import { buildAnchor } from "../src/rest-bridge/anchor";
import {
  parseAnnotation,
  serializeAnnotation
} from "../src/storage/annotation-markdown";
import type { Annotation, NewAnnotation } from "../src/domain/annotation";

const NOTE = "Notes/Signals.md";
const NOTE_TEXT = "The quick brown fox jumps over the lazy dog.";

function make(): { store: AnnotationStore; adapter: MemoryAdapter } {
  const adapter = new MemoryAdapter();
  const store = new AnnotationStore({ vault: { adapter } } as never);
  return { store, adapter };
}

function input(overrides: Partial<NewAnnotation> = {}): NewAnnotation {
  return {
    sourcePath: NOTE,
    sourceType: "markdown",
    status: "open",
    body: "root",
    author: "user",
    readAt: "2026-01-01T00:00:00.000Z",
    anchor: buildAnchor(NOTE_TEXT, "lazy dog", NOTE_TEXT.indexOf("lazy dog")),
    ...overrides
  };
}

describe("unread signals", () => {
  it("re-marks the thread unread when somebody else replies", async () => {
    const { store } = make();
    const created = await store.create(input());
    const after = await store.addReply(created.id, "answer", "Pi");
    expect(after.readAt).toBeUndefined();
  });

  it("keeps the read mark when the user replies", async () => {
    const { store } = make();
    store.setUserName("user");
    const created = await store.create(input());
    const after = await store.addReply(created.id, "my own note", "user");
    expect(after.readAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("treats a custom user name as 'me'", async () => {
    const { store } = make();
    store.setUserName("lcw");
    const created = await store.create(input({ author: "lcw" }));
    const after = await store.addReply(created.id, "self", "lcw");
    expect(after.readAt).toBe("2026-01-01T00:00:00.000Z");
    const other = await store.addReply(created.id, "agent", "Agent");
    expect(other.readAt).toBeUndefined();
  });

  it("external replies by others clear the read mark on disk too", async () => {
    const { store, adapter } = make();
    const created = await store.create(input());
    const path = `.marginalia-bona/annotations/Notes/Signals.md/${created.id.slice(0, 8)}`;
    // The file our store wrote is the external version we then extend.
    const files = [...(adapter as unknown as { files: Map<string, string> }).files.keys()];
    const threadPath = files.find((file) => file.includes(created.id.slice(0, 8)))!;
    expect(threadPath).toBeDefined();
    const stored = parseAnnotation(await adapter.read(threadPath));
    const external: Annotation = {
      ...stored,
      replies: [
        ...stored.replies,
        {
          id: "abc12345",
          createdAt: "2026-02-01T00:00:00.000Z",
          author: "Pi",
          body: "agent reply"
        }
      ],
      updatedAt: "2026-02-01T00:00:00.000Z"
    };
    await adapter.write(threadPath, serializeAnnotation(external));
    const result = await store.ingestExternal(threadPath, serializeAnnotation(external));
    expect(result).toBe("changed");
    expect(store.get(created.id)?.readAt).toBeUndefined();
    // And the cleared state is persisted: a reload cannot resurrect it.
    const persisted = parseAnnotation(await adapter.read(threadPath));
    expect(persisted.readAt).toBeUndefined();
    expect(persisted.replies).toHaveLength(1);
    expect(path).toBeTruthy();
  });

  it("leaves the read mark alone when only formatting changed", async () => {
    const { store, adapter } = make();
    const created = await store.create(input());
    const files = [...(adapter as unknown as { files: Map<string, string> }).files.keys()];
    const threadPath = files.find((file) => file.includes(created.id.slice(0, 8)))!;
    const content = await adapter.read(threadPath);
    expect(await store.ingestExternal(threadPath, content)).toBe("unchanged");
    expect(store.get(created.id)?.readAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
