import { describe, expect, it } from "vitest";
import {
  Annotation,
  ANNOTATION_SCHEMA_VERSION,
  AnnotationReply
} from "../src/domain/annotation";
import { parseAnnotation, serializeAnnotation } from "../src/storage/annotation-markdown";

function baseAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    id: "test-annotation",
    sourcePath: "Notes/idea.md",
    sourceType: "markdown",
    status: "open",
    createdAt: "2026-10-25T10:00:00.000Z",
    updatedAt: "2026-10-25T10:00:00.000Z",
    body: "Root comment.",
    anchor: {
      kind: "markdown",
      startOffset: 0,
      endOffset: 4,
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: 4,
      quote: { exact: "test" }
    },
    replies: [],
    ...overrides
  };
}

describe("annotation author field", () => {
  it("round-trips frontmatter and reply authors", () => {
    const replies: AnnotationReply[] = [
      { id: "r1", createdAt: "2026-10-25T10:05:00.000Z", author: "Pi", body: "Agent reply." },
      { id: "r2", createdAt: "2026-10-25T10:06:00.000Z", body: "Legacy reply without author." }
    ];
    const annotation = baseAnnotation({ author: "user", replies });
    const parsed = parseAnnotation(serializeAnnotation(annotation));

    expect(parsed.author).toBe("user");
    expect(parsed.replies[0].author).toBe("Pi");
    expect(parsed.replies[1].author).toBeUndefined();
    expect(parsed.replies[1].body).toBe("Legacy reply without author.");
  });

  it("omits the author line when no author is set", () => {
    const source = serializeAnnotation(baseAnnotation());
    expect(source).not.toMatch(/^author:/m);
    const parsed = parseAnnotation(source);
    expect(parsed.author).toBeUndefined();
  });

  it("parses legacy two-segment reply headings without author", () => {
    const legacy = `---
siden-schema: 1
id: "legacy"
source: "Notes/idea.md"
source-type: "markdown"
status: "open"
created: "2026-10-25T10:00:00.000Z"
updated: "2026-10-25T10:00:00.000Z"
---

# Annotation

Body.

## Replies

### abc123 | 2026-10-25T10:05:00.000Z

Old reply.

<!-- siden:anchor -->

## Anchor metadata

\`\`\`json
{"kind":"markdown","startOffset":0,"endOffset":4,"startLine":0,"startCharacter":0,"endLine":0,"endCharacter":4,"quote":{"exact":"test"}}
\`\`\`

<!-- /siden:anchor -->
`;
    const parsed = parseAnnotation(legacy);
    expect(parsed.replies).toHaveLength(1);
    expect(parsed.replies[0].id).toBe("abc123");
    expect(parsed.replies[0].author).toBeUndefined();
    expect(parsed.replies[0].body).toBe("Old reply.");
  });

  it("keeps three-segment reply headings with author", () => {
    const source = serializeAnnotation(
      baseAnnotation({
        replies: [
          { id: "r1", createdAt: "2026-10-25T10:05:00.000Z", author: "Codex", body: "Hi." }
        ]
      })
    );
    expect(source).toContain("### r1 | 2026-10-25T10:05:00.000Z | Codex");
    const parsed = parseAnnotation(source);
    expect(parsed.replies[0].author).toBe("Codex");
  });
});
