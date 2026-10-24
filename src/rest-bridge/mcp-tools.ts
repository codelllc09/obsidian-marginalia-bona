import { z } from "zod";

import type { AnnotationsApi } from "./annotations-api";
import type { RestApiHost } from "./types";

const STATUS_ENUM = z.enum(["open", "resolved", "orphaned", "drifted", "all"]);

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
    return q;
  };

  add(
    "marginalia_list_annotations",
    "List Marginalia annotation threads on a note, newest first. " +
      "status=drifted returns annotations whose quoted passage moved.",
    {
      ...SOURCE_SHAPE,
      status: STATUS_ENUM.describe(
        "Filter: open, resolved, orphaned, drifted, or all (default all)"
      )
    },
    async (args) =>
      render(api.list(String(args.source), query(args)))
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
      author: z.string().optional().describe("Defaults to Agent")
    },
    async (args) =>
      render(
        await api.create(String(args.source), {
          text: String(args.text),
          quote: String(args.quote),
          occurrence:
            typeof args.occurrence === "number" ? args.occurrence : undefined,
          author: typeof args.author === "string" ? args.author : undefined
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
    "Edit an annotation's text and/or resolution state. Pass expected_text " +
      "to fail instead of overwriting concurrent edits.",
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
        .describe("Resolution state")
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
      return render(await api.patch(String(args.source), String(args.id), body));
    }
  );

  add(
    "marginalia_delete_annotation",
    "Delete an annotation thread permanently.",
    { ...SOURCE_SHAPE, id: z.string().describe("Annotation id") },
    async (args) =>
      render(await api.remove(String(args.source), String(args.id)))
  );
}
