import { describe, expect, it } from "vitest";
import { attachmentPath } from "../src/attachments";

const now = new Date("2026-10-25T12:00:00.000Z");
// 2026-10-25T12:00:00.000Z -> "2026-10-25T12-00-00-000Z"
const stamp = "2026-10-25T12-00-00-000Z";

describe("attachmentPath", () => {
  it("builds a timestamped path inside the folder", () => {
    expect(attachmentPath("Marginalia attachments", "png", now, () => false)).toBe(
      `Marginalia attachments/pasted-${stamp}.png`
    );
  });

  it("suffixes -2/-3 on collisions", () => {
    const taken = new Set([
      `Marginalia attachments/pasted-${stamp}.png`,
      `Marginalia attachments/pasted-${stamp}-2.png`
    ]);
    const path = attachmentPath("Marginalia attachments", "png", now, (p) =>
      taken.has(p)
    );
    expect(path).toBe(`Marginalia attachments/pasted-${stamp}-3.png`);
  });

  it("defaults the extension to png and lowercases it", () => {
    expect(attachmentPath("att", "", now, () => false)).toBe(
      `att/pasted-${stamp}.png`
    );
    expect(attachmentPath("att", "JPEG", now, () => false)).toBe(
      `att/pasted-${stamp}.jpeg`
    );
  });
});
