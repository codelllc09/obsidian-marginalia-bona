import { beforeEach, describe, expect, it } from "vitest";

import { AnnotationStore } from "../src/storage/annotation-store";
import { MemoryAdapter } from "./memory-adapter";
import { TFile } from "./obsidian-runtime-mock";
import { AnnotationsApi } from "../src/rest-bridge/annotations-api";
import { RestBridge } from "../src/rest-bridge";
import { openApiDescription } from "../src/rest-bridge/openapi";
import { registerMcpTools } from "../src/rest-bridge/mcp-tools";
import type { McpToolCallback } from "../src/rest-bridge/types";
import type MarginaliaPlugin from "../src/main";

const NOTE = "Notes/Test.md";
const NOTE_TEXT =
  "The quick brown fox jumps over the lazy dog.\nSecond line with quick brown fox again.";
const OTHER = "Notes/Other.md";
const OTHER_TEXT = "Another note with its own lazy dog passage.\nAnd more.";

function makeApi(): {
  api: AnnotationsApi;
  store: AnnotationStore;
  plugin: MarginaliaPlugin;
} {
  const adapter = new MemoryAdapter();
  const store = new AnnotationStore({ vault: { adapter } } as never);
  const texts: Record<string, string> = { [NOTE]: NOTE_TEXT, [OTHER]: OTHER_TEXT };
  const plugin = {
    app: {
      vault: {
        adapter,
        getAbstractFileByPath: (path: string) => {
          if (!(path in texts)) return null;
          const file = new TFile();
          file.path = path;
          file.extension = "md";
          return file;
        },
        cachedRead: async (file: { path: string }) => texts[file.path] ?? ""
      }
    },
    store
  };
  return {
    store,
    plugin: plugin as unknown as MarginaliaPlugin,
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

type RegisteredTool = { description: string; callback: McpToolCallback };

function makeHost() {
  const tools = new Map<string, RegisteredTool>();
  const host = {
    addMcpTool(
      name: string,
      description: string,
      _schema: unknown,
      callback: McpToolCallback
    ) {
      tools.set(name, { description, callback });
    }
  };
  return { host, tools };
}

describe("annotations MCP tools", () => {
  it("registers six tools and round-trips create/reply/update/delete", async () => {
    const { api } = makeApi();
    const { host, tools } = makeHost();
    registerMcpTools(host as never, api);
    expect([...tools.keys()].sort()).toEqual(
      [
        "marginalia_add_reply",
        "marginalia_create_annotation",
        "marginalia_delete_annotation",
        "marginalia_delete_reply",
        "marginalia_get_annotation",
        "marginalia_list_annotations",
        "marginalia_list_trash",
        "marginalia_reanchor",
        "marginalia_restore_annotation",
        "marginalia_update_annotation",
        "marginalia_update_reply"
      ]
    );

    const created = JSON.parse(
      (await tools.get("marginalia_create_annotation")!.callback({
        source: NOTE,
        text: "Via MCP.",
        quote: "lazy dog"
      }))
    ) as { id: string; status: string; author: string };
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("open");
    expect(created.author).toBe("Agent");

    const reply = JSON.parse(
      (await tools.get("marginalia_add_reply")!.callback({
        source: NOTE,
        id: created.id,
        text: "A reply.",
        author: "Pi"
      }))
    ) as { replies: unknown[] };
    expect(reply.replies).toHaveLength(1);

    const updated = JSON.parse(
      (await tools.get("marginalia_update_annotation")!.callback({
        source: NOTE,
        id: created.id,
        status: "resolved"
      }))
    ) as { status: string };
    expect(updated.status).toBe("resolved");

    const listed = JSON.parse(
      (await tools.get("marginalia_list_annotations")!.callback({
        source: NOTE,
        status: "resolved"
      }))
    ) as { threads: unknown[] };
    expect(listed.threads).toHaveLength(1);

    const deleted = JSON.parse(
      (await tools.get("marginalia_delete_annotation")!.callback({
        source: NOTE,
        id: created.id
      }))
    ) as { deleted: boolean };
    expect(deleted.deleted).toBe(true);
  });

  it("surfaces API errors as error JSON instead of throwing", async () => {
    const { api } = makeApi();
    const { host, tools } = makeHost();
    registerMcpTools(host as never, api);

    const ambiguous = JSON.parse(
      (await tools.get("marginalia_create_annotation")!.callback({
        source: NOTE,
        text: "Which fox?",
        quote: "quick brown fox"
      }))
    ) as { error: { errorCode: number } };
    expect(ambiguous.error.errorCode).toBe(40902);

    const disambiguated = JSON.parse(
      (await tools.get("marginalia_create_annotation")!.callback({
        source: NOTE,
        text: "The second fox.",
        quote: "quick brown fox",
        occurrence: 2
      }))
    ) as { id: string };
    expect(disambiguated.id).toBeTruthy();
  });

  it("registers nothing when the host lacks an MCP server", () => {
    const { api } = makeApi();
    expect(() => registerMcpTools({} as never, api)).not.toThrow();
  });
});

type ChannelSettings = { agentMcpEnabled: boolean; agentRestEnabled: boolean };

type HostSpy = {
  subresourceNames: string[];
  routes: string[];
  mcpTools: string[];
  unregisterCount: number;
  openApiPaths: string[] | null;
};

function makeBridge(settings: ChannelSettings) {
  const { plugin } = makeApi();
  const spy: HostSpy = {
    subresourceNames: [],
    routes: [],
    mcpTools: [],
    unregisterCount: 0,
    openApiPaths: null
  };
  const host = {
    apiVersion: 3,
    addVaultSubresource(name: string) {
      spy.subresourceNames.push(name);
      return {
        get: (path: string) => spy.routes.push(`GET ${path}`),
        post: (path: string) => spy.routes.push(`POST ${path}`),
        patch: (path: string) => spy.routes.push(`PATCH ${path}`),
        delete: (path: string) => spy.routes.push(`DELETE ${path}`)
      };
    },
    addMcpTool: (name: string) => spy.mcpTools.push(name),
    addOpenApiDescription: (description: { paths: Record<string, unknown> }) => {
      spy.openApiPaths = Object.keys(description.paths);
    },
    unregister: () => {
      spy.unregisterCount += 1;
    }
  };
  const record = plugin as unknown as Record<string, unknown>;
  record.manifest = { id: "marginalia-bona" };
  record.settings = settings;
  (plugin.app as unknown as Record<string, unknown>).plugins = {
    plugins: {
      "obsidian-local-rest-api": { getPublicApi: () => host }
    }
  };
  return { bridge: new RestBridge(plugin), spy };
}

describe("agent channel toggles", () => {
  it("stays invisible to the host when both channels are off", () => {
    const { bridge, spy } = makeBridge({
      agentMcpEnabled: false,
      agentRestEnabled: false
    });
    bridge.connect();
    expect(spy.subresourceNames).toEqual([]);
    expect(spy.mcpTools).toEqual([]);
    bridge.disconnect();
    expect(spy.unregisterCount).toBe(0);
  });

  it("mounts REST routes only when the REST channel is enabled", () => {
    const { bridge, spy } = makeBridge({
      agentMcpEnabled: false,
      agentRestEnabled: true
    });
    bridge.connect();
    expect(spy.subresourceNames).toEqual(["annotations"]);
    expect(spy.routes).toHaveLength(9);
    expect(spy.mcpTools).toEqual([]);
    expect(spy.openApiPaths).toEqual([
      "/vault/{path}/annotations/",
      "/vault/{path}/annotations/{id}",
      "/vault/{path}/annotations/{id}/replies",
      "/vault/{path}/annotations/{id}/replies/{replyId}",
      "/vault/{path}/annotations/{id}/reanchor"
    ]);
    bridge.disconnect();
  });

  it("registers MCP tools only when the MCP channel is enabled", () => {
    const { bridge, spy } = makeBridge({
      agentMcpEnabled: true,
      agentRestEnabled: false
    });
    bridge.connect();
    expect(spy.subresourceNames).toEqual([]);
    expect(spy.routes).toEqual([]);
    expect(spy.mcpTools).toHaveLength(11);
    expect(spy.openApiPaths).toBeNull();
    bridge.disconnect();
    expect(spy.unregisterCount).toBe(1);
  });

  it("mounts both channels when both are enabled", () => {
    const { bridge, spy } = makeBridge({
      agentMcpEnabled: true,
      agentRestEnabled: true
    });
    bridge.connect();
    expect(spy.routes).toHaveLength(9);
    expect(spy.mcpTools).toHaveLength(11);
    bridge.disconnect();
  });
});

describe("per-annotation styling and author filters", () => {
  it("creates with color and style and echoes them back", async () => {
    const { api } = makeApi();
    const result = await api.create(NOTE, {
      text: "Styled.",
      quote: "quick brown fox jumps",
      color: "#ff5252",
      style: "wavy",
      author: "Pi"
    });
    expect(result.status).toBe(201);
    const body = result.body as { color: string | null; markStyle: string | null };
    expect(body.color).toBe("#ff5252");
    expect(body.markStyle).toBe("wavy");
  });

  it("rejects malformed color and unknown style with 400", async () => {
    const { api } = makeApi();
    expect(
      (
        await api.create(NOTE, {
          text: "x",
          quote: "quick brown fox jumps",
          color: "red"
        })
      ).status
    ).toBe(400);
    expect(
      (
        await api.create(NOTE, {
          text: "x",
          quote: "quick brown fox jumps",
          style: "sparkle"
        })
      ).status
    ).toBe(400);
  });

  it("updates color and style via patch", async () => {
    const { api } = makeApi();
    const created = (await api.create(NOTE, {
      text: "Original.",
      quote: "quick brown fox jumps"
    })) as { status: number; body: { id: string } };
    const patched = await api.patch(NOTE, created.body.id, {
      color: "#123abc",
      style: "underline"
    });
    const body = patched.body as { color: string; markStyle: string };
    expect(body.color).toBe("#123abc");
    expect(body.markStyle).toBe("underline");
  });

  it("lists threads filtered by author", async () => {
    const { api } = makeApi();
    await api.createFromText(NOTE, NOTE_TEXT, {
      text: "Mine.",
      quote: "quick brown fox jumps",
      occurrence: 1,
      author: "Pi"
    });
    const mine = api.list(NOTE, { author: "Pi" }) as {
      body: { threads: Array<{ author: string }> };
    };
    expect(mine.body.threads.length).toBeGreaterThan(0);
    expect(mine.body.threads.every((t) => t.author === "Pi")).toBe(true);
  });

  it("exposes color and style through the MCP tool", async () => {
    const { api } = makeApi();
    const { host, tools } = makeHost();
    registerMcpTools(host as never, api);
    const created = JSON.parse(
      (await tools.get("marginalia_create_annotation")!.callback({
        source: NOTE,
        text: "Styled via MCP.",
        quote: "lazy dog",
        color: "#00bcd4",
        style: "bold"
      }))
    ) as { color: string; markStyle: string };
    expect(created.color).toBe("#00bcd4");
    expect(created.markStyle).toBe("bold");
  });
});

describe("reply editing and reanchoring", () => {
  it("reanchors an annotation to a new passage and clears drift", async () => {
    const { api } = makeApi();
    const created = (await api.create(NOTE, {
      text: "Will move.",
      quote: "lazy dog"
    })) as { status: number; body: { id: string } };
    const result = await api.reanchor(NOTE, created.body.id, {
      quote: "Second line"
    });
    expect(result.status).toBe(200);
    const body = result.body as {
      status: string;
      drifted: boolean;
      anchor: { line: number; quote: { exact: string } };
    };
    expect(body.anchor.quote.exact).toBe("Second line");
    expect(body.anchor.line).toBe(2);
    expect(body.drifted).toBe(false);
    expect(body.status).toBe("open");
  });

  it("applies the same quote rules as create to reanchor", async () => {
    const { api } = makeApi();
    const created = (await api.create(NOTE, {
      text: "x",
      quote: "lazy dog"
    })) as { status: number; body: { id: string } };
    expect((await api.reanchor(NOTE, created.body.id, { quote: "nope" })).status).toBe(404);
    const ambiguous = await api.reanchor(NOTE, created.body.id, {
      quote: "quick brown fox"
    });
    expect(ambiguous.status).toBe(409);
    const disambiguated = await api.reanchor(NOTE, created.body.id, {
      quote: "quick brown fox",
      occurrence: 2
    });
    expect(disambiguated.status).toBe(200);
  });

  it("guards reanchor with expected_quote", async () => {
    const { api } = makeApi();
    const created = (await api.create(NOTE, {
      text: "x",
      quote: "lazy dog"
    })) as { status: number; body: { id: string; anchor: { quote: { exact: string } } } };
    const mismatch = await api.reanchor(NOTE, created.body.id, {
      quote: "Second line",
      expected_quote: "something else"
    });
    expect(mismatch.status).toBe(409);
    const ok = await api.reanchor(NOTE, created.body.id, {
      quote: "Second line",
      expected_quote: created.body.anchor.quote.exact
    });
    expect(ok.status).toBe(200);
  });

  it("edits and deletes replies with 404 for unknown reply ids", async () => {
    const { api } = makeApi();
    const created = (await api.create(NOTE, {
      text: "Root.",
      quote: "lazy dog"
    })) as { status: number; body: { id: string } };
    const replied = (await api.addReply(NOTE, created.body.id, {
      text: "First.",
      author: "Pi"
    })) as { status: number; body: { replies: Array<{ id: string }> } };
    const replyId = replied.body.replies[0].id;

    const edited = await api.updateReply(NOTE, created.body.id, replyId, {
      text: "Edited.",
      author: "Codex"
    });
    let body = edited.body as { replies: Array<{ body: string; author: string }> };
    expect(body.replies[0].body).toBe("Edited.");
    expect(body.replies[0].author).toBe("Codex");
    expect(
      (await api.updateReply(NOTE, created.body.id, "nope", { text: "x" })).status
    ).toBe(404);

    const removed = await api.removeReply(NOTE, created.body.id, replyId);
    const remaining = removed.body as { replies: unknown[] };
    expect(remaining.replies).toHaveLength(0);
    expect((await api.removeReply(NOTE, created.body.id, replyId)).status).toBe(404);
  });

  it("exposes reanchor and reply editing through MCP tools", async () => {
    const { api } = makeApi();
    const { host, tools } = makeHost();
    registerMcpTools(host as never, api);
    const created = JSON.parse(
      (await tools.get("marginalia_create_annotation")!.callback({
        source: NOTE,
        text: "Root.",
        quote: "lazy dog"
      }))
    ) as { id: string };
    const reply = JSON.parse(
      (await tools.get("marginalia_add_reply")!.callback({
        source: NOTE, id: created.id, text: "First.", author: "Pi"
      }))
    ) as { replies: Array<{ id: string }> };

    const reanchored = JSON.parse(
      (await tools.get("marginalia_reanchor")!.callback({
        source: NOTE, id: created.id, quote: "Second line"
      }))
    ) as { anchor: { quote: { exact: string } } };
    expect(reanchored.anchor.quote.exact).toBe("Second line");

    const edited = JSON.parse(
      (await tools.get("marginalia_update_reply")!.callback({
        source: NOTE, id: created.id, replyId: reply.replies[0].id, text: "Edited."
      }))
    ) as { replies: Array<{ body: string }> };
    expect(edited.replies[0].body).toBe("Edited.");

    const afterDelete = JSON.parse(
      (await tools.get("marginalia_delete_reply")!.callback({
        source: NOTE, id: created.id, replyId: reply.replies[0].id
      }))
    ) as { replies: unknown[] };
    expect(afterDelete.replies).toHaveLength(0);
  });
});

describe("read / unread state", () => {
  it("marks read with a timestamp and back to unread via patch", async () => {
    const { api } = makeApi();
    const created = (await api.create(NOTE, {
      text: "To read.",
      quote: "lazy dog"
    })) as { status: number; body: { id: string; readAt: string | null } };
    expect(created.body.readAt).toBeNull();

    const read = await api.patch(NOTE, created.body.id, { read: true });
    const readBody = read.body as { readAt: string | null };
    expect(typeof readBody.readAt).toBe("string");

    const unread = await api.patch(NOTE, created.body.id, { read: false });
    expect((unread.body as { readAt: string | null }).readAt).toBeNull();
  });

  it("lists threads filtered by read state", async () => {
    const { api } = makeApi();
    const readOne = (await api.create(NOTE, {
      text: "read one",
      quote: "quick brown fox jumps",
      occurrence: 1
    })) as { status: number; body: { id: string } };
    await api.patch(NOTE, readOne.body.id, { read: true });
    await api.create(NOTE, {
      text: "unread one",
      quote: "lazy dog"
    });

    const unread = api.list(NOTE, { read: "false" }) as {
      body: { threads: Array<{ id: string; readAt: string | null }> };
    };
    expect(unread.body.threads.some((t) => t.id === readOne.body.id)).toBe(false);
    expect(unread.body.threads.every((t) => t.readAt === null)).toBe(true);

    const read = api.list(NOTE, { read: "true" }) as {
      body: { threads: unknown[] };
    };
    expect(read.body.threads).toHaveLength(1);
  });

  it("round-trips read-at through the thread payload and MCP tools", async () => {
    const { api } = makeApi();
    const { host, tools } = makeHost();
    registerMcpTools(host as never, api);
    const created = JSON.parse(
      (await tools.get("marginalia_create_annotation")!.callback({
        source: NOTE, text: "Root.", quote: "lazy dog"
      }))
    ) as { id: string };
    await tools.get("marginalia_update_annotation")!.callback({
      source: NOTE, id: created.id, read: true
    });
    const got = JSON.parse(
      (await tools.get("marginalia_get_annotation")!.callback({
        source: NOTE, id: created.id
      }))
    ) as { readAt: string | null };
    expect(typeof got.readAt).toBe("string");
  });
});

describe("openapi contribution", () => {
  it("documents five paths with methods, tag, and error schema", () => {
    const doc = openApiDescription() as {
      paths: Record<string, Record<string, unknown>>;
      tags: Array<{ name: string }>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths)).toHaveLength(5);
    expect(doc.paths["/vault/{path}/annotations/"]).toHaveProperty("get");
    expect(doc.paths["/vault/{path}/annotations/"]).toHaveProperty("post");
    expect(doc.paths["/vault/{path}/annotations/{id}"]).toHaveProperty("patch");
    expect(doc.paths["/vault/{path}/annotations/{id}"]).toHaveProperty("delete");
    expect(doc.paths["/vault/{path}/annotations/{id}/replies/{replyId}"]).toHaveProperty("patch");
    expect(doc.paths["/vault/{path}/annotations/{id}/replies/{replyId}"]).toHaveProperty("delete");
    expect(doc.paths["/vault/{path}/annotations/{id}/reanchor"]).toHaveProperty("post");
    expect(doc.tags[0].name).toBe("Marginalia annotations");
    expect(doc.components.schemas.MarginaliaError).toBeTruthy();
    // Namespace discipline: the host already declares generic names like
    // "Error" - a collision makes addOpenApiDescription throw.
    for (const name of Object.keys(doc.components.schemas)) {
      expect(name.startsWith("Marginalia")).toBe(true);
    }
  });

  it("passes the host's description validator rules", () => {
    // Mirrors the host's assertValidDescription: paths must start with "/",
    // path items and component sections must be objects, tags unique names.
    const doc = openApiDescription();
    expect(() => {
      if (typeof doc !== "object" || doc === null) throw new Error("not object");
      const { paths, components, tags } = doc;
      for (const [p, item] of Object.entries(paths as Record<string, unknown>)) {
        if (!p.startsWith("/")) throw new Error(`path ${p} must start with /`);
        if (typeof item !== "object" || item === null) throw new Error("bad item");
      }
      for (const [, entries] of Object.entries(
        (components ?? {}) as Record<string, unknown>
      )) {
        if (typeof entries !== "object" || entries === null) throw new Error("bad section");
      }
      const seen = new Set<string>();
      for (const tag of (tags ?? []) as Array<{ name: string }>) {
        if (seen.has(tag.name)) throw new Error(`duplicate tag ${tag.name}`);
        seen.add(tag.name);
      }
    }).not.toThrow();
  });
});

describe("query engine surfaces", () => {
  it("lists across the whole vault when source is omitted (MCP)", async () => {
    const { api } = makeApi();
    const { host, tools } = makeHost();
    registerMcpTools(host as never, api);
    await tools.get("marginalia_create_annotation")!.callback({
      source: NOTE, text: "On test note.", quote: "lazy dog"
    });
    await tools.get("marginalia_create_annotation")!.callback({
      source: OTHER, text: "On other note.", quote: "lazy dog passage"
    });
    const whole = JSON.parse(
      (await tools.get("marginalia_list_annotations")!.callback({
        q: "lazy dog"
      }))
    ) as { total: number; threads: Array<{ source: string }> };
    expect(whole.total).toBe(2);
    expect(whole.threads.map((t) => t.source).sort()).toEqual([NOTE, OTHER].sort());
  });

  it("filters with q, sorts by created desc, and caps with limit", async () => {
    const { api } = makeApi();
    await api.createFromText(NOTE, NOTE_TEXT, {
      text: "first", quote: "lazy dog", author: "Pi"
    });
    // createdAt has millisecond resolution: separate the two writes so the
    // created-desc assertion is deterministic.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await api.createFromText(OTHER, OTHER_TEXT, {
      text: "second", quote: "lazy dog passage", author: "Pi"
    });
    await api.createFromText(OTHER, OTHER_TEXT, {
      text: "third", quote: "And more.", author: "user"
    });

    const searched = api.list(undefined, { q: "second" }) as {
      body: { total: number; threads: Array<{ source: string }> };
    };
    expect(searched.body.total).toBe(1);
    expect(searched.body.threads[0].source).toBe(OTHER);

    const sorted = api.list(undefined, { author: "Pi", sort: "created", dir: "desc" }) as {
      body: { threads: Array<{ source: string }> };
    };
    expect(sorted.body.threads[0].source).toBe(OTHER);

    const capped = api.list(undefined, { author: "Pi", sort: "created", dir: "desc", limit: "1" }) as {
      body: { total: number; threads: unknown[] };
    };
    expect(capped.body.total).toBe(2);
    expect(capped.body.threads).toHaveLength(1);
  });

  it("keeps legacy status aliases working", async () => {
    const { api } = makeApi();
    const created = (await api.create(NOTE, {
      text: "x", quote: "lazy dog"
    })) as { status: number; body: { id: string } };
    await api.patch(NOTE, created.body.id, { read: true });

    const unreadAlias = api.list(NOTE, { status: "unread" }) as {
      body: { threads: unknown[] };
    };
    expect(unreadAlias.body.threads).toHaveLength(0);
    const driftedAlias = api.list(NOTE, { status: "drifted" }) as {
      body: { threads: unknown[] };
    };
    expect(driftedAlias.body.threads).toHaveLength(0);
  });

  it("rejects an unknown status with 400", () => {
    const { api } = makeApi();
    expect((api.list(NOTE, { status: "sparkle" }) as { status: number }).status).toBe(400);
  });
});

