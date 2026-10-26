/**
 * Margin layout maths, isolated from the DOM so it can be tested across pane
 * widths, font sizes, card widths and theme line widths.
 *
 * Two decisions:
 *  1. where a card goes, given the pane and the text column the theme renders;
 *  2. whether the plugin must cap the text column itself so a card fits.
 */

export interface PlacementInput {
  /** Width of the scrolling pane (editor or reading view). */
  paneWidth: number;
  /** Left edge of the text column, relative to the pane. */
  columnLeft: number;
  columnWidth: number;
  /** Configured card width; falls back when the setting is missing/NaN. */
  cardWidth: number;
  fontSize: number;
  preferred: "auto" | "left" | "right";
}

export interface Placement {
  side: "left" | "right";
  width: number;
  /** Card left edge, relative to the pane. */
  left: number;
  available: number;
}

export interface CapInput {
  paneWidth: number;
  cardWidth: number;
  fontSize: number;
  /** Observable reading width (`--file-line-width`), 700 by default. */
  configuredLineWidth: number;
}

export interface CapDecision {
  /** Width to cap the column at, or null when the pane is too narrow. */
  cap: number | null;
  /** Minimum column width that still counts as readable. */
  minColumn: number;
  /** Width the cap would have used. */
  ideal: number;
}

export const GAP = 10;
export const EDGE = 8;
const DEFAULT_CARD_WIDTH = 200;
const DEFAULT_LINE_WIDTH = 700;
/** A gutter smaller than this is not usable for a card. */
export function minGutterFor(fontSize: number): number {
  return Math.max(72, Math.round((Number.isFinite(fontSize) ? fontSize : 16) * 8));
}
/** Below this the text column itself would be unreadable. */
export function minColumnFor(fontSize: number): number {
  return Math.round((Number.isFinite(fontSize) ? fontSize : 16) * 34);
}

function saneCardWidth(cardWidth: number): number {
  return Number.isFinite(cardWidth) && cardWidth > 0
    ? cardWidth
    : DEFAULT_CARD_WIDTH;
}

export function planPlacement(input: PlacementInput): Placement | null {
  const { paneWidth, columnLeft, columnWidth, fontSize, preferred } = input;
  const cardWidth = saneCardWidth(input.cardWidth);
  const minRoom = minGutterFor(fontSize);
  const leftSpace = Math.max(0, columnLeft - GAP - EDGE);
  const rightSpace = Math.max(
    0,
    paneWidth - (columnLeft + columnWidth) - GAP - EDGE
  );
  // "auto" prefers the right margin; a scrollbar's few pixels must not flip it.
  const side: "left" | "right" =
    preferred === "auto"
      ? rightSpace >= minRoom
        ? "right"
        : leftSpace >= minRoom
          ? "left"
          : leftSpace > rightSpace
            ? "left"
            : "right"
      : preferred;
  const available = side === "left" ? leftSpace : rightSpace;
  if (available < minRoom) return null;
  const width = Math.min(cardWidth, available);
  return {
    side,
    width,
    available,
    left:
      side === "left"
        ? columnLeft - GAP - width
        : columnLeft + columnWidth + GAP
  };
}

export function planColumnCap(input: CapInput): CapDecision {
  const { paneWidth, fontSize } = input;
  const cardWidth = saneCardWidth(input.cardWidth);
  const minColumn = minColumnFor(fontSize);
  const configured =
    Number.isFinite(input.configuredLineWidth) && input.configuredLineWidth > 0
      ? input.configuredLineWidth
      : DEFAULT_LINE_WIDTH;
  // The capped column is centred, so keep a whole card's width on each side.
  const ideal = Math.round(
    Math.min(configured, paneWidth - 2 * (cardWidth + GAP + EDGE))
  );
  const cap = ideal >= minColumn ? ideal : null;
  return { cap, minColumn, ideal };
}
