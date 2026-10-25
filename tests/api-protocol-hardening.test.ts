import { describe, expect, it } from "vitest";
import { AnnotationsApi } from "../src/rest-bridge/annotations-api";
import { AnnotationStore } from "../src/storage/annotation-store";
import { MemoryAdapter } from "./memory-adapter";
import { TFile } from "./obsidian-runtime-mock";
import type MarginaliaPlugin from "../src/main";

const NOTE = "Notes/Test.md";
const NOTE_TEXT =
  "The quick brown fox jumps over the lazy dog.\nSecond line with quick brown fox again.";
const OTHER = "Notes/Other.md";
const OTHER_TEXT = "A lazy dog passage sits here.";

/** Full API harness: two notes, adapter-backed, with quote lookups. */
function makeApi() {
  const adapter = new MemoryAdapter();
  const store = new AnnotationStore({ vault: { adapter } } as never);
  const texts: Record<string, string> = {
    [NOTE]: NOTE_TEXT,
    [OTHER]: OTHER_TEXT
  };
  const plugin = {
    app: {
      vault: {
        adapter,
        getAbstractFileByPath: (path: string) => {
          const text = texts[path];
          if (text === undefined) return null;
          const file = new TFile();
          file.path = path;
          file.extension = "md";
          return file;
        },
        cachedRead: async (file: { path: string }) => texts[file.path]
      }
    },
    store
  };
  return {
    adapter,
    store,
    api: new AnnotationsApi(plugin as unknown as MarginaliaPlugin)
  };
}

type Result = { status: number; body: Record<string, unknown> };

describe("api protocol / create validation", () => {
  it("requires non-blank text and quote", async () => {
    const { api } = makeApi();
    expect(((await api.create(NOTE, { text: "  ", quote: "lazy dog" })) as Result).status).toBe(400);
    expect(((await api.create(NOTE, { text: "x", quote: "" })) as Result).status).toBe(400);
    expect(((await api.create(NOTE, { text: "x", quote: "   " })) as Result).status).toBe(400);
  });

  it("rejects creation on non-notes with 40402", async () => {
    const { api } = makeApi();
    const result = (await api.create("Notes/Missing.md", { text: "x", quote: "y" })) as Result;
    expect(result.status).toBe(404);
    expect(result.body.errorCode).toBe(40402);
  });

  it("never guesses on multi-match quotes; occurrence is bounded and floored", async () => {
    const { api } = makeApi();
    const ambiguous = (await api.create(NOTE, { text: "x", quote: "quick brown fox" })) as Result;
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.errorCode).toBe(40902);
    expect(String(ambiguous.body.message)).toContain("occurrence (1..2)");

    expect(((await api.create(NOTE, { text: "x", quote: "quick brown fox", occurrence: 0 })) as Result).status).toBe(409);
    expect(((await api.create(NOTE, { text: "x", quote: "quick brown fox", occurrence: -1 })) as Result).status).toBe(409);
    expect(((await api.create(NOTE, { text: "x", quote: "quick brown fox", occurrence: 99 })) as Result).status).toBe(409);
    // Fractional floors to the nearest valid occurrence.
    const floored = (await api.create(NOTE, { text: "x", quote: "quick brown fox", occurrence: 1.9 })) as Result;
    expect(floored.status).toBe(201);
    // The second occurrence resolves with occurrence: 2.
    const second = (await api.create(NOTE, { text: "x", quote: "quick brown fox", occurrence: 2 })) as Result;
    expect(second.status).toBe(201);
    expect((second.body.anchor as { line: number }).line).toBe(2); // 1-based
  });

  it("trims body text but anchors the quote verbatim (spaces included)", async () => {
    const { api, store } = makeApi();
    const created = (await api.create(NOTE, { text: "  padded  ", quote: "lazy dog" })) as Result;
    expect(created.status).toBe(201);
    expect(created.body.body).toBe("padded");
    // Quote with surrounding whitespace still anchors exact bytes.
    const spaced = (await api.create(NOTE, { text: "x", quote: "over the lazy dog." })) as Result;
    expect(spaced.status).toBe(201);
    expect(store.all()).toHaveLength(2);
  });

  it("rejects malformed color and style with distinct messages", async () => {
    const { api } = makeApi();
    const badColor = (await api.create(NOTE, { text: "x", quote: "lazy dog", color: "#12345" })) as Result;
    expect(badColor.status).toBe(400);
    expect(String(badColor.body.message)).toMatch(/hex/i);
    const badStyle = (await api.create(NOTE, { text: "x", quote: "lazy dog", style: "rainbow" })) as Result;
    expect(badStyle.status).toBe(400);
    expect(String(badStyle.body.message)).toContain("highlight");
  });

  it("accepts 3-digit hex colors", async () => {
    const { api } = makeApi();
    const result = (await api.create(NOTE, { text: "x", quote: "lazy dog", color: "#F0A" })) as Result;
    expect(result.status).toBe(201);
    expect(result.body.color).toBe("#F0A");
  });
});

