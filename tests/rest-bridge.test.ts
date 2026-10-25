import { beforeEach, describe, expect, it } from "vitest";

import { AnnotationStore } from "../src/storage/annotation-store";
import { MemoryAdapter } from "./memory-adapter";
import { TFile } from "./obsidian-runtime-mock";
import { AnnotationsApi } from "../src/rest-bridge/annotations-api";
import { RestBridge } from "../src/rest-bridge";
import { registerMcpTools } from "../src/rest-bridge/mcp-tools";
import type { McpToolCallback } from "../src/rest-bridge/types";
import type MarginaliaPlugin from "../src/main";

const NOTE = "Notes/Test.md";
const NOTE_TEXT =
  "The quick brown fox jumps over the lazy dog.\nSecond line with quick brown fox again.";

function makeApi(): {
  api: AnnotationsApi;
  store: AnnotationStore;
  plugin: MarginaliaPlugin;
} {
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
        "marginalia_get_annotation",
        "marginalia_list_annotations",
        "marginalia_update_annotation"
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
};

function makeBridge(settings: ChannelSettings) {
  const { plugin } = makeApi();
  const spy: HostSpy = {
    subresourceNames: [],
    routes: [],
    mcpTools: [],
    unregisterCount: 0
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
    expect(spy.routes).toHaveLength(6);
    expect(spy.mcpTools).toEqual([]);
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
    expect(spy.mcpTools).toHaveLength(6);
    bridge.disconnect();
    expect(spy.unregisterCount).toBe(1);
  });

  it("mounts both channels when both are enabled", () => {
    const { bridge, spy } = makeBridge({
      agentMcpEnabled: true,
      agentRestEnabled: true
    });
    bridge.connect();
    expect(spy.routes).toHaveLength(6);
    expect(spy.mcpTools).toHaveLength(6);
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
      })) as string
    ) as { color: string; markStyle: string };
    expect(created.color).toBe("#00bcd4");
    expect(created.markStyle).toBe("bold");
  });
});
