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
  }
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
});
