import { describe, expect, it } from "vitest";
import { hoverModeAllows } from "../src/hover/hover-preview";

describe("hoverModeAllows", () => {
  it("never allows in off mode, even with modifiers", () => {
    expect(hoverModeAllows("off", { ctrlKey: false, metaKey: false })).toBe(false);
    expect(hoverModeAllows("off", { ctrlKey: true, metaKey: true })).toBe(false);
  });

  it("always allows in hover mode", () => {
    expect(hoverModeAllows("hover", { ctrlKey: false, metaKey: false })).toBe(true);
    expect(hoverModeAllows("hover", { ctrlKey: true, metaKey: false })).toBe(true);
  });

  it("requires ctrl/cmd in ctrl mode", () => {
    expect(hoverModeAllows("ctrl", { ctrlKey: false, metaKey: false })).toBe(false);
    expect(hoverModeAllows("ctrl", { ctrlKey: true, metaKey: false })).toBe(true);
    expect(hoverModeAllows("ctrl", { ctrlKey: false, metaKey: true })).toBe(true);
  });
});