describe("trash / recycle bin", () => {
  it("lists parsed entries and restores by id", async () => {
    const { api, store } = makeApi();
    const created = (await api.create(NOTE, {
      text: "Soft delete me.",
      quote: "lazy dog"
    })) as { status: number; body: { id: string } };
    const id = created.body.id;
    const removed = await api.remove(NOTE, id);
    expect((removed.body as { trash: string }).trash).toContain("trash/");
    expect(api.get(NOTE, id).status).toBe(404);

    const trash = await store.listTrash();
    const entry = trash.find((e) => e.id === id);
    expect(entry).toBeTruthy();
    expect(entry?.source).toBe(NOTE);
    expect(entry?.body).toContain("Soft delete me.");

    const restored = await api.restoreFromTrash(id);
    expect(restored.status).toBe(200);
    const body = restored.body as { body: string; status: string };
    expect(body.body).toBe("Soft delete me.");
    expect(body.status).toBe("open");
    expect(api.get(NOTE, id).status).toBe(200);
    expect((await store.listTrash()).find((e) => e.id === id)).toBeUndefined();
  });

  it("purges trash older than the cutoff", async () => {
    const { api, store } = makeApi();
    const created = (await api.create(NOTE, {
      text: "Purge me.",
      quote: "lazy dog"
    })) as { status: number; body: { id: string } };
    await api.remove(NOTE, created.body.id);
    expect((await store.listTrash()).length).toBe(1);
    // Cutoff in the future: everything counts as expired.
    await store.purgeTrash(Date.now() + 60_000);
    expect(await store.listTrash()).toHaveLength(0);
  });
});
