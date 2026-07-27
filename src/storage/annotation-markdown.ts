import {
  Annotation,
  AnnotationAnchor,
  AnnotationStatus,
  SourceType,
  assertAnnotation
} from "../domain/annotation";

const ANCHOR_START = "<!-- siden:anchor -->";
const ANCHOR_END = "<!-- /siden:anchor -->";

function scalar(value: string | number): string {
  return typeof value === "number" ? String(value) : JSON.stringify(value);
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function requiredString(
  metadata: Record<string, unknown>,
  key: string
): string {
  const value = metadata[key];
  if (typeof value !== "string") {
    throw new Error(`Annotation metadata "${key}" must be a string.`);
  }
  return value;
}

function parseFrontmatter(source: string): {
  metadata: Record<string, unknown>;
  remainder: string;
} {
  if (!source.startsWith("---\n")) {
    throw new Error("Annotation file is missing frontmatter.");
  }

  const end = source.indexOf("\n---\n", 4);
  if (end < 0) {
    throw new Error("Annotation frontmatter is not closed.");
  }

  const metadata: Record<string, unknown> = {};
  for (const line of source.slice(4, end).split("\n")) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator < 1) {
      throw new Error(`Invalid frontmatter line: ${line}`);
    }
    metadata[line.slice(0, separator).trim()] = parseScalar(
      line.slice(separator + 1)
    );
  }

  return { metadata, remainder: source.slice(end + 5) };
}

export function serializeAnnotation(annotation: Annotation): string {
  assertAnnotation(annotation);

  const frontmatter = [
    "---",
    `siden-schema: ${annotation.schemaVersion}`,
    `id: ${scalar(annotation.id)}`,
    `source: ${scalar(annotation.sourcePath)}`,
    `source-type: ${scalar(annotation.sourceType)}`,
    `status: ${scalar(annotation.status)}`,
    `created: ${scalar(annotation.createdAt)}`,
    `updated: ${scalar(annotation.updatedAt)}`,
    "---"
  ].join("\n");

  return `${frontmatter}

# Annotation

${annotation.body.trimEnd()}

${ANCHOR_START}

## Anchor metadata

\`\`\`json
${JSON.stringify(annotation.anchor, null, 2)}
\`\`\`

${ANCHOR_END}
`;
}

export function parseAnnotation(source: string): Annotation {
  const { metadata, remainder } = parseFrontmatter(
    source.replaceAll("\r\n", "\n")
  );
  const anchorStart = remainder.lastIndexOf(ANCHOR_START);
  const anchorEnd = remainder.lastIndexOf(ANCHOR_END);

  if (anchorStart < 0 || anchorEnd <= anchorStart) {
    throw new Error("Annotation anchor metadata is missing.");
  }

  const anchorSection = remainder.slice(anchorStart, anchorEnd);
  const codeStart = anchorSection.indexOf("```json\n");
  const codeEnd = anchorSection.lastIndexOf("\n```");
  if (codeStart < 0 || codeEnd <= codeStart) {
    throw new Error("Annotation anchor JSON is missing.");
  }

  const anchor = JSON.parse(
    anchorSection.slice(codeStart + "```json\n".length, codeEnd)
  ) as AnnotationAnchor;
  const content = remainder.slice(0, anchorStart).trim();
  const heading = "# Annotation";
  if (!content.startsWith(heading)) {
    throw new Error("Annotation body heading is missing.");
  }

  const annotation = {
    schemaVersion: Number(metadata["siden-schema"]),
    id: requiredString(metadata, "id"),
    sourcePath: requiredString(metadata, "source"),
    sourceType: requiredString(metadata, "source-type") as SourceType,
    status: requiredString(metadata, "status") as AnnotationStatus,
    createdAt: requiredString(metadata, "created"),
    updatedAt: requiredString(metadata, "updated"),
    body: content.slice(heading.length).replace(/^\s*\n/, "").trimEnd(),
    anchor
  };

  assertAnnotation(annotation);
  return annotation;
}