describe("api protocol / patch semantics", () => {
  async function created(api: AnnotationsApi): Promise<string> {
    const result = (await api.create(NOTE, { text: "note body", quote: "lazy dog" })) as Result;
    return result.body.id as string;
  }

  it("enforces expected_text only together with text", async () => {
    const { api } = makeApi();
    const id = await created(api);
    // A stale expected_text alone does NOT block unrelated field updates.
    const colorOnly = (await api.patch(NOTE, id, { color: "#ffcc00", expected_text: "wrong" })) as Result;
    expect(colorOnly.status).toBe(200);
    // With a text write, the same stale lock becomes a 409.
    const locked = (await api.patch(NOTE, id, { text: "new", expected_text: "wrong" })) as Result;
    expect(locked.status).toBe(409);
    expect(locked.body.errorCode).toBe(40903);
  });

  it("read lifecycle: true stamps, false clears, non-boolean is ignored", async () => {
    const { api } = makeApi();
    const id = await created(api);
    const marked = (await api.patch(NOTE, id, { read: true })) as Result;
    expect(typeof marked.body.readAt).toBe("string");
    const cleared = (await api.patch(NOTE, id, { read: false })) as Result;
    expect(cleared.body.readAt).toBeNull();
    // A non-boolean read is not a change: nothing to update.
    const ignored = (await api.patch(NOTE, id, { read: "yes" })) as Result;
    expect(ignored.status).toBe(400);
  });

  it("reports 'nothing to update' when no recognized field changed", async () => {
    const { api } = makeApi();
    const id = await created(api);
    const result = (await api.patch(NOTE, id, { bogus: true })) as Result;
    expect(result.status).toBe(400);
    expect(String(result.body.message)).toMatch(/nothing to update/i);
  });

  it("resolved true/false maps to status; unknown annotation 40401", async () => {
    const { api } = makeApi();
    const id = await created(api);
    expect(((await api.patch(NOTE, id, { resolved: true })) as Result).body.status).toBe("resolved");
    expect(((await api.patch(NOTE, id, { resolved: false })) as Result).body.status).toBe("open");
    const ghost = (await api.patch(NOTE, "00000000-0000-0000-0000-000000000000", { text: "x" })) as Result;
    expect(ghost.status).toBe(404);
    expect(ghost.body.errorCode).toBe(40401);
  });

  it("reply writes validate text and existence", async () => {
    const { api } = makeApi();
    const id = await created(api);
    const added = (await api.addReply(NOTE, id, { text: "reply text", author: "Pi" })) as Result;
    expect(added.status).toBe(201);
    const replyId = ((added.body.replies as Array<{ id: string }>)[0]).id;
    expect(((await api.addReply(NOTE, id, { text: "  " })) as Result).status).toBe(400);
    const ghostReply = (await api.updateReply(NOTE, id, "ghost", { text: "x" })) as Result;
    expect(ghostReply.body.errorCode).toBe(40404);
    const updated = (await api.updateReply(NOTE, id, replyId, { text: "edited", author: "Claude" })) as Result;
    const reply = (updated.body.replies as Array<{ id: string; body: string; author: string }>)[0];
    expect(reply.body).toBe("edited");
    expect(reply.author).toBe("Claude");
    const removed = (await api.removeReply(NOTE, id, replyId)) as Result;
    expect((removed.body.replies as unknown[])).toHaveLength(0);
    expect(((await api.removeReply(NOTE, id, replyId)) as Result).body.errorCode).toBe(40404);
  });

  it("remove deletes the thread and echoes the trash path", async () => {
    const { api } = makeApi();
    const id = await created(api);
    const removed = (await api.remove(NOTE, id)) as Result;
    expect(removed.status).toBe(200);
    expect(removed.body.deleted).toBe(true);
    expect(String(removed.body.trash)).toContain(".marginalia-bona/trash/");
    expect((api.get(NOTE, id) as Result).status).toBe(404);
  });
});

