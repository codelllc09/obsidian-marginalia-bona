import { describe, expect, it } from "vitest";
import { AnnotationStore } from "../src/storage/annotation-store";
import {
  parseAnnotation,
  serializeAnnotation
} from "../src/storage/annotation-markdown";
import { AnnotationsApi } from "../src/rest-bridge/annotations-api";
import { buildAnchor } from "../src/rest-bridge/anchor";
import { markdownExportFormat } from "../src/export/markdown-format";
import { MemoryAdapter } from "./memory-adapter";
import { TFile } from "./obsidian-runtime-mock";
import type { Annotation } from "../src/domain/annotation";
import type MarginaliaPlugin from "../src/main";

const NOTE = "Notes/Thread.md";
const NOTE_TEXT = "The quick brown fox jumps over the lazy dog.";

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    schemaVersion: 1,
    id: "11111111-2222-3333-4444-555555555555",
    sourcePath: NOTE,
    sourceType: "markdown",
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    body: "Root",
    anchor: buildAnchor(NOTE_TEXT, "lazy dog", NOTE_TEXT.indexOf("lazy dog")),
    replies: [],
    ...overrides
  };
}

function makeApi() {
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
    adapter,
    store,
    api: new AnnotationsApi(plugin as unknown as MarginaliaPlugin)
  };
}

type Result = { status: number; body: Record<string, unknown> };

describe("nested replies / file format", () => {
  it("round-trips parentId through serialize/parse", () => {
    const original = annotation({
      replies: [
        {
          id: "r1",
          createdAt: "2026-01-02T00:00:00.000Z",
          author: "Pi",
          body: "top level"
        },
        {
          id: "r2",
          createdAt: "2026-01-02T01:00:00.000Z",
          author: "user",
          parentId: "r1",
          body: "answer to r1"
        },
        {
          id: "r3",
          createdAt: "2026-01-02T02:00:00.000Z",
          parentId: "r2",
          body: "answer to r2"
        }
      ]
    });
    const parsed = parseAnnotation(serializeAnnotation(original));
    expect(parsed.replies.map((reply) => reply.parentId)).toEqual([
      undefined,
      "r1",
      "r2"
    ]);
    expect(parsed.replies[1].body).toBe("answer to r1");
  });

  it("keeps a reply body that mentions reply-to later in the text", () => {
    const original = annotation({
      replies: [
        {
          id: "r1",
          createdAt: "2026-01-02T00:00:00.000Z",
          body: "Quoting the marker:\n<!-- reply-to: ghost -->\nnot a parent"
        }
      ]
    });
    const parsed = parseAnnotation(serializeAnnotation(original));
    expect(parsed.replies[0].parentId).toBeUndefined();
    expect(parsed.replies[0].body).toContain("<!-- reply-to: ghost -->");
  });

});

describe("nested replies / store", () => {
  async function seeded() {
    const ctx = makeApi();
    const created = (await ctx.api.create(NOTE, {
      text: "root",
      quote: "lazy dog"
    })) as Result;
    return { ...ctx, id: created.body.id as string };
  }

  it("records the parent when answering a reply", async () => {
    const { store, id } = await seeded();
    const first = await store.addReply(id, "first", "Pi");
    const parentId = first.replies[0].id;
    const second = await store.addReply(id, "second", "user", parentId);
    expect(second.replies[1].parentId).toBe(parentId);
  });

  it("refuses a parent that does not exist", async () => {
    const { store, id } = await seeded();
    await expect(
      store.addReply(id, "orphan answer", "Pi", "ghost")
    ).rejects.toThrow(/Unknown reply/);
    expect(store.get(id)?.replies).toHaveLength(0);
  });

  it("re-attaches children to the grandparent when a reply is deleted", async () => {
    const { store, id } = await seeded();
    const root = await store.addReply(id, "root reply", "Pi");
    const rootId = root.replies[0].id;
    const middle = await store.addReply(id, "middle", "user", rootId);
    const middleId = middle.replies[1].id;
    await store.addReply(id, "leaf", "Pi", middleId);

    const after = await store.deleteReply(id, middleId);
    expect(after.replies.map((reply) => reply.body)).toEqual([
      "root reply",
      "leaf"
    ]);
    expect(after.replies[1].parentId).toBe(rootId);
  });

  it("promotes children to the top level when the deleted reply was top-level", async () => {
    const { store, id } = await seeded();
    const parent = await store.addReply(id, "parent", "Pi");
    const parentId = parent.replies[0].id;
    await store.addReply(id, "child", "user", parentId);

    const after = await store.deleteReply(id, parentId);
    expect(after.replies).toHaveLength(1);
    expect(after.replies[0].body).toBe("child");
    expect("parentId" in after.replies[0]).toBe(false);
  });
});

describe("nested replies / api", () => {
  it("accepts parent_id and echoes parentId in the payload", async () => {
    const { api } = makeApi();
    const created = (await api.create(NOTE, {
      text: "root",
      quote: "lazy dog"
    })) as Result;
    const id = created.body.id as string;
    const first = (await api.addReply(NOTE, id, {
      text: "top",
      author: "Pi"
    })) as Result;
    const firstId = (first.body.replies as Array<{ id: string }>)[0].id;
    const nested = (await api.addReply(NOTE, id, {
      text: "nested",
      author: "user",
      parent_id: firstId
    })) as Result;
    expect(nested.status).toBe(201);
    const replies = nested.body.replies as Array<{
      id: string;
      parentId: string | null;
    }>;
    expect(replies[1].parentId).toBe(firstId);
    expect(replies[0].parentId).toBeNull();
  });

  it("refuses an unknown parent with 40404 and adds nothing", async () => {
    const { api } = makeApi();
    const created = (await api.create(NOTE, {
      text: "root",
      quote: "lazy dog"
    })) as Result;
    const id = created.body.id as string;
    const refused = (await api.addReply(NOTE, id, {
      text: "nested",
      parent_id: "ghost"
    })) as Result;
    expect(refused.status).toBe(404);
    expect(refused.body.errorCode).toBe(40404);
    const after = api.get(NOTE, id) as Result;
    expect((after.body.replies as unknown[])).toHaveLength(0);
  });
});

describe("nested replies / export", () => {
  it("marks nested replies with an arrow in the Markdown export", () => {
    const text = markdownExportFormat.render(
      [
        annotation({
          replies: [
            { id: "r1", createdAt: "2026-01-02T00:00:00.000Z", body: "top" },
            {
              id: "r2",
              createdAt: "2026-01-02T01:00:00.000Z",
              parentId: "r1",
              body: "nested"
            }
          ]
        })
      ],
      { sourcePath: NOTE, exportedAt: "2026-02-01T00:00:00.000Z" }
    );
    expect(text).toContain("> **user**");
    expect(text).toContain("↳");
  });
});
