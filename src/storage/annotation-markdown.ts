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
    // Nested replies record their parent in an HTML comment: invisible when
    // rendered, unambiguous to parse, and tolerated as body text by older
    // readers of this format.
    const parent = reply.parentId
      ? `<!-- reply-to: ${reply.parentId} -->\n`
      : "";
    return `${heading}\n${parent}\n${reply.body.trimEnd()}`;
  });
  return [`${REPLIES_HEADING}\n\n${sections.join("\n\n")}`];
}

/** Match `### <id> | <createdAt>[ | <author>]`; null when the line is not
 *  a machine-written reply heading (plain markdown H3s in bodies, fake
 *  markers, malformed lines all return null and degrade to body text). */
function replyHeadingParts(line: string): string[] | null {
  const match = /^### (.+)$/.exec(line);
  if (!match) return null;
  const parts = match[1].split(" | ");
  if (parts.length < 2) return null;
  const [id, createdAt] = parts;
  if (!id.trim() || Number.isNaN(Date.parse(createdAt))) return null;
  return parts;
}

function parseReplies(source: string): AnnotationReply[] {
  const replies: AnnotationReply[] = [];
  let current: AnnotationReply | null = null;
  // The line right after a heading may carry the parent reference.
  let parentSlot = false;
  for (const line of source.split("\n")) {
    const parts = replyHeadingParts(line);
    if (parts) {
      if (current) replies.push(current);
      const [id, createdAt, ...authorParts] = parts;
      current = {
        id: id.trim(),
        createdAt,
        ...(authorParts.length > 0 ? { author: authorParts.join(" | ") } : {}),
        body: ""
      };
      parentSlot = true;
      continue;
    }
    if (current && parentSlot) {
      const match = /^<!--\s*reply-to:\s*([^\s>]+)\s*-->$/.exec(line.trim());
      parentSlot = false;
      if (match) {
        current.parentId = match[1];
        continue;
      }
    }
    if (current) {
      current.body = current.body ? `${current.body}\n${line}` : line;
    }
  }
  if (current) replies.push(current);
  for (const reply of replies) {
    reply.body = reply.body.replace(/\s+$/, "");
  }
  return replies;
}

/** Locate the Replies section: the last `## Replies` marker whose section
 *  actually opens with a valid reply heading. Bodies may legitimately
 *  contain the marker text (quotes of the format), so a marker that is
 *  not followed by a reply heading is part of the body, not a section. */
function splitReplies(
  bodySection: string
): { body: string; replies: AnnotationReply[] } {
  const marker = `\n${REPLIES_HEADING}`;
  let from = bodySection.lastIndexOf(marker);
  while (from >= 0) {
    const section = bodySection
      .slice(from + marker.length)
      .replace(/^\s*\n/, "");
    const firstLine = section.slice(0, section.indexOf("\n") < 0 ? undefined : section.indexOf("\n"));
    if (replyHeadingParts(firstLine)) {
      return {
        body: bodySection.slice(0, from),
        replies: parseReplies(section)
      };
    }
    // An empty section from an older writer: the marker terminates the body
    // and nothing follows it. Quoted format text mid-body keeps the marker.
    if (section.trim() === "") {
      return { body: bodySection.slice(0, from), replies: [] };
    }
    from = bodySection.lastIndexOf(marker, from - 1);
  }
  return { body: bodySection, replies: [] };
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
  const { body, replies } = splitReplies(bodySection);
  bodySection = body;

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
