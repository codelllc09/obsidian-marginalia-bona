import { beforeEach, describe, expect, it } from "vitest";
import { describeReadingMargins, processReadingView, refreshReadingMargins } from "../src/reading/reading-renderer";
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
      marginWidth: 200,
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

describe("Reading view margins: layout race", () => {
  it("retries when the first pass measures no gutter", async () => {
    const { preview, sizer } = buildPreview();
    // First pass: not laid out yet.
    preview.getBoundingClientRect = () => ({
      left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
      toJSON: () => ({})
    });
    sizer.getBoundingClientRect = () => ({
      left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
      toJSON: () => ({})
    });
    processReadingView(
      preview.firstElementChild?.firstElementChild as HTMLElement,
      { sourcePath: NOTE } as never,
      fakePlugin([annotation()]) as never
    );
    expect(preview.querySelectorAll(".marginalia-margin-card")).toHaveLength(0);

    // Layout settles a moment later: the retry must produce the card.
    preview.getBoundingClientRect = () => ({
      left: 0, right: 800, top: 0, bottom: 900, width: 800, height: 900, x: 0, y: 0,
      toJSON: () => ({})
    });
    sizer.getBoundingClientRect = () => ({
      left: 200, right: 600, top: 0, bottom: 900, width: 400, height: 900, x: 200, y: 0,
      toJSON: () => ({})
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(preview.querySelectorAll(".marginalia-margin-card")).toHaveLength(1);
  });
});

describe("Reading view margins: repeat passes", () => {
  it("replaces cards instead of duplicating them", () => {
    const { preview } = buildPreview();
    const element = preview.firstElementChild?.firstElementChild as HTMLElement;
    const plugin = fakePlugin([annotation()]) as never;
    processReadingView(element, { sourcePath: NOTE } as never, plugin);
    processReadingView(element, { sourcePath: NOTE } as never, plugin);
    processReadingView(element, { sourcePath: NOTE } as never, plugin);
    expect(preview.querySelectorAll(".marginalia-margin-card")).toHaveLength(1);
    expect(preview.querySelectorAll(".marginalia-reading-margin-layer")).toHaveLength(1);
  });

  it("positions the card inside the gutter, not over the text", () => {
    const { preview } = buildPreview();
    processReadingView(
      preview.firstElementChild?.firstElementChild as HTMLElement,
      { sourcePath: NOTE } as never,
      fakePlugin([annotation()]) as never
    );
    const card = preview.querySelector<HTMLElement>(".marginalia-margin-card");
    expect(card).not.toBeNull();
    const left = Number.parseFloat(card?.style.left ?? "NaN");
    const width = Number.parseFloat(card?.style.width ?? "NaN");
    // Gutter starts at the sizer's right edge (600) plus the 10px gap.
    expect(left).toBe(610);
    expect(width).toBeGreaterThanOrEqual(72);
    expect(left + width).toBeLessThanOrEqual(800);
  });

  it("renders every located annotation, in document order", () => {
    const { preview } = buildPreview();
    const sizer = preview.firstElementChild as HTMLElement;
    const first = sizer.firstElementChild as HTMLElement;
    const second = document.createElement("p");
    second.textContent = "评估指标从 P@10 换到 NDCG@10 之后，排序质量的分歧被掩盖了一部分。";
    sizer.appendChild(second);
    const annotations = [
      annotation(),
      {
        ...annotation(),
        id: "cccccccc-3333-4000-8000-000000000000",
        anchor: {
          ...annotation().anchor,
          quote: {
            exact: "评估指标从 `P@10` 换到 `NDCG@10` 之后，排序质量的分歧被掩盖了一部分"
          },
          originalQuote: "评估指标从 `P@10` 换到 `NDCG@10` 之后，排序质量的分歧被掩盖了一部分"
        }
      }
    ];
    const plugin = fakePlugin(annotations) as never;
    processReadingView(first, { sourcePath: NOTE } as never, plugin);
    processReadingView(second, { sourcePath: NOTE } as never, plugin);
    expect(preview.querySelectorAll(".marginalia-margin-card")).toHaveLength(2);
  });
});

describe("Reading view margins: settings guards", () => {
  it("falls back to a sane width when marginWidth is missing", () => {
    const { preview } = buildPreview();
    const plugin = fakePlugin([annotation()]) as { settings: Record<string, unknown> };
    delete plugin.settings.marginWidth;
    processReadingView(
      preview.firstElementChild?.firstElementChild as HTMLElement,
      { sourcePath: NOTE } as never,
      plugin as never
    );
    const card = preview.querySelector<HTMLElement>(".marginalia-margin-card");
    expect(card).not.toBeNull();
    const width = Number.parseFloat(card?.style.width ?? "NaN");
    expect(Number.isFinite(width)).toBe(true);
    expect(width).toBeGreaterThanOrEqual(72);
  });
});

describe("Reading view margins: diagnostics", () => {
  it("records the reason a pass placed no cards", () => {
    const { preview, sizer } = buildPreview();
    const zero = () => ({
      left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
      toJSON: () => ({})
    });
    preview.getBoundingClientRect = zero;
    sizer.getBoundingClientRect = zero;
    const plugin = fakePlugin([annotation()]);
    processReadingView(
      preview.firstElementChild?.firstElementChild as HTMLElement,
      { sourcePath: NOTE } as never,
      plugin as never
    );
    const rows = describeReadingMargins(plugin as never);
    expect(rows).toHaveLength(1);
    expect((rows[0]?.lastPass as { reason?: string }).reason).toBe("no-gutter");
    expect(rows[0]?.cards).toBe(0);
  });

  it("records a rendered pass with geometry", () => {
    const { preview } = buildPreview();
    const plugin = fakePlugin([annotation()]);
    processReadingView(
      preview.firstElementChild?.firstElementChild as HTMLElement,
      { sourcePath: NOTE } as never,
      plugin as never
    );
    const rows = describeReadingMargins(plugin as never);
    const pass = rows[0]?.lastPass as { reason?: string; cards?: number };
    expect(pass.reason).toBe("rendered");
    expect(pass.cards).toBe(1);
  });
});

describe("Reading view margins: unknown container classes", () => {
  it("finds the scroll host when Obsidian renames its classes", () => {
    // Obsidian's class names are not a stable API: this DOM has none of the
    // names we used to depend on, only a scrolling wrapper.
    const leaf = document.createElement("div");
    leaf.className = "workspace-leaf-content";
    leaf.dataset.type = "markdown";
    const root = document.createElement("div");
    root.className = "markdown-reading-root";
    // The scroller only reveals itself by its scroll range: no overflow
    // declaration, no recognisable class name.
    Object.defineProperty(root, "scrollHeight", { value: 2400, configurable: true });
    Object.defineProperty(root, "clientHeight", { value: 900, configurable: true });
    root.getBoundingClientRect = () => ({
      left: 0, right: 800, top: 0, bottom: 900, width: 800, height: 900, x: 0, y: 0,
      toJSON: () => ({})
    });
    const body = document.createElement("div");
    body.className = "preview-body";
    const block = document.createElement("p");
    block.className = "preview-block";
    block.textContent = "Maxwell's electrodynamics leads to asymmetries in moving bodies.";
    block.getBoundingClientRect = () => ({
      left: 200, right: 600, top: 100, bottom: 160, width: 400, height: 60, x: 200, y: 100,
      toJSON: () => ({})
    });
    body.appendChild(block);
    root.appendChild(body);
    leaf.appendChild(root);
    document.body.appendChild(leaf);

    processReadingView(
      block,
      { sourcePath: NOTE } as never,
      fakePlugin([annotation()]) as never
    );

    const layer = root.querySelector(".marginalia-reading-margin-layer");
    expect(layer).not.toBeNull();
    expect(root.querySelectorAll(".marginalia-margin-card")).toHaveLength(1);
  });
});

describe("Reading view margins: post-processor runs before insertion", () => {
  it("waits for the block to be attached, then marks and places cards", async () => {
    const { preview } = buildPreview();
    const element = preview.firstElementChild?.firstElementChild as HTMLElement;
    // Obsidian's real order: the section is rendered off-document, the
    // post-processor runs, and only then is the section inserted.
    preview.remove();
    processReadingView(
      element,
      { sourcePath: NOTE } as never,
      fakePlugin([annotation()]) as never
    );
    expect(preview.querySelectorAll(".marginalia-margin-card")).toHaveLength(0);

    document.body.appendChild(preview);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(preview.querySelectorAll("span[data-marginalia-id]")).toHaveLength(1);
    expect(preview.querySelectorAll(".marginalia-margin-card")).toHaveLength(1);
  });
});

describe("Reading view margins: layer height", () => {
  it("does not feed its own height back into the scroll area", () => {
    const { preview } = buildPreview();
    const plugin = fakePlugin([annotation()]);
    processReadingView(
      preview.firstElementChild?.firstElementChild as HTMLElement,
      { sourcePath: NOTE } as never,
      plugin as never
    );
    const height = Number.parseFloat(
      preview.querySelector<HTMLElement>(".marginalia-reading-margin-layer")
        ?.style.height ?? "NaN"
    );
    // Content height (900) plus slack, never an inflated scrollHeight.
    expect(Number.isFinite(height)).toBe(true);
    expect(height).toBeLessThan(1500);
  });
});

describe("Reading view margins: marks survive a replaced section", () => {
  it("re-applies the mark when the pass runs on the live preview", () => {
    const { preview } = buildPreview();
    const plugin = fakePlugin([annotation()]);
    const block = preview.firstElementChild?.firstElementChild as HTMLElement;
    processReadingView(block, { sourcePath: NOTE } as never, plugin as never);
    expect(preview.querySelectorAll("span[data-marginalia-id]")).toHaveLength(1);

    // Obsidian re-renders the section: the marked node is gone, the text is new.
    const sizer = preview.firstElementChild as HTMLElement;
    const rebuilt = document.createElement("p");
    rebuilt.textContent = "Maxwell's electrodynamics leads to asymmetries in moving bodies.";
    sizer.replaceChildren(rebuilt);
    expect(preview.querySelectorAll("span[data-marginalia-id]")).toHaveLength(0);

    refreshReadingMargins(plugin as never);
    expect(preview.querySelectorAll("span[data-marginalia-id]")).toHaveLength(1);
  });
});

describe("Reading view margins: geometry matrix", () => {
  const PANES = [1400, 1100, 900, 760];
  const FONTS = [14, 16, 20];
  const CARDS = [160, 200, 260];

  it("places every card inside the pane across widths, fonts and card sizes", () => {
    for (const paneWidth of PANES) {
      for (const fontSize of FONTS) {
        for (const cardWidth of CARDS) {
          const { preview, sizer } = buildPreview();
          preview.style.fontSize = `${fontSize}px`;
          preview.getBoundingClientRect = () => ({
            left: 0, right: paneWidth, top: 0, bottom: 900,
            width: paneWidth, height: 900, x: 0, y: 0, toJSON: () => ({})
          });
          const column = Math.min(700, paneWidth - 2 * (cardWidth + 18));
          const left = (paneWidth - column) / 2;
          sizer.getBoundingClientRect = () => ({
            left, right: left + column, top: 0, bottom: 900,
            width: column, height: 900, x: left, y: 0, toJSON: () => ({})
          });
          const plugin = fakePlugin([annotation()]) as {
            settings: { marginWidth: number };
          };
          plugin.settings.marginWidth = cardWidth;

          processReadingView(
            preview.firstElementChild?.firstElementChild as HTMLElement,
            { sourcePath: NOTE } as never,
            plugin as never
          );

          const cards = Array.from(
            preview.querySelectorAll<HTMLElement>(".marginalia-margin-card")
          );
          for (const card of cards) {
            const cardLeft = Number.parseFloat(card.style.left);
            const cardRight = cardLeft + Number.parseFloat(card.style.width);
            expect(Number.isFinite(cardLeft)).toBe(true);
            expect(cardLeft).toBeGreaterThanOrEqual(0);
            expect(cardRight).toBeLessThanOrEqual(paneWidth);
            expect(Number.parseFloat(card.style.width)).toBeLessThanOrEqual(
              cardWidth
            );
          }
        }
      }
    }
  });
});
