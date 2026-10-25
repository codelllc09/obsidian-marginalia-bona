/** OpenAPI contribution describing the annotations REST surface. Only
 *  mounted with the REST channel: an agent reading this document should
 *  find exactly the endpoints that answer. Semantics mirror the MCP tool
 *  descriptions - one implementation, two projections. */

const TAG = "Marginalia annotations";

const PATH_PARAM = {
  name: "path",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "Vault path of the annotated note, e.g. Daily/2026-10-24.md"
};

const ERROR_REF = { $ref: "#/components/schemas/MarginaliaError" };

const JSON_BODY = (schema: Record<string, unknown>) => [
  {
    required: true,
    content: { "application/json": { schema } }
  }
];

const OK_THREAD = {
  description:
    "The annotation thread: {id, source, status, author, color, markStyle, created, updated, drifted, anchor, body, replies[]}."
};

function op(
  summary: string,
  description: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    summary,
    description,
    tags: [TAG],
    responses: {
      "4XX": { description: "Error envelope.", content: { "application/json": { schema: ERROR_REF } } }
    },
    ...extra
  };
}

export function openApiDescription(): Record<string, unknown> {
  return {
    tags: [
      {
        name: TAG,
        description:
          "Marginalia Bona annotations. Anchors are built by the plugin - agents never hand-assemble offset data. Ambiguous quotes are refused (409), never guessed."
      }
    ],
    components: {
      schemas: {
        MarginaliaError: {
          type: "object",
          required: ["errorCode", "message"],
          properties: {
            errorCode: {
              type: "integer",
              description:
                "40001 invalid body; 40401 unknown annotation; 40402 not a Markdown note; 40403 quote not found; 40404 unknown reply; 40902 ambiguous quote (pass occurrence); 40903 optimistic-lock mismatch; 50000 bridge error."
            },
            message: { type: "string" }
          }
        }
      }
    },
    paths: {
      "/vault/{path}/annotations/": {
        parameters: [PATH_PARAM],
        get: op(
          "List annotation threads on a note",
          "Query `status`: open | resolved | orphaned | drifted | all (default all). Query `author` filters by author (e.g. Pi, user).",
          {
            parameters: [
              PATH_PARAM,
              {
                name: "status",
                in: "query",
                schema: { type: "string" },
                description: "open | resolved | orphaned | drifted | all"
              },
              {
                name: "author",
                in: "query",
                schema: { type: "string" },
                description: "Filter by author"
              }
            ],
            responses: {
              "200": {
                description: "Threads: {threads: [...]}, newest semantics per store order."
              }
            }
          }
        ),
        post: op(
          "Create an annotation anchored to an exact passage",
          "The quote must match the note verbatim; include surrounding words to keep it unique. Multi-match quotes are refused with 40902 unless `occurrence` (1-based) is given - the plugin never guesses. `color` is a hex value, `style` one of highlight/underline/wavy/strikethrough/bold.",
          {
            requestBody: JSON_BODY({
              type: "object",
              required: ["text", "quote"],
              properties: {
                text: { type: "string", description: "Annotation body" },
                quote: { type: "string", description: "Exact passage, verbatim" },
                occurrence: { type: "integer", minimum: 1 },
                author: { type: "string", description: "Defaults to Agent" },
                color: { type: "string", description: "Hex, e.g. #ffd54f" },
                style: {
                  type: "string",
                  enum: ["highlight", "underline", "wavy", "strikethrough", "bold"]
                }
              }
            }),
            responses: {
              "201": OK_THREAD
            }
          }
        )
      },
      "/vault/{path}/annotations/{id}": {
        parameters: [PATH_PARAM],
        get: op("Fetch one annotation thread", "Includes all replies.", {
          parameters: [
            PATH_PARAM,
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: { "200": OK_THREAD }
        }),
        patch: op(
          "Edit an annotation",
          "Pass `expected_text` (the body you last read) to fail with 40903 instead of overwriting concurrent edits. `resolved: true/false` sets the resolution state. `color`/`style` restyle the annotation.",
          {
            parameters: [
              PATH_PARAM,
              { name: "id", in: "path", required: true, schema: { type: "string" } }
            ],
            requestBody: JSON_BODY({
              type: "object",
              properties: {
                text: { type: "string" },
                expected_text: { type: "string" },
                resolved: { type: "boolean" },
                color: { type: "string" },
                style: {
                  type: "string",
                  enum: ["highlight", "underline", "wavy", "strikethrough", "bold"]
                }
              }
            }),
            responses: { "200": OK_THREAD }
          }
        ),
        delete: op(
          "Delete an annotation thread permanently",
          "Removes the thread file including all replies. No recycle bin (yet).",
          {
            parameters: [
              PATH_PARAM,
              { name: "id", in: "path", required: true, schema: { type: "string" } }
            ],
            responses: {
              "200": {
                description: "{deleted: true}"
              }
            }
          }
        )
      },
      "/vault/{path}/annotations/{id}/replies": {
        parameters: [PATH_PARAM],
        post: op("Append a reply", "Author defaults to Agent.", {
          parameters: [
            PATH_PARAM,
            { name: "id", in: "path", required: true, schema: { type: "string" } }
          ],
          requestBody: JSON_BODY({
            type: "object",
            required: ["text"],
            properties: {
              text: { type: "string" },
              author: { type: "string" }
            }
          }),
          responses: { "201": OK_THREAD }
        })
      },
      "/vault/{path}/annotations/{id}/replies/{replyId}": {
        parameters: [PATH_PARAM],
        patch: op("Edit one reply", "Unknown reply ids yield 40404.", {
          parameters: [
            PATH_PARAM,
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "replyId", in: "path", required: true, schema: { type: "string" } }
          ],
          requestBody: JSON_BODY({
            type: "object",
            required: ["text"],
            properties: {
              text: { type: "string" },
              author: { type: "string" }
            }
          }),
          responses: { "200": OK_THREAD }
        }),
        delete: op("Delete one reply", "Unknown reply ids yield 40404.", {
          parameters: [
            PATH_PARAM,
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "replyId", in: "path", required: true, schema: { type: "string" } }
          ],
          responses: { "200": OK_THREAD }
        })
      },
      "/vault/{path}/annotations/{id}/reanchor": {
        parameters: [PATH_PARAM],
        post: op(
          "Re-anchor an annotation to a new passage",
          "The agent-side fix for drifted/orphaned annotations after the note was edited. Prefer this over delete + recreate: the reply thread is preserved. Same quote rules as create; clears orphaned status and the drift flag. Pass `expected_quote` (the currently anchored quote you last read) to fail with 40903 if the anchor moved since.",
          {
            parameters: [
              PATH_PARAM,
              { name: "id", in: "path", required: true, schema: { type: "string" } }
            ],
            requestBody: JSON_BODY({
              type: "object",
              required: ["quote"],
              properties: {
                quote: { type: "string", description: "New exact passage" },
                occurrence: { type: "integer", minimum: 1 },
                expected_quote: { type: "string" }
              }
            }),
            responses: { "200": OK_THREAD }
          }
        )
      }
    }
  };
}
