import { z } from "zod";

import type { AnnotationsApi } from "./annotations-api";
import type { RestApiHost } from "./types";

const STATUS_ENUM = z.enum(["open", "resolved", "orphaned", "drifted", "all"]);

const COLOR_PARAM = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/, "hex color like #ffd54f")
  .optional()
  .describe("Per-annotation highlight color (hex, e.g. #ffd54f)");

const STYLE_PARAM = z
  .enum(["highlight", "underline", "wavy", "strikethrough", "bold"])
  .optional()
  .describe("Mark style");

/** The host wraps our shape with its own zod v4 (`z.object(shape)`),
 *  so only a ZodRawShape is accepted here - never z.object() itself. */

const SOURCE_SHAPE = {
  source: z
    .string()
    .describe("Vault path of the annotated note, e.g. Daily/2026-10-24.md")
};

function render(result: { status: number; body?: unknown }): string {
  if (result.status >= 400) {
    return JSON.stringify({
      error: result.body ?? { status: result.status }
    });
  }
  return JSON.stringify(result.body ?? { ok: true });
}

/** Registers the annotation tools on the host's MCP server so any MCP
 *  client sees first-class annotation operations instead of raw file
 *  access. Same AnnotationsApi as the REST routes - one implementation,
 *  one set of guarantees (anchoring, format, index sync). */
