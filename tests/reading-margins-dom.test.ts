import { beforeEach, describe, expect, it } from "vitest";
import { processReadingView } from "../src/reading/reading-renderer";
import { installDom } from "./dom-setup";
import type { Annotation } from "../src/domain/annotation";

const NOTE = "Demo/Reading notes.md";
const QUOTE = "Maxwell's electrodynamics leads to asymmetries";

let document: Document;

beforeEach(() => {
  document = installDom().document;
});

function annotation(): Annotation {
  return {
    schemaVersion: 1,
    id: "bbbbbbbb-2222-4000-8000-000000000000",
    sourcePath: NOTE,
    sourceType: "markdown",
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    body: "margin card body",
    anchor: {
      kind: "markdown",
      startOffset: 0,
      endOffset: QUOTE.length,
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: QUOTE.length,
      quote: { exact: QUOTE }
    },
    replies: []
  };
}

/** Reading view as Obsidian renders it: a scroll container with a centred
 *  sizer, leaving a gutter on the right. */
function buildPreview(): { preview: HTMLElement; sizer: HTMLElement } {
  const preview = document.createElement("div");
  preview.className = "markdown-preview-view";
  const sizer = document.createElement("div");
  sizer.className = "markdown-preview-sizer";
  const p = document.createElement("p");
  p.textContent = `It is known that ${QUOTE}.`;
  sizer.appendChild(p);
  preview.appendChild(sizer);
  document.body.appendChild(preview);
  // Geometry: full-width preview, centred 400px column -> ~180px gutter.
  preview.getBoundingClientRect = () => ({
    left: 0, right: 800, top: 0, bottom: 900, width: 800, height: 900, x: 0, y: 0,
    toJSON: () => ({})
  });
  sizer.getBoundingClientRect = () => ({
    left: 200, right: 600, top: 0, bottom: 900, width: 400, height: 900, x: 200, y: 0,
    toJSON: () => ({})
  });
  return { preview, sizer };
}

function fakePlugin(annotations: Annotation[]): unknown {
  return {
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
    },
    store: { forSource: () => annotations },
    areMarginsSuppressed: () => false,
    register: () => undefined,
    app: {}
  };
}

describe("Reading view margin cards", () => {
  it("creates a margin card next to the marked passage", () => {
    const { preview } = buildPreview();
    processReadingView(
      preview.firstElementChild?.firstElementChild as HTMLElement,
      { sourcePath: NOTE } as never,
      fakePlugin([annotation()]) as never
    );
    const cards = preview.querySelectorAll(".marginalia-margin-card");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("margin card body");
    expect(preview.querySelector("[data-marginalia-id]")).not.toBeNull();
  });

  it("respects the show-resolved setting", () => {
    const { preview } = buildPreview();
    const resolved = { ...annotation(), status: "resolved" as const };
    processReadingView(
      preview.firstElementChild?.firstElementChild as HTMLElement,
      { sourcePath: NOTE } as never,
      fakePlugin([resolved]) as never
    );
    expect(preview.querySelectorAll(".marginalia-margin-card")).toHaveLength(0);
  });
});