describe("api protocol / list semantics", () => {
  async function seed(api: AnnotationsApi): Promise<void> {
    await api.create(NOTE, { text: "one", quote: "lazy dog", author: "Pi" });
    await api.create(OTHER, { text: "two", quote: "lazy dog passage", author: "user" });
    await api.create(OTHER, { text: "three", quote: "sits here" });
  }

  it("caps limit at 200 and reports the uncapped total", async () => {
    const { api } = makeApi();
    await seed(api);
    for (const raw of ["0", "-5", "abc", "1000"]) {
      const result = (await Promise.resolve(api.list(undefined, { limit: raw }))) as Result;
      expect(result.body.total).toBe(3);
      expect((result.body.threads as unknown[]).length).toBeLessThanOrEqual(3);
    }
    const one = api.list(undefined, { limit: "1" }) as Result;
    expect((one.body.threads as unknown[])).toHaveLength(1);
    expect(one.body.total).toBe(3);
  });

  it("validates status; keeps legacy aliases; read must be exactly true/false", () => {
    const { api } = makeApi();
    expect(((api.list(undefined, { status: "banana" }) as Result).status)).toBe(400);
    expect((api.list(undefined, { status: "all" }) as Result).status).toBe(200);
    expect((api.list(undefined, { status: "drifted" }) as Result).status).toBe(200);
    expect((api.list(undefined, { status: "unread" }) as Result).status).toBe(200);
    expect((api.list(undefined, { read: "yes" }) as Result).status).toBe(200); // ignored, not filtered
  });

  it("whole-vault queries include every source; note-scoped include only that note", async () => {
    const { api } = makeApi();
    await seed(api);
    expect(((api.list(undefined, {}) as Result).body.total)).toBe(3);
    expect(((api.list(NOTE, {}) as Result).body.total)).toBe(1);
    const missing = api.list("Notes/Ghost.md", {}) as Result;
    expect(missing.status).toBe(404);
    expect(missing.body.errorCode).toBe(40402);
  });

  it("q reaches replies and quote text, not just bodies", async () => {
    const { api, store } = makeApi();
    await seed(api);
    const created = (await api.create(NOTE, { text: "shell", quote: "over the lazy dog" })) as Result;
    await api.addReply(NOTE, created.body.id as string, { text: "mentions foxes in passing" });
    expect(((api.list(undefined, { q: "foxes in passing" }) as Result).body.total)).toBe(1);
    expect(((api.list(undefined, { q: "sits here" }) as Result).body.total)).toBe(1);
    expect(store.query({ q: "SITS HERE" })).toHaveLength(1); // case-insensitive
  });

  it("reanchor: locks, ambiguity, and idempotent same-quote re-anchor", async () => {
    const { api } = makeApi();
    const id = ((await api.create(NOTE, { text: "x", quote: "lazy dog" })) as Result).body.id as string;
    const locked = (await api.reanchor(NOTE, id, { quote: "quick brown fox", expected_quote: "wrong" })) as Result;
    expect(locked.status).toBe(409);
    expect(locked.body.errorCode).toBe(40903);
    const ambiguous = (await api.reanchor(NOTE, id, { quote: "quick brown fox" })) as Result;
    expect(ambiguous.status).toBe(409);
    const same = (await api.reanchor(NOTE, id, { quote: "lazy dog" })) as Result;
    expect(same.status).toBe(200);
    const ghost = (await api.reanchor(NOTE, "00000000-0000-0000-0000-000000000000", { quote: "lazy dog" })) as Result;
    expect(ghost.status).toBe(404);
  });
});