export function registerMcpTools(
  host: RestApiHost,
  api: AnnotationsApi
): void {
  const add = host.addMcpTool?.bind(host);
  if (!add) return;

  const query = (args: Record<string, unknown>) => {
    const q: Record<string, string> = {};
    if (typeof args.status === "string") q.status = args.status;
    if (typeof args.author === "string") q.author = args.author;
    if (typeof args.read === "boolean") q.read = String(args.read);
    if (typeof args.q === "string") q.q = args.q;
    if (typeof args.sort === "string") q.sort = args.sort;
    if (typeof args.dir === "string") q.dir = args.dir;
    if (typeof args.limit === "number") q.limit = String(args.limit);
    return q;
  };

  add(
    "marginalia_list_annotations",
    "List annotation threads. With source: that note only. Omit source to " +
      "search the whole vault (cap 200, response carries total). " +
      "status=drifted matches annotations whose quoted passage moved.",
    {
      source: z
        .string()
        .optional()
        .describe(
          "Vault path of the note to list; omit to search the whole vault"
        ),
      status: STATUS_ENUM.optional().describe(
        "Filter: open, resolved, orphaned, drifted, or all (default all)"
      ),
      author: z
        .string()
        .optional()
        .describe("Filter by author, e.g. Pi or user"),
      read: z
        .boolean()
        .optional()
        .describe("Filter: true = read only, false = unread only"),
      q: z
        .string()
        .optional()
        .describe(
          "Case-insensitive substring across body, replies, quote, and note path"
        ),
      sort: z
        .enum(["source", "created", "updated"])
        .optional()
        .describe(
          "Order: source (document order, default), created, or updated; combine with dir"
        ),
      dir: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Sort direction, default asc"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Cap on returned threads (hard cap 200); response carries total")
    },
    async (args) =>
      render(
        api.list(
          typeof args.source === "string" ? args.source : undefined,
          query(args)
        )
      )
  );

  add(
    "marginalia_create_annotation",
    "Create an annotation anchored to an exact passage of a note. " +
      "The quote must match exactly; include surrounding words to make it " +
      "unique. If the quote matches several passages the tool refuses and " +
      "asks for occurrence (1-based) - it never guesses.",
    {
      ...SOURCE_SHAPE,
      text: z.string().describe("Annotation body text"),
      quote: z
        .string()
        .describe("Exact passage to anchor, copied verbatim from the note"),
      occurrence: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("1-based index of the match when the quote is ambiguous"),
      author: z.string().optional().describe("Defaults to Agent"),
      color: COLOR_PARAM,
      style: STYLE_PARAM
    },
    async (args) =>
      render(
        await api.create(String(args.source), {
          text: String(args.text),
          quote: String(args.quote),
          occurrence:
            typeof args.occurrence === "number" ? args.occurrence : undefined,
          author: typeof args.author === "string" ? args.author : undefined,
          color: typeof args.color === "string" ? args.color : undefined,
          style: typeof args.style === "string" ? args.style : undefined
        })
      )
  );

  add(
    "marginalia_get_annotation",
    "Fetch one annotation thread with its replies.",
    { ...SOURCE_SHAPE, id: z.string().describe("Annotation id") },
    async (args) => render(api.get(String(args.source), String(args.id)))
  );

  add(
    "marginalia_add_reply",
    "Append a reply to an annotation thread.",
    {
      ...SOURCE_SHAPE,
      id: z.string().describe("Annotation id"),
      text: z.string().describe("Reply text"),
      author: z.string().optional().describe("Defaults to Agent")
    },
    async (args) =>
      render(
        await api.addReply(String(args.source), String(args.id), {
          text: String(args.text),
          author: typeof args.author === "string" ? args.author : undefined
        })
      )
  );

  add(
    "marginalia_update_annotation",
    "Edit an annotation's text, color, style, and/or resolution state. " +
      "Pass expected_text to fail instead of overwriting concurrent edits.",
    {
      ...SOURCE_SHAPE,
      id: z.string().describe("Annotation id"),
      text: z.string().optional().describe("New body text"),
      expected_text: z
        .string()
        .optional()
        .describe("Text you last read; update fails if it changed since"),
      status: z
        .enum(["open", "resolved"])
        .optional()
        .describe("Resolution state"),
      read: z
        .boolean()
        .optional()
        .describe("true marks read (records a timestamp); false marks unread"),
      color: COLOR_PARAM,
      style: STYLE_PARAM
    },
    async (args) => {
      const body: Record<string, unknown> = {};
      if (typeof args.text === "string") {
        body.text = args.text;
        if (typeof args.expected_text === "string") {
          body.expected_text = args.expected_text;
        }
      }
      if (args.status === "resolved") body.resolved = true;
      else if (args.status === "open") body.resolved = false;
      if (typeof args.read === "boolean") body.read = args.read;
      if (typeof args.color === "string") body.color = args.color;
      if (typeof args.style === "string") body.style = args.style;
      return render(await api.patch(String(args.source), String(args.id), body));
    }
  );

  add(
    "marginalia_reanchor",
    "Move an annotation to a new passage - the agent-side fix for drifted " +
      "or orphaned annotations after the note was edited. Prefer this over " +
      "delete + recreate: the thread (replies) is preserved. Same quote " +
      "rules as create: exact match, occurrence disambiguates. Clears the " +
      "orphaned status and the drift flag.",
    {
      ...SOURCE_SHAPE,
      id: z.string().describe("Annotation id"),
      quote: z
        .string()
        .describe("New exact passage to attach the annotation to"),
      occurrence: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("1-based index of the match when the quote is ambiguous"),
      expected_quote: z
        .string()
        .optional()
        .describe(
          "Currently anchored quote you last read; reanchor fails if it changed since"
        )
    },
    async (args) =>
      render(
        await api.reanchor(String(args.source), String(args.id), {
          quote: String(args.quote),
          occurrence:
            typeof args.occurrence === "number" ? args.occurrence : undefined,
          expected_quote:
            typeof args.expected_quote === "string"
              ? args.expected_quote
              : undefined
        })
      )
  );

  add(
    "marginalia_update_reply",
    "Edit one reply's text (and optionally its author) inside an annotation thread.",
    {
      ...SOURCE_SHAPE,
      id: z.string().describe("Annotation id"),
      replyId: z.string().describe("Reply id"),
      text: z.string().describe("New reply text"),
      author: z.string().optional().describe("New reply author")
    },
    async (args) =>
      render(
        await api.updateReply(
          String(args.source),
          String(args.id),
          String(args.replyId),
          {
            text: String(args.text),
            author: typeof args.author === "string" ? args.author : undefined
          }
        )
      )
  );

  add(
    "marginalia_delete_reply",
    "Delete one reply from an annotation thread.",
    {
      ...SOURCE_SHAPE,
      id: z.string().describe("Annotation id"),
      replyId: z.string().describe("Reply id")
    },
    async (args) =>
      render(
        await api.removeReply(
          String(args.source),
          String(args.id),
          String(args.replyId)
        )
      )
  );

  add(
    "marginalia_list_trash",
    "List annotations in the recycle bin (soft-deleted). Entries keep their " +
      "original id and source; restore by id. Unparseable entries cannot be " +
      "restored by id.",
    {},
    async () => render(await api.listTrash())
  );

  add(
    "marginalia_restore_annotation",
    "Restore a soft-deleted annotation from the recycle bin back to its " +
      "original note location. The anchor, body, and replies come back " +
      "exactly as they were at deletion time.",
    {
      id: z.string().describe("Annotation id (from marginalia_list_trash)")
    },
    async (args) =>
      render(await api.restoreFromTrash(String(args.id)))
  );

  add(
    "marginalia_delete_annotation",
    "Delete an annotation thread permanently.",
    { ...SOURCE_SHAPE, id: z.string().describe("Annotation id") },
    async (args) =>
      render(await api.remove(String(args.source), String(args.id)))
  );
}
