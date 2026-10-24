import { Annotation } from "../domain/annotation";
import { ExportContext, ExportFormat } from "./export-format";

function positionOf(annotation: Annotation): number {
  return annotation.anchor.kind === "markdown"
    ? annotation.anchor.startLine
    : annotation.anchor.kind === "pdf"
      ? annotation.anchor.page
      : Number.MAX_SAFE_INTEGER;
}

function quoteBlock(lines: string): string {
  return lines
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function styleHints(annotation: Annotation): string[] {
  const hints: string[] = [];
  if (annotation.color) hints.push(annotation.color);
  if (annotation.markStyle) hints.push(annotation.markStyle);
  if (annotation.status !== "open") hints.push(annotation.status);
  return hints;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
}

function renderThread(annotation: Annotation, index: number): string {
  const parts: string[] = [];
  const quote =
    annotation.anchor.kind === "document"
      ? ""
      : annotation.anchor.quote.exact.trim();
  const title = quote.split("\n")[0].slice(0, 60) || "Note";
  const location =
    annotation.anchor.kind === "markdown"
      ? `line ${annotation.anchor.startLine + 1}`
      : annotation.anchor.kind === "pdf"
        ? `page ${annotation.anchor.page}`
        : "";

  parts.push(`## ${index + 1}. ${title}`);
  parts.push(
    [location, ...styleHints(annotation)].filter(Boolean).join(" · ")
  );
  if (quote) {
    parts.push(quoteBlock(quote));
  }

  const meta = [
    `**${annotation.author ?? "user"}**`,
    formatTime(annotation.createdAt)
  ].join(" · ");
  parts.push(meta);
  parts.push(annotation.body.trimEnd());

  for (const reply of annotation.replies) {
    const replyMeta = [
      `**${reply.author ?? "user"}**`,
      formatTime(reply.createdAt)
    ].join(" · ");
    parts.push(quoteBlock(`${replyMeta}\n${reply.body.trimEnd()}`));
  }

  return parts.join("\n\n");
}

/** Human-readable Markdown digest of one note's annotations. */
export const markdownExportFormat: ExportFormat = {
  id: "markdown",
  label: "Markdown",
  fileExtension: "md",
  render(annotations: Annotation[], context: ExportContext): string {
    const sorted = [...annotations].sort(
      (a, b) => positionOf(a) - positionOf(b)
    );
    const name = context.sourcePath.split("/").pop() ?? context.sourcePath;
    const header = [
      `# Annotations — ${name}`,
      "",
      `_${sorted.length} annotation${sorted.length === 1 ? "" : "s"} · exported ${formatTime(context.exportedAt)} from \`${context.sourcePath}\`_`
    ].join("\n");
    const body = sorted.map(renderThread).join("\n\n---\n\n");
    return `${header}\n\n${body}\n`;
  }
};
