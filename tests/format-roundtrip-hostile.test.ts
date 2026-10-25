import { describe, expect, it } from "vitest";
import {
  parseAnnotation,
  serializeAnnotation
} from "../src/storage/annotation-markdown";
import type { Annotation, AnnotationReply } from "../src/domain/annotation";

/** A fully-formed annotation with a markdown anchor, ready to mutate. */
function base(overrides: Partial<Annotation> = {}): Annotation {
  return {
    schemaVersion: 1,
    id: "11111111-2222-3333-4444-555555555555",
    sourcePath: "Notes/Hostile.md",
    sourceType: "markdown",
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    body: "Root body.",
    anchor: {
      kind: "markdown",
      startOffset: 4,
      endOffset: 8,
      startLine: 0,
      startCharacter: 4,
      endLine: 0,
      endCharacter: 8,
      quote: { exact: "body", prefix: "Root ", suffix: "." },
      originalQuote: "body"
    },
    replies: [],
    ...overrides
  };
}

function reply(overrides: Partial<AnnotationReply> = {}): AnnotationReply {
  return {
    id: "r1a2b3c4",
    createdAt: "2026-01-03T00:00:00.000Z",
    body: "Reply body.",
    ...overrides
  };
}

function roundtrip(annotation: Annotation): Annotation {
  return parseAnnotation(serializeAnnotation(annotation));
}

