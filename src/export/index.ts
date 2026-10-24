import { ExportFormat } from "./export-format";
import { markdownExportFormat } from "./markdown-format";

/** Registry of export targets. Add a format here and it becomes available. */
export const EXPORT_FORMATS: readonly ExportFormat[] = [markdownExportFormat];

export function getExportFormat(id: string): ExportFormat | undefined {
  return EXPORT_FORMATS.find((format) => format.id === id);
}

export type { ExportContext, ExportFormat } from "./export-format";
