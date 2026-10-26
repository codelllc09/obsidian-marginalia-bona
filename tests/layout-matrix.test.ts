import { describe, expect, it } from "vitest";
import {
  GAP,
  EDGE,
  minColumnFor,
  minGutterFor,
  planColumnCap,
  planPlacement
} from "../src/domain/layout";

/** Realistic CSS widths: 1080p@100% down to a split pane, and 4K@200%. */
const PANES = [520, 640, 756, 800, 900, 1056, 1280, 1400, 1556, 1920, 2560];
const FONT_SIZES = [12, 13, 14, 16, 18, 20, 24];
const CARD_WIDTHS = [160, 200, 260, 420];
const LINE_WIDTHS = [0, 600, 700, 800];

describe("planPlacement", () => {
  it("always returns a card that fits inside the pane", () => {
    for (const paneWidth of PANES) {
      for (const fontSize of FONT_SIZES) {
        for (const cardWidth of CARD_WIDTHS) {
          for (const columnWidth of [400, 640, 700, paneWidth]) {
            const columnLeft = Math.max(0, (paneWidth - columnWidth) / 2);
            const placement = planPlacement({
              paneWidth,
              columnLeft,
              columnWidth,
              cardWidth,
              fontSize,
              preferred: "auto"
            });
            if (!placement) continue;
            expect(placement.left).toBeGreaterThanOrEqual(0);
            expect(placement.left + placement.width).toBeLessThanOrEqual(
              paneWidth + 0.5
            );
            expect(placement.width).toBeLessThanOrEqual(cardWidth);
            expect(placement.available).toBeGreaterThanOrEqual(
              minGutterFor(fontSize)
            );
          }
        }
      }
    }
  });

  it("prefers the right margin when both sides have room", () => {
    const placement = planPlacement({
      paneWidth: 1400,
      columnLeft: 350,
      columnWidth: 700,
      cardWidth: 200,
      fontSize: 16,
      preferred: "auto"
    });
    expect(placement?.side).toBe("right");
  });

  it("falls back to the left only when the right is unusable", () => {
    const placement = planPlacement({
      paneWidth: 1400,
      columnLeft: 600,
      columnWidth: 780,
      cardWidth: 200,
      fontSize: 16,
      preferred: "auto"
    });
    // right gutter = 1400 - 1380 - 18 = 2px: unusable.
    expect(placement?.side).toBe("left");
  });

  it("honours an explicit side even when it is tighter", () => {
    const base = {
      paneWidth: 1400,
      columnLeft: 500,
      columnWidth: 640,
      cardWidth: 200,
      fontSize: 16
    };
    expect(planPlacement({ ...base, preferred: "left" })?.side).toBe("left");
    expect(planPlacement({ ...base, preferred: "right" })?.side).toBe("right");
  });

  it("gives up when neither side is wide enough", () => {
    const placement = planPlacement({
      paneWidth: 700,
      columnLeft: 20,
      columnWidth: 660,
      cardWidth: 200,
      fontSize: 16,
      preferred: "auto"
    });
    expect(placement).toBeNull();
  });

  it("scales the threshold with the text size", () => {
    const geometry = {
      paneWidth: 900,
      columnLeft: 80,
      columnWidth: 700,
      cardWidth: 200,
      preferred: "auto" as const
    };
    // 102px on the right: fine at 12px text (96px threshold), not at 24px (192).
    expect(planPlacement({ ...geometry, fontSize: 12 })).not.toBeNull();
    expect(planPlacement({ ...geometry, fontSize: 24 })).toBeNull();
  });

  it("survives a missing or invalid card width", () => {
    for (const cardWidth of [Number.NaN, 0, -50]) {
      const placement = planPlacement({
        paneWidth: 1400,
        columnLeft: 350,
        columnWidth: 700,
        cardWidth,
        fontSize: 16,
        preferred: "auto"
      });
      expect(placement?.width).toBeGreaterThan(0);
    }
  });
});

describe("planColumnCap", () => {
  it("never caps below the readable minimum, and always leaves a full card", () => {
    for (const paneWidth of PANES) {
      for (const fontSize of FONT_SIZES) {
        for (const cardWidth of CARD_WIDTHS) {
          for (const configuredLineWidth of LINE_WIDTHS) {
            const decision = planColumnCap({
              paneWidth,
              cardWidth,
              fontSize,
              configuredLineWidth
            });
            if (decision.cap === null) {
              expect(decision.ideal).toBeLessThan(minColumnFor(fontSize));
              continue;
            }
            expect(decision.cap).toBeGreaterThanOrEqual(
              minColumnFor(fontSize)
            );
            // The capped column is centred: each side must fit the card.
            const gutter = (paneWidth - decision.cap) / 2;
            expect(gutter).toBeGreaterThanOrEqual(cardWidth + GAP + EDGE);
          }
        }
      }
    }
  });

  it("respects the configured reading width when there is room to spare", () => {
    const decision = planColumnCap({
      paneWidth: 1920,
      cardWidth: 200,
      fontSize: 16,
      configuredLineWidth: 700
    });
    expect(decision.cap).toBe(700);
  });

  it("shrinks below the configured width when the pane is narrow", () => {
    const decision = planColumnCap({
      paneWidth: 1056,
      cardWidth: 200,
      fontSize: 16,
      configuredLineWidth: 700
    });
    expect(decision.cap).toBe(1056 - 2 * (200 + GAP + EDGE));
  });

  it("refuses to cap when the pane cannot keep a readable column", () => {
    const decision = planColumnCap({
      paneWidth: 756,
      cardWidth: 200,
      fontSize: 16,
      configuredLineWidth: 700
    });
    expect(decision.cap).toBeNull();
  });

  it("falls back to 700px when the reading width is missing", () => {
    const decision = planColumnCap({
      paneWidth: 1920,
      cardWidth: 200,
      fontSize: 16,
      configuredLineWidth: Number.NaN
    });
    expect(decision.cap).toBe(700);
  });
});
