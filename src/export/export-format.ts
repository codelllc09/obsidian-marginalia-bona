import { Annotation } from "../domain/annotation";

/** Shared inputs every export format receives. */
export interface ExportContext {
  /** Vault path of the annotated source note. */
  sourcePath: string;
  /** ISO timestamp of the export run. */
  exportedAt: string;
}

/** One export target (Markdown today; other formats can join later). */
export interface ExportFormat {
  id: string;
  label: string;
  /** File extension WITHOUT the dot, e.g. "md". */
  fileExtension: string;
  render(annotations: Annotation[], context: ExportContext): string;
}
