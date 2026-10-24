import { describe, expect, it } from "vitest";
import {
  attachmentPath,
  attachmentsFolderFor
} from "../src/attachments";

const now = new Date("2026-10-25T12:00:00.000Z");
// 2026-10-25T12:00:00.000Z -> "2026-10-25T12-00-00-000Z"
const stamp = "2026-10-25T12-00-00-000Z";

describe("attachmentsFolderFor", () => {
  it("override wins over the convention", () => {
    expect(
      attachmentsFolderFor("My Pics", "attachments", "Notes")
    ).toBe("My Pics");
  });

  it("empty override follows the convention", () => {
    expect(attachmentsFolderFor("", "/", "Notes")).toBe("");
    expect(attachmentsFolderFor("   ", "attachments", "Notes")).toBe(
      "attachments"
    );
    expect(attachmentsFolderFor("", "./assets", "Notes/Daily")).toBe(
      "Notes/Daily/assets"
    );
    expect(attachmentsFolderFor("", "./assets", "")).toBe("assets");
  });

  it("defaults to vault root when the convention is unset", () => {
    expect(attachmentsFolderFor("", "", "Notes")).toBe("");
  });
});

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
