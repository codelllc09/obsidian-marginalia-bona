import { beforeEach, describe, expect, it } from "vitest";
import type { Annotation } from "../src/domain/annotation";
import { highlightOccurrence } from "../src/reading/reading-renderer";
import { installDom } from "./dom-setup";

/** Source text of the demo note, as the editor would see it. */
const NOTE_TEXT = [
  'Shannon 在 1948 年把"信息"与"意义"切开：*the semantic aspects of communication are irrelevant to the engineering problem*。这一步让信道容量成为可计算量。',
  "",
  "> It is known that Maxwell's electrodynamics leads to asymmetries.",
  "",
  "评估指标从 `P@10` 换到 `NDCG@10` 之后，排序质量的分歧被掩盖了一部分。"
].join("\n");

let document: Document;

beforeEach(() => {
  document = installDom().document;
});

function annotationWith(exact: string): Annotation {
  const start = NOTE_TEXT.indexOf(exact);
  return {
    schemaVersion: 1,
    id: "aaaaaaaa-1111-4000-8000-000000000000",
    sourcePath: "Demo/Reading notes.md",
    sourceType: "markdown",
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    body: "note",
    anchor: {
      kind: "markdown",
      startOffset: start,
      endOffset: start + exact.length,
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: exact.length,
      quote: {
        exact,
        prefix: NOTE_TEXT.slice(Math.max(0, start - 20), start),
        suffix: NOTE_TEXT.slice(start + exact.length, start + exact.length + 20)
      },
      originalQuote: exact
    },
    replies: []
  };
}

const plugin = {
  settings: {
    showHighlights: true,
    showMargins: true,
    showResolved: false,
    defaultMarkStyle: "highlight",
    defaultColor: "#ffd54f",
    highlightColor: "#ffd54f",
    highlightOpacity: 0.5,
    marginSide: "auto",
    forceLongWordBreaks: false
  }
} as never;

function paragraph(parts: Array<string | { tag: "em" | "code"; text: string }>): HTMLElement {
  const p = document.createElement("p");
  for (const part of parts) {
    if (typeof part === "string") {
      p.appendChild(document.createTextNode(part));
    } else {
      const el = document.createElement(part.tag);
      el.textContent = part.text;
      p.appendChild(el);
    }
  }
  return p;
}

describe("Reading view marks on rendered text", () => {
  it("marks a plain passage", () => {
    const p = paragraph([
      "It is known that Maxwell's electrodynamics leads to asymmetries."
    ]);
    const mark = highlightOccurrence(
      p,
      annotationWith("Maxwell's electrodynamics leads to asymmetries"),
      plugin
    );
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe("Maxwell's electrodynamics leads to asymmetries");
  });

  it("marks a passage that is italicised in the source", () => {
    const p = paragraph([
      'Shannon 在 1948 年把"信息"与"意义"切开：',
      {
        tag: "em",
        text: "the semantic aspects of communication are irrelevant to the engineering problem"
      },
      "。这一步让信道容量成为可计算量。"
    ]);
    const mark = highlightOccurrence(
      p,
      annotationWith(
        "the semantic aspects of communication are irrelevant to the engineering problem"
      ),
      plugin
    );
    expect(mark, "italic passage must still be marked").not.toBeNull();
  });

  it("marks a passage that carries inline code in the source", () => {
    const p = paragraph([
      "评估指标从 ",
      { tag: "code", text: "P@10" },
      " 换到 ",
      { tag: "code", text: "NDCG@10" },
      " 之后，排序质量的分歧被掩盖了一部分。"
    ]);
    const mark = highlightOccurrence(
      p,
      annotationWith(
        "评估指标从 `P@10` 换到 `NDCG@10` 之后，排序质量的分歧被掩盖了一部分"
      ),
      plugin
    );
    expect(mark, "code-span passage must still be marked").not.toBeNull();
  });
});
