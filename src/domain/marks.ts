import { Annotation, MarkStyle } from "./annotation";

/** Color swatches offered when creating or editing an annotation. */
export const MARK_COLORS: readonly string[] = [
  "#ffd54f", // yellow
  "#ffab91", // orange
  "#a5d6a7", // green
  "#90caf9", // blue
  "#ce93d8", // purple
  "#ef9a9a" // red
] as const;

export function resolveMarkStyle(
  annotation: Pick<Annotation, "markStyle">,
  defaultStyle: MarkStyle
): MarkStyle {
  return annotation.markStyle ?? defaultStyle;
}

export function resolveMarkColor(
  annotation: Pick<Annotation, "color">,
  defaultColor: string
): string {
  return annotation.color ?? defaultColor;
}

/** Class + inline style shared by editor, reading view, and PDF marks. */
export function markPresentation(
  annotation: Pick<Annotation, "markStyle" | "color">,
  defaults: { defaultStyle: MarkStyle; defaultColor: string; opacity: number }
): { class: string; style: string } {
  const style = resolveMarkStyle(annotation, defaults.defaultStyle);
  const color = resolveMarkColor(annotation, defaults.defaultColor);
  return {
    class: `siden-highlight siden-mark-${style}`,
    style: `--siden-mark-color: ${color}; --siden-mark-opacity: ${defaults.opacity}`
  };
}
