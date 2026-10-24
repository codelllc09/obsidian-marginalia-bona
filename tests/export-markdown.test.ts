import { describe, expect, it } from "vitest";
import {
  Annotation,
  ANNOTATION_SCHEMA_VERSION
} from "../src/domain/annotation";
import { markdownExportFormat } from "../src/export/markdown-format";

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    id: "a1",
    sourcePath: "Notes/idea.md",
    sourceType: "markdown",
    status: "open",
    createdAt: "2026-10-25T10:00:00.000Z",
    updatedAt: "2026-10-25T10:00:00.000Z",
    body: "First comment.",
    author: "user",
    anchor: {
      kind: "markdown",
      startOffset: 10,
      endOffset: 14,
      startLine: 4,
      startCharacter: 0,
      endLine: 4,
      endCharacter: 4,
      quote: { exact: "some passage" }
    },
    replies: [],
    ...overrides
  };
}

const context = {
  sourcePath: "Notes/idea.md",
  exportedAt: "2026-10-25T12:00:00.000Z"
};

describe("markdown export format", () => {
  it("renders header, quote, author, body, and replies", () => {
    const output = markdownExportFormat.render(
      [
        makeAnnotation({
          replies: [
            { id: "r1", createdAt: "2026-10-25T10:05:00.000Z", author: "Pi", body: "Agent reply." }
          ]
        })
      ],
      context
    );
    expect(output).toContain("# Annotations — idea.md");
    expect(output).toContain("> some passage");
    expect(output).toContain("**user**");
    expect(output).toContain("First comment.");
    expect(output).toContain("**Pi**");
    expect(output).toContain("Agent reply.");
    expect(output).toContain("line 5");
  });

  it("sorts annotations by document position", () => {
    const output = markdownExportFormat.render(
      [
        makeAnnotation({ id: "later", anchor: { kind: "markdown", startOffset: 40, endOffset: 44, startLine: 9, startCharacter: 0, endLine: 9, endCharacter: 4, quote: { exact: "later passage" } } }),
        makeAnnotation({ id: "earlier" })
      ],
      context
    );
    expect(output.indexOf("some passage")).toBeLessThan(
      output.indexOf("later passage")
    );
  });

  it("marks resolved/orphaned status and style hints", () => {
    const output = markdownExportFormat.render(
      [makeAnnotation({ status: "resolved", color: "#ffab91", markStyle: "wavy" })],
      context
    );
    expect(output).toContain("resolved");
    expect(output).toContain("#ffab91");
    expect(output).toContain("wavy");
  });

  it("omits the quote section for document anchors", () => {
    const output = markdownExportFormat.render(
      [makeAnnotation({ anchor: { kind: "document" } })],
      context
    );
    expect(output).not.toContain("> ");
    expect(output).toContain("First comment.");
  });

  it("falls back to 'user' when no author is recorded", () => {
    const output = markdownExportFormat.render(
      [makeAnnotation({ author: undefined })],
      context
    );
    expect(output).toContain("**user**");
  });
});
