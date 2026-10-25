import { describe, expect, it } from "vitest";
import { attachmentPath, attachmentsFolderFor } from "../src/attachments";
import { markdownExportFormat } from "../src/export/markdown-format";
import type { Annotation } from "../src/domain/annotation";
import type { ExportContext } from "../src/export/export-format";

describe("attachments folder resolution", () => {
  it("override wins over the Obsidian convention", () => {
    expect(attachmentsFolderFor("MyClips", "assets", "Notes")).toBe("MyClips");
    expect(attachmentsFolderFor("  spaced  ", "assets", "Notes")).toBe("spaced");
  });

  it("vault-root convention maps to the empty folder", () => {
    expect(attachmentsFolderFor("", "/", "Notes")).toBe("");
    expect(attachmentsFolderFor("", "", "Notes")).toBe("");
  });

  it("subfolder convention (./x) lands next to the annotated note", () => {
    expect(attachmentsFolderFor("", "./clips", "Notes/Daily")).toBe("Notes/Daily/clips");
    // Without a source dir it resolves from the vault root.
    expect(attachmentsFolderFor("", "./clips", "")).toBe("clips");
  });

  it("plain folder conventions pass through normalized", () => {
    expect(attachmentsFolderFor("", "attachments", "Notes")).toBe("attachments");
  });
});

describe("attachment file naming", () => {
  const NOW = new Date("2026-01-01T00:00:00.000Z");

  it("suffixes -2, -3 on collisions and defaults the extension", () => {
    const taken = new Set<string>();
    const first = attachmentPath("assets", "", NOW, (p) => taken.has(p));
    taken.add(first);
    const second = attachmentPath("assets", "", NOW, (p) => taken.has(p));
    expect(first).not.toBe(second);
    expect(first.endsWith(".png")).toBe(true);
    expect(second).toMatch(/pasted-.*-2\.png$/);
  });

  it("sanitizes hostile extensions into plain suffixes", () => {
    const evil = attachmentPath("assets", "../../evil", NOW, () => false);
    expect(evil).not.toContain("..");
    expect(evil.startsWith("assets/")).toBe(true);
    const junk = attachmentPath("assets", "P NG/?:x", NOW, () => false);
    expect(junk).toMatch(/^assets\/pasted-[0-9T-]+Z\.pngx$/); // ext fully sanitized
  });

  it("keeps timestamps filesystem-safe", () => {
    const path = attachmentPath("assets", "png", NOW, () => false);
    expect(path).not.toMatch(/:|\s/);
  });
});

function make(overrides: Partial<Annotation> = {}): Annotation {
  return {
    schemaVersion: 1,
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    sourcePath: "Notes/Test.md",
    sourceType: "markdown",
    status: "open",
    createdAt: "2026-01-01T05:06:00.000Z",
    updatedAt: "2026-01-01T05:06:00.000Z",
    body: "Root thought.",
    anchor: {
      kind: "markdown",
      startOffset: 0,
      endOffset: 4,
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: 4,
      quote: { exact: "body", prefix: "", suffix: "" }
    },
    replies: [],
    ...overrides
  };
}

const CONTEXT: ExportContext = {
  sourcePath: "Notes/Test.md",
  exportedAt: "2026-02-01T00:00:00.000Z"
};

describe("markdown export", () => {
  it("renders a numbered digest ordered by document position", () => {
    const late = make({
      id: "1",
      anchor: { kind: "markdown", startOffset: 30, endOffset: 34, startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 4, quote: { exact: "tail", prefix: "", suffix: "" } }
    });
    const early = make({ id: "2" });
    const text = markdownExportFormat.render([late, early], CONTEXT);
    expect(text).toContain("# Annotations — Test.md");
    expect(text).toContain("_2 annotations");
    expect(text.indexOf("1. body")).toBeLessThan(text.indexOf("2. tail"));
    expect(text).toContain("> body");
    expect(text).toContain("**user**");
  });

  it("sorts document anchors last and pdf by page", () => {
    const doc = make({ id: "d", anchor: { kind: "document" } });
    const md = make({ id: "m" });
    expect(markdownExportFormat.render([doc, md], CONTEXT).indexOf("1. body"))
      .toBeLessThan(markdownExportFormat.render([doc, md], CONTEXT).indexOf("2. Note"));
    const pdf = make({
      id: "p",
      sourceType: "pdf",
      anchor: { kind: "pdf", page: 3, quote: { exact: "pdf text" }, rectangles: [] }
    });
    const text = markdownExportFormat.render([pdf], CONTEXT);
    expect(text).toContain("page 3");
  });

  it("renders replies as quote blocks with authors", () => {
    const annotation = make({
      replies: [{ id: "r", createdAt: "2026-01-02T00:00:00.000Z", author: "Pi", body: "seconded" }]
    });
    const text = markdownExportFormat.render([annotation], CONTEXT);
    expect(text).toContain("**Pi**");
    expect(text).toContain("> seconded");
  });

  it("survives empty input and hostile quote content", () => {
    const empty = markdownExportFormat.render([], CONTEXT);
    expect(empty).toContain("_0 annotations");
    const hostile = make({
      anchor: { kind: "markdown", startOffset: 0, endOffset: 4, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 4, quote: { exact: "line1\nline2 | **bold**", prefix: "", suffix: "" } }
    });
    const text = markdownExportFormat.render([hostile], CONTEXT);
    expect(text).toContain("> line1");
    expect(text).toContain("> line2 | **bold**");
  });

  it("shows status and style hints when set", () => {
    const annotated = make({ status: "resolved", color: "#ffcc00", markStyle: "wavy" });
    const text = markdownExportFormat.render([annotated], CONTEXT);
    expect(text).toContain("#ffcc00");
    expect(text).toContain("wavy");
    expect(text).toContain("resolved");
  });
});
