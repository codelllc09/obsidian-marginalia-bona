import { describe, expect, it } from "vitest";
import {
  anchorDrift,
  Annotation,
  ANNOTATION_SCHEMA_VERSION,
  statusAfterAnchorMap
} from "../src/domain/annotation";
import { entryFor } from "../src/storage/annotation-index";
import { parseAnnotation, serializeAnnotation } from "../src/storage/annotation-markdown";

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    id: "drift-test",
    sourcePath: "Notes/idea.md",
    sourceType: "markdown",
    status: "open",
    createdAt: "2026-10-25T10:00:00.000Z",
    updatedAt: "2026-10-25T10:00:00.000Z",
    body: "Comment.",
    anchor: {
      kind: "markdown",
      startOffset: 0,
      endOffset: 4,
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: 4,
      quote: { exact: "edited text" },
      originalQuote: "original text"
    },
    replies: [],
    ...overrides
  };
}

describe("anchorDrift", () => {
  it("reports original and current text when they differ", () => {
    expect(anchorDrift(makeAnnotation())).toEqual({
      original: "original text",
      current: "edited text"
    });
  });

  it("returns null when the passage is unchanged", () => {
    expect(
      anchorDrift(
        makeAnnotation({ anchor: { kind: "markdown", startOffset: 0, endOffset: 4, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 4, quote: { exact: "same" }, originalQuote: "same" } })
      )
    ).toBeNull();
  });

  it("returns null for legacy annotations without originalQuote", () => {
    const { originalQuote, ...anchor } = makeAnnotation().anchor as Annotation["anchor"] & { originalQuote?: string };
    expect(
      anchorDrift(makeAnnotation({ anchor }))
    ).toBeNull();
    void originalQuote;
  });

  it("returns null for pdf and document anchors", () => {
    expect(
      anchorDrift(makeAnnotation({ anchor: { kind: "document" } }))
    ).toBeNull();
  });
});

describe("statusAfterAnchorMap", () => {
  it("orphans when the passage is lost, whatever the previous status", () => {
    for (const status of ["open", "resolved", "orphaned"] as const) {
      expect(
        statusAfterAnchorMap(makeAnnotation({ status }), true)
      ).toBe("orphaned");
    }
  });

  it("un-orphans when the passage is back, otherwise keeps status", () => {
    expect(
      statusAfterAnchorMap(makeAnnotation({ status: "orphaned" }), false)
    ).toBe("open");
    expect(
      statusAfterAnchorMap(makeAnnotation({ status: "resolved" }), false)
    ).toBe("resolved");
    expect(statusAfterAnchorMap(makeAnnotation(), false)).toBe("open");
  });
});

describe("drift persistence and index", () => {
  it("keeps originalQuote through a serialize/parse round trip", () => {
    const parsed = parseAnnotation(serializeAnnotation(makeAnnotation()));
    expect(
      parsed.anchor.kind === "markdown" ? parsed.anchor.originalQuote : undefined
    ).toBe("original text");
  });

  it("flags drifted annotations in the index entry", () => {
    expect(entryFor(makeAnnotation()).drifted).toBe(true);
    expect(
      entryFor(
        makeAnnotation({
          anchor: { kind: "markdown", startOffset: 0, endOffset: 4, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 4, quote: { exact: "original text" }, originalQuote: "original text" }
        })
      ).drifted
    ).toBeUndefined();
  });
});
