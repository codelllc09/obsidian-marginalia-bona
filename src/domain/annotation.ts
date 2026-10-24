export const ANNOTATION_SCHEMA_VERSION = 1 as const;

export type AnnotationStatus = "open" | "resolved" | "orphaned";
export type SourceType = "markdown" | "pdf";

/** How a single annotation marks its anchored text. */
export type MarkStyle =
  | "highlight"
  | "underline"
  | "wavy"
  | "strikethrough"
  | "bold";

export const MARK_STYLES: readonly MarkStyle[] = [
  "highlight",
  "underline",
  "wavy",
  "strikethrough",
  "bold"
] as const;

export function isMarkStyle(value: unknown): value is MarkStyle {
  return typeof value === "string" && (MARK_STYLES as readonly string[]).includes(value);
}

/** One reply inside an annotation's discussion thread. */
export interface AnnotationReply {
  id: string;
  createdAt: string;
  body: string;
}

export interface TextQuote {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface MarkdownAnchor {
  kind: "markdown";
  startOffset: number;
  endOffset: number;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  quote: TextQuote;
  quoteHash?: string;
}

export interface PdfRectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PdfAnchor {
  kind: "pdf";
  page: number;
  quote: TextQuote;
  rectangles: PdfRectangle[];
  coordinateSpace?: "normalized" | "css-pixels";
  selection?: number[];
  documentFingerprint?: string;
}

export interface DocumentAnchor {
  kind: "document";
}

export type AnnotationAnchor =
  | MarkdownAnchor
  | PdfAnchor
  | DocumentAnchor;

export interface Annotation {
  schemaVersion: typeof ANNOTATION_SCHEMA_VERSION;
  id: string;
  sourcePath: string;
  sourceType: SourceType;
  status: AnnotationStatus;
  createdAt: string;
  updatedAt: string;
  body: string;
  anchor: AnnotationAnchor;
  /** Per-annotation color (hex). Falls back to the default highlight color. */
  color?: string;
  /** Per-annotation mark style. Falls back to the default mark style. */
  markStyle?: MarkStyle;
  /** Discussion thread; replies stay in the same file as the root note. */
  replies: AnnotationReply[];
}

export type NewAnnotation = Omit<
  Annotation,
  "schemaVersion" | "id" | "createdAt" | "updatedAt" | "replies"
> & {
  id?: string;
  createdAt?: string;
  replies?: AnnotationReply[];
};

export function assertAnnotation(value: unknown): asserts value is Annotation {
  if (!value || typeof value !== "object") {
    throw new Error("Annotation must be an object.");
  }

  const annotation = value as Partial<Annotation>;
  if (annotation.schemaVersion !== ANNOTATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported annotation schema: ${annotation.schemaVersion}`);
  }
  if (!annotation.id || typeof annotation.id !== "string") {
    throw new Error("Annotation id is required.");
  }
  if (!annotation.sourcePath || typeof annotation.sourcePath !== "string") {
    throw new Error("Annotation source path is required.");
  }
  if (annotation.sourceType !== "markdown" && annotation.sourceType !== "pdf") {
    throw new Error("Annotation source type is invalid.");
  }
  if (!["open", "resolved", "orphaned"].includes(annotation.status ?? "")) {
    throw new Error("Annotation status is invalid.");
  }
  if (typeof annotation.body !== "string") {
    throw new Error("Annotation body must be a string.");
  }
  if (!annotation.anchor || typeof annotation.anchor !== "object") {
    throw new Error("Annotation anchor is required.");
  }
  if (
    annotation.anchor.kind !== "markdown" &&
    annotation.anchor.kind !== "pdf" &&
    annotation.anchor.kind !== "document"
  ) {
    throw new Error("Annotation anchor kind is invalid.");
  }
  if (
    annotation.sourceType === "markdown" &&
    annotation.anchor.kind === "pdf"
  ) {
    throw new Error("A Markdown source cannot use a PDF anchor.");
  }
  if (annotation.sourceType === "pdf" && annotation.anchor.kind === "markdown") {
    throw new Error("A PDF source cannot use a Markdown anchor.");
  }
  const color = annotation.color;
  if (color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error(`Annotation color is invalid: ${color}`);
  }
  const markStyle = annotation.markStyle;
  if (markStyle !== undefined && !isMarkStyle(markStyle)) {
    throw new Error(`Annotation mark style is invalid: ${String(markStyle)}`);
  }
  if (annotation.replies === undefined) {
    throw new Error("Annotation replies are required (use an empty array).");
  }
  if (!Array.isArray(annotation.replies)) {
    throw new Error("Annotation replies must be an array.");
  }
  for (const reply of annotation.replies) {
    if (
      !reply ||
      typeof reply !== "object" ||
      typeof reply.id !== "string" ||
      typeof reply.createdAt !== "string" ||
      typeof reply.body !== "string"
    ) {
      throw new Error("Annotation reply is malformed.");
    }
  }
}
