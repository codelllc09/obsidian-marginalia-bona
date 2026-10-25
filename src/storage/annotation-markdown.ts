import {
  Annotation,
  AnnotationAnchor,
  AnnotationReply,
  AnnotationStatus,
  SourceType,
  assertAnnotation,
  isMarkStyle
} from "../domain/annotation";

const ANCHOR_START = "<!-- siden:anchor -->";
const ANCHOR_END = "<!-- /siden:anchor -->";
const REPLIES_HEADING = "## Replies";

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
    ...(annotation.color ? [`color: ${scalar(annotation.color)}`] : []),
    ...(annotation.markStyle
      ? [`mark-style: ${scalar(annotation.markStyle)}`]
      : []),
    ...(annotation.author ? [`author: ${scalar(annotation.author)}`] : []),
    ...(annotation.readAt ? [`read-at: ${scalar(annotation.readAt)}`] : []),
    `created: ${scalar(annotation.createdAt)}`,
    `updated: ${scalar(annotation.updatedAt)}`,
    "---"
  ].join("\n");

  const sections = [
    `# Annotation\n\n${annotation.body.trimEnd()}`,
    ...serializeReplies(annotation.replies)
  ];

  return `${frontmatter}

${sections.join("\n\n")}

${ANCHOR_START}

## Anchor metadata

\`\`\`json
${JSON.stringify(annotation.anchor, null, 2)}
\`\`\`

${ANCHOR_END}
`;
}

/**
 * Replies are inlined as Markdown so one file reads as one thread:
 *
 *   ## Replies
 *
 *   ### <reply-id> | <createdAt>
 *   ### <reply-id> | <createdAt> | <author>   (author segment optional)
 *
 *   Reply body.
 */
function serializeReplies(replies: AnnotationReply[]): string[] {
  if (replies.length === 0) return [];
  const sections = replies.map((reply) => {
    const heading = reply.author
      ? `### ${reply.id} | ${reply.createdAt} | ${reply.author}`
      : `### ${reply.id} | ${reply.createdAt}`;
    return `${heading}\n\n${reply.body.trimEnd()}`;
  });
  return [`${REPLIES_HEADING}\n\n${sections.join("\n\n")}`];
}

function parseReplies(source: string): AnnotationReply[] {
  for (const line of source.split("\n")) {
    if (
      line.startsWith("###") &&
      !line.startsWith("### ") &&
      !line.startsWith("####")
    ) {
      throw new Error(`Annotation reply heading is malformed: ${line.trim()}`);
    }
  }
  const replies: AnnotationReply[] = [];
  const blocks = source.split(/^### /m).slice(1);
  for (const block of blocks) {
    const newline = block.indexOf("\n");
    const heading = (newline < 0 ? block : block.slice(0, newline)).trim();
    const body = newline < 0 ? "" : block.slice(newline + 1).trim();
    const parts = heading.split(" | ");
    const [id, createdAt] = parts;
    if (!id) {
      throw new Error(`Annotation reply heading is malformed: ${heading}`);
    }
    replies.push({
      id,
      createdAt: createdAt ?? "",
      ...(parts.length > 2 ? { author: parts.slice(2).join(" | ") } : {}),
      body: body.trimEnd()
    });
  }
  return replies;
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

  let bodySection = content.slice(heading.length).replace(/^\s*\n/, "");
  let replies: AnnotationReply[] = [];
  const repliesAt = bodySection.indexOf(`\n${REPLIES_HEADING}`);
  if (repliesAt >= 0) {
    const replySection = bodySection
      .slice(repliesAt + `\n${REPLIES_HEADING}`.length)
      .replace(/^\s*\n/, "");
    replies = parseReplies(replySection);
    bodySection = bodySection.slice(0, repliesAt);
  }

  const annotation = {
    schemaVersion: Number(metadata["siden-schema"]),
    id: requiredString(metadata, "id"),
    sourcePath: requiredString(metadata, "source"),
    sourceType: requiredString(metadata, "source-type") as SourceType,
    status: requiredString(metadata, "status") as AnnotationStatus,
    ...(typeof metadata["color"] === "string" && metadata["color"]
      ? { color: metadata["color"] }
      : {}),
    ...(typeof metadata["mark-style"] === "string" &&
    isMarkStyle(metadata["mark-style"])
      ? { markStyle: metadata["mark-style"] }
      : {}),
    ...(typeof metadata["author"] === "string" && metadata["author"]
      ? { author: metadata["author"] }
      : {}),
    ...(typeof metadata["read-at"] === "string" && metadata["read-at"]
      ? { readAt: metadata["read-at"] }
      : {}),
    createdAt: requiredString(metadata, "created"),
    updatedAt: requiredString(metadata, "updated"),
    body: bodySection.trimEnd(),
    anchor,
    replies
  };

  assertAnnotation(annotation);
  return annotation;
}
