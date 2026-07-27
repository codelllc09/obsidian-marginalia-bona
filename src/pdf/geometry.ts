import { PdfRectangle } from "../domain/annotation";

export interface RectangleLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeRectangle(
  rectangle: RectangleLike,
  page: RectangleLike
): PdfRectangle | null {
  const width = page.right - page.left;
  const height = page.bottom - page.top;
  if (width <= 0 || height <= 0) return null;
  const left = clamp((rectangle.left - page.left) / width);
  const top = clamp((rectangle.top - page.top) / height);
  const right = clamp((rectangle.right - page.left) / width);
  const bottom = clamp((rectangle.bottom - page.top) / height);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

export function rectangleCss(
  rectangle: PdfRectangle,
  coordinateSpace: "normalized" | "css-pixels"
): Pick<CSSStyleDeclaration, "left" | "top" | "width" | "height"> {
  if (coordinateSpace === "normalized") {
    const percent = (value: number): string =>
      `${Number((value * 100).toFixed(6))}%`;
    return {
      left: percent(rectangle.left),
      top: percent(rectangle.top),
      width: percent(rectangle.right - rectangle.left),
      height: percent(rectangle.bottom - rectangle.top)
    } as Pick<CSSStyleDeclaration, "left" | "top" | "width" | "height">;
  }
  return {
    left: `${rectangle.left}px`,
    top: `${rectangle.top}px`,
    width: `${rectangle.right - rectangle.left}px`,
    height: `${rectangle.bottom - rectangle.top}px`
  } as Pick<CSSStyleDeclaration, "left" | "top" | "width" | "height">;
}