describe("markdown thread format / hostile round-trips", () => {
  it("survives a plain annotation unchanged", () => {
    const original = base();
    expect(roundtrip(original)).toEqual(original);
  });

  for (const hostile of [
    "# A top-level heading inside the body",
    "## Section",
    "### Subsection",
    "#### Deep",
    "###nospace",
    "---",
    "```json\n{\"fake\": true}\n```",
    "<!-- siden:anchor --> injected",
    "正文，包含中文与标点。",
    "emoji 🎉🎉 and surrogate pairs 𝄞",
    "zero-width\u200b and combining e\u0301",
    "RTL: مرحبا بالعالم",
    "trailing spaces   \ntabs\there",
    "line1\n\n\nline4"
  ]) {
    it(`keeps body intact: ${JSON.stringify(hostile.slice(0, 24))}`, () => {
      const original = base({ body: hostile });
      const parsed = roundtrip(original);
      expect(parsed.body).toBe(hostile);
    });
  }

  it("keeps a body that itself contains a '## Replies' line", () => {
    const original = base({
      body: "Quoting the format:\n\n## Replies\n\n…and prose after it."
    });
    const parsed = roundtrip(original);
    expect(parsed.body).toBe(original.body);
    expect(parsed.replies).toEqual([]);
  });

  it("keeps a body containing a fake reply heading", () => {
    const original = base({
      body: "Look:\n\n### fake-id | not-a-date\n\nnot a real reply"
    });
    const parsed = roundtrip(original);
    expect(parsed.body).toBe(original.body);
    expect(parsed.replies).toEqual([]);
  });

  it("keeps replies whose bodies contain markdown headings", () => {
    const original = base({
      replies: [
        reply({ body: "### Summary\n\nPoint one.\n\n#### Detail" }),
        reply({ id: "r2b3c4d5", body: "plain" })
      ]
    });
    const parsed = roundtrip(original);
    expect(parsed.replies).toHaveLength(2);
    expect(parsed.replies[0].body).toBe("### Summary\n\nPoint one.\n\n#### Detail");
    expect(parsed.replies[1].body).toBe("plain");
  });

  it("keeps a reply body that contains a fake '## Replies' marker", () => {
    const original = base({
      replies: [
        reply({ body: "nested quote:\n\n## Replies\n\nstill my body" }),
        reply({ id: "r2b3c4d5", body: "second" })
      ]
    });
    const parsed = roundtrip(original);
    expect(parsed.replies).toHaveLength(2);
    expect(parsed.replies[0].body).toContain("## Replies");
    expect(parsed.replies[1].body).toBe("second");
  });

  it("preserves reply authors and order", () => {
    const original = base({
      replies: [
        reply({ author: "Pi" }),
        reply({ id: "r2b3c4d5", author: "Claude" })
      ]
    });
    const parsed = roundtrip(original);
    expect(parsed.replies.map((r) => r.author)).toEqual(["Pi", "Claude"]);
  });

  it("keeps pipe characters in reply authors", () => {
    const original = base({ replies: [reply({ author: "a | b | c" })] });
    const parsed = roundtrip(original);
    expect(parsed.replies[0].author).toBe("a | b | c");
  });

  it("keeps CJK and emoji in quote metadata", () => {
    const original = base({
      anchor: {
        kind: "markdown",
        startOffset: 2,
        endOffset: 6,
        startLine: 0,
        startCharacter: 2,
        endLine: 0,
        endCharacter: 6,
        quote: { exact: "庆祝🎉", prefix: "在", suffix: "。" },
        originalQuote: "庆祝🎉"
      }
    });
    const parsed = roundtrip(original);
    expect(parsed.anchor).toEqual(original.anchor);
  });

  describe("documented rejections (broken files must not ingest)", () => {
    it("rejects a BOM-prefixed file", () => {
      expect(() =>
        parseAnnotation("\uFEFF" + serializeAnnotation(base()))
      ).toThrow(/frontmatter/);
    });

    it("rejects unclosed frontmatter", () => {
      expect(() =>
        parseAnnotation("---\nid: x\n\n# Annotation\n\nbody")
      ).toThrow(/not closed|missing/);
    });

    it("rejects invalid status values", () => {
      const text = serializeAnnotation(base())
        .replace('status: "open"', 'status: "deleted"');
      expect(() => parseAnnotation(text)).toThrow(/status/i);
    });

    it("rejects a wrong schema version", () => {
      const text = serializeAnnotation(base())
        .replace("siden-schema: 1", "siden-schema: 99");
      expect(() => parseAnnotation(text)).toThrow(/schema/i);
    });

    it("rejects corrupt anchor JSON", () => {
      const text = serializeAnnotation(base()).replace(
        '"kind": "markdown"',
        '"kind": "markdown",'
      );
      expect(() => parseAnnotation(text)).toThrow();
    });

    it("rejects a missing anchor block", () => {
      const text = serializeAnnotation(base());
      const cut = text.indexOf("<!-- siden:anchor -->");
      expect(() => parseAnnotation(text.slice(0, cut))).toThrow(/anchor/);
    });

    it("silently drops an unknown mark-style (forward compatibility)", () => {
      const text = serializeAnnotation(base())
        .replace('status: "open"', 'status: "open"\nmark-style: "rainbow"');
      const parsed = parseAnnotation(text);
      expect(parsed.markStyle).toBeUndefined();
    });

    it("rejects an invalid color value", () => {
      const text = serializeAnnotation(base())
        .replace('status: "open"', 'status: "open"\ncolor: "notahex"');
      expect(() => parseAnnotation(text)).toThrow(/color/i);
    });

    it("degrades a malformed reply heading to a reply-less file instead of dying", () => {
      const text = serializeAnnotation(base({ replies: [reply()] }))
        .replace("### r1a2b3c4 |", "####r1a2b3c4 |");
      const parsed = parseAnnotation(text);
      expect(parsed.replies).toEqual([]);
      // Nothing is silently deleted: the orphaned section text survives
      // inside the body for a human to inspect.
      expect(parsed.body).toContain("Root body.");
      expect(parsed.body).toContain("## Replies");
    });

    it("accepts CRLF input by normalizing line endings", () => {
      const text = serializeAnnotation(base()).replaceAll("\n", "\r\n");
      const parsed = parseAnnotation(text);
      expect(parsed.body).toBe("Root body.");
    });
  });
});
