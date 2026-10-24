import { beforeEach, describe, expect, it } from "vitest";

import { AnnotationStore } from "../src/storage/annotation-store";
import { MemoryAdapter } from "./memory-adapter";
import { TFile } from "./obsidian-runtime-mock";
import { AnnotationsApi } from "../src/rest-bridge/annotations-api";
import type MarginaliaPlugin from "../src/main";

const NOTE = "Notes/Test.md";
const NOTE_TEXT =
  "The quick brown fox jumps over the lazy dog.\nSecond line with quick brown fox again.";

function makeApi(): { api: AnnotationsApi; store: AnnotationStore } {
  const adapter = new MemoryAdapter();
  const store = new AnnotationStore({ vault: { adapter } } as never);
  const plugin = {
    app: {
      vault: {
        adapter,
        getAbstractFileByPath: (path: string) => {
          if (path !== NOTE) return null;
          const file = new TFile();
          file.path = path;
          file.extension = "md";
          return file;
        },
        cachedRead: async () => NOTE_TEXT
      }
    },
    store
  };
  return {
    store,
    api: new AnnotationsApi(plugin as unknown as MarginaliaPlugin)
  };
}

describe("annotations REST handlers", () => {
  let api: AnnotationsApi;

  beforeEach(() => {
    ({ api } = makeApi());
  });

  it("creates an annotation anchored to the quoted passage", async () => {
    const result = await api.create(NOTE, {
      text: "Check this fox.",
      quote: "quick brown fox jumps"
    });
    expect(result.status).toBe(201);
    const body = result.body as {
      status: string;
      author: string;
      drifted: boolean;
      anchor: { quote: { exact: string }; line: number };
    };
    expect(body.status).toBe("open");
    expect(body.author).toBe("Agent");
    expect(body.drifted).toBe(false);
    expect(body.anchor.quote.exact).toBe("quick brown fox jumps");
    expect(body.anchor.line).toBe(1);
  });

  it("rejects an ambiguous quote with 409 unless occurrence is given", async () => {
    const ambiguous = await api.create(NOTE, {
      text: "Which fox?",
      quote: "quick brown fox"
    });
    expect(ambiguous.status).toBe(409);
    const second = await api.create(NOTE, {
      text: "The second fox.",
      quote: "quick brown fox",
      occurrence: 2
    });
    expect(second.status).toBe(201);
  });

  it("returns 404 for missing quotes and missing notes", async () => {
    expect((await api.create(NOTE, { text: "x", quote: "nope" })).status).toBe(
      404
    );
    expect(
      (await api.create("Missing.md", { text: "x", quote: "nope" })).status
    ).toBe(404);
  });

  it("adds replies with the given author", async () => {
    const created = (await api.create(NOTE, {
      text: "Root.",
      quote: "quick brown fox jumps"
    })) as { status: number; body: { id: string } };
    const reply = (await api.addReply(NOTE, created.body.id, {
      text: "A reply.",
      author: "Pi"
    })) as {
      status: number;
      body: { replies: Array<{ author: string; body: string }> };
    };
    expect(reply.status).toBe(201);
    expect(reply.body.replies).toHaveLength(1);
    expect(reply.body.replies[0].author).toBe("Pi");
  });

  it("patches text with optimistic locking and toggles resolved", async () => {
    const created = (await api.create(NOTE, {
      text: "Original.",
      quote: "quick brown fox jumps"
    })) as { status: number; body: { id: string } };
    const id = created.body.id;

    const mismatch = await api.patch(NOTE, id, {
      text: "New.",
      expected_text: "something else"
    });
    expect(mismatch.status).toBe(409);

    const resolved = await api.patch(NOTE, id, { resolved: true });
    expect((resolved.body as { status: string }).status).toBe("resolved");

    const reopened = await api.patch(NOTE, id, { resolved: false });
    expect((reopened.body as { status: string }).status).toBe("open");
  });

  it("deletes a thread and reports 404 for unknown ids", async () => {
    const created = (await api.create(NOTE, {
      text: "Delete me.",
      quote: "quick brown fox jumps"
    })) as { status: number; body: { id: string } };
    const id = created.body.id;
    const removed = await api.remove(NOTE, id);
    expect(removed.status).toBe(200);
    expect(api.get(NOTE, id).status).toBe(404);
  });

  it("lists threads and filters by drifted", async () => {
    await api.createFromText(NOTE, NOTE_TEXT, {
      text: "Will drift.",
      quote: "quick brown fox jumps",
      occurrence: 1,
      author: "Agent"
    });
    const all = api.list(NOTE, {}) as {
      body: { threads: Array<{ drifted: boolean }> };
    };
    expect(all.body.threads).toHaveLength(1);
    // Simulate a passage edit: the drift flag flips without any status change.
    const drifted = api.list(NOTE, { status: "drifted" }) as {
      body: { threads: unknown[] };
    };
    expect(drifted.body.threads).toHaveLength(0);
  });
});
