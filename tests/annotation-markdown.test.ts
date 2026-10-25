import { describe, expect, it } from "vitest";
import { Annotation } from "../src/domain/annotation";
import {
  parseAnnotation,
  serializeAnnotation
} from "../src/storage/annotation-markdown";

const annotation: Annotation = {
  schemaVersion: 1,
  id: "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  sourcePath: "Notes/Example.md",
  sourceType: "markdown",
  status: "open",
  createdAt: "2026-07-27T12:00:00.000Z",
  updatedAt: "2026-07-27T12:00:00.000Z",
  body: "A **Markdown** comment.\n\n- With a list\n- And `code`",
  anchor: {
    kind: "markdown",
    startOffset: 12,
    endOffset: 28,
    startLine: 1,
    startCharacter: 3,
    endLine: 1,
    endCharacter: 19,
    quote: {
      exact: "selected passage",
      prefix: "A ",
      suffix: " follows."
    }
  },
  replies: []
};

describe("annotation Markdown format", () => {
  it("round-trips an annotation", () => {
    expect(parseAnnotation(serializeAnnotation(annotation))).toEqual(annotation);
  });

  it("keeps arbitrary Markdown in the body", () => {
    const body = "# Nested heading\n\n```ts\nconst value = 1;\n```";
    const parsed = parseAnnotation(
      serializeAnnotation({ ...annotation, body })
    );
    expect(parsed.body).toBe(body);
  });

  it("rejects files without anchor metadata", () => {
    expect(() =>
      parseAnnotation(`---
siden-schema: 1
---

# Annotation

Missing anchor`)
    ).toThrow("anchor metadata is missing");
  });

  it("round-trips color, mark style and replies", () => {
    const styled: Annotation = {
      ...annotation,
      color: "#90caf9",
      markStyle: "wavy",
      replies: [
        {
          id: "a1b2c3d4",
          createdAt: "2026-07-28T09:00:00.000Z",
          body: "First reply"
        },
        {
          id: "e5f6a7b8",
          createdAt: "2026-07-29T10:00:00.000Z",
          body: "Second **reply** with\nmultiple lines"
        }
      ]
    };
    const source = serializeAnnotation(styled);
    expect(source).toContain('color: "#90caf9"');
    expect(source).toContain('mark-style: "wavy"');
    expect(source).toContain("## Replies");
    expect(parseAnnotation(source)).toEqual(styled);
  });

  it("parses legacy files without new fields", () => {
    const legacy = `---
siden-schema: 1
id: "legacy-id"
source: "Notes/Old.md"
source-type: "markdown"
status: "open"
created: "2026-01-01T00:00:00.000Z"
updated: "2026-01-01T00:00:00.000Z"
---

# Annotation

Old body.

<!-- siden:anchor -->

## Anchor metadata

\`\`\`json
${JSON.stringify(annotation.anchor, null, 2)}
\`\`\`

<!-- /siden:anchor -->
`;
    const parsed = parseAnnotation(legacy);
    expect(parsed.color).toBeUndefined();
    expect(parsed.markStyle).toBeUndefined();
    expect(parsed.replies).toEqual([]);
    expect(parsed.body).toBe("Old body.");
  });

  it("degrades malformed reply headings instead of rejecting the file", () => {
    const broken = serializeAnnotation({
      ...annotation,
      replies: [{ id: "x", createdAt: "2026-01-01T00:00:00.000Z", body: "hi" }]
    }).replace("### x | 2026-01-01T00:00:00.000Z", "###");
    const parsed = parseAnnotation(broken);
    expect(parsed.replies).toEqual([]);
    expect(parsed.body).toContain("## Replies");
  });

  it("keeps reply bodies that contain plain markdown H3 lines", () => {
    const parsed = parseAnnotation(serializeAnnotation({
      ...annotation,
      replies: [{ id: "x", createdAt: "2026-01-01T00:00:00.000Z", body: "### Summary\npoint" }]
    }));
    expect(parsed.replies).toHaveLength(1);
    expect(parsed.replies[0].body).toBe("### Summary\npoint");
  });
});
