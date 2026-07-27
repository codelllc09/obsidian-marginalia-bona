import { describe, expect, it } from "vitest";
import {
  normalizeRectangle,
  rectangleCss
} from "../src/pdf/geometry";

describe("PDF highlight geometry", () => {
  it("normalizes a client rectangle against its page", () => {
    expect(
      normalizeRectangle(
        { left: 150, top: 240, right: 350, bottom: 280 },
        { left: 50, top: 40, right: 450, bottom: 840 }
      )
    ).toEqual({
      left: 0.25,
      top: 0.25,
      right: 0.75,
      bottom: 0.3
    });
  });

  it("produces zoom-independent percentage styles", () => {
    const rectangle = {
      left: 0.25,
      top: 0.1,
      right: 0.75,
      bottom: 0.15
    };
    expect(rectangleCss(rectangle, "normalized")).toEqual({
      left: "25%",
      top: "10%",
      width: "50%",
      height: "5%"
    });
  });

  it("keeps legacy pixel annotations renderable", () => {
    expect(
      rectangleCss(
        { left: 10, top: 20, right: 110, bottom: 44 },
        "css-pixels"
      )
    ).toEqual({
      left: "10px",
      top: "20px",
      width: "100px",
      height: "24px"
    });
  });

  it("clips selection rectangles to page bounds", () => {
    expect(
      normalizeRectangle(
        { left: -10, top: 90, right: 120, bottom: 110 },
        { left: 0, top: 0, right: 100, bottom: 100 }
      )
    ).toEqual({ left: 0, top: 0.9, right: 1, bottom: 1 });
  });
});
