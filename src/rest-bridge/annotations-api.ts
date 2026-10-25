import { TFile } from "obsidian";
import type MarginaliaPlugin from "../main";
import {
  anchorDrift,
  isMarkStyle,
  MARK_STYLES,
  type Annotation,
  type MarkStyle
} from "../domain/annotation";
import { buildAnchor, findPassage } from "./anchor";
import type { RouteResult, VaultRouteContext } from "./types";

const ERROR_CODES = {
  invalidBody: 40001,
  unknownAnnotation: 40401,
  notANote: 40402,
  unknownPassage: 40403,
  unknownReply: 40404,
  ambiguousQuote: 40902,
  expectedMismatch: 40903
} as const;

function err(
  status: number,
  errorCode: number,
  message: string
): RouteResult {
  return { status, body: { errorCode, message } };
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)
    : {};
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

/** Reads an optional per-annotation color: {value} when present, {error}
 *  when malformed, {} when absent. */
function optionalColor(body: Record<string, unknown>): {
  value?: string;
  error?: string;
} {
  const raw = body.color;
  if (raw === undefined) return {};
  if (typeof raw !== "string" || !HEX_COLOR.test(raw)) {
    return { error: "color must be a hex value like #ffd54f" };
  }
  return { value: raw };
}

/** Reads an optional per-annotation mark style; same contract as
 *  optionalColor. */
function optionalStyle(body: Record<string, unknown>): {
  value?: MarkStyle;
  error?: string;
} {
  const raw = body.style;
  if (raw === undefined) return {};
  if (!isMarkStyle(raw)) {
    return { error: `style must be one of: ${MARK_STYLES.join(", ")}` };
  }
  return { value: raw };
}

export interface CreatePayload {
  text: string;
  quote: string;
  occurrence?: number;
  author: string;
  color?: string;
  markStyle?: MarkStyle;
}

/** REST handlers for the annotations sub-resource. Every write goes
 *  through the store: index, shards, and the sidebar stay in sync, and
 *  the anchor is built by the plugin - agents never hand-assemble it. */
export class AnnotationsApi {
  constructor(private readonly plugin: MarginaliaPlugin) {}

  private noteFile(notePath: string): TFile | null {
    const file = this.plugin.app.vault.getAbstractFileByPath(notePath);
    return file instanceof TFile && file.extension === "md" ? file : null;
  }

  private threadPayload(annotation: Annotation) {
    const anchor = annotation.anchor;
    const position =
      anchor.kind === "markdown"
        ? { line: anchor.startLine + 1 }
        : anchor.kind === "pdf"
          ? { page: anchor.page }
          : {};
    return {
      id: annotation.id,
      source: annotation.sourcePath,
      status: annotation.status,
      author: annotation.author ?? "user",
      color: annotation.color ?? null,
      markStyle: annotation.markStyle ?? null,
      readAt: annotation.readAt ?? null,
      created: annotation.createdAt,
      updated: annotation.updatedAt,
      drifted: anchorDrift(annotation) !== null,
      anchor: {
        kind: anchor.kind,
        ...position,
        quote: anchor.kind === "document" ? null : anchor.quote
      },
      body: annotation.body,
      replies: annotation.replies.map((reply) => ({
        id: reply.id,
        author: reply.author ?? "user",
        createdAt: reply.createdAt,
        body: reply.body
      }))
    };
  }

  list(notePath: string, query: Record<string, string>): RouteResult {
    if (!this.noteFile(notePath)) {
      return err(404, ERROR_CODES.notANote, `No Markdown note at ${notePath}`);
    }
    let threads = this.plugin.store.forSource(notePath);
    const status = query.status;
    if (status === "drifted") {
      threads = threads.filter((a) => anchorDrift(a) !== null);
    } else if (status && status !== "all") {
      threads = threads.filter((a) => a.status === status);
    }
    const author = query.author;
    if (author) {
      threads = threads.filter((a) => (a.author ?? "user") === author);
    }
    // "true"/"false" strings: the REST query arrives stringified, the MCP
    // query builder stringifies booleans before passing them on.
    const read = query.read;
    if (read === "true") {
      threads = threads.filter((a) => a.readAt !== undefined);
    } else if (read === "false") {
      threads = threads.filter((a) => a.readAt === undefined);
    }
    return {
      status: 200,
      body: { threads: threads.map((a) => this.threadPayload(a)) }
    };
  }

  get(notePath: string, id: string): RouteResult {
    const annotation = this.plugin.store.get(id);
    if (!annotation || annotation.sourcePath !== notePath) {
      return err(404, ERROR_CODES.unknownAnnotation, `No annotation ${id}`);
    }
    return { status: 200, body: this.threadPayload(annotation) };
  }

  async create(
    notePath: string,
    bodyRaw: VaultRouteContext["body"]
  ): Promise<RouteResult> {
    const file = this.noteFile(notePath);
    if (!file) {
      return err(404, ERROR_CODES.notANote, `No Markdown note at ${notePath}`);
    }
    const body = asRecord(bodyRaw);
    const text = stringField(body, "text");
    const quote = stringField(body, "quote");
    if (!text.trim() || !quote.trim()) {
      return err(
        400,
        ERROR_CODES.invalidBody,
        "text and quote are required strings"
      );
    }
    const author = stringField(body, "author") || "Agent";
    const color = optionalColor(body);
    if (color.error) return err(400, ERROR_CODES.invalidBody, color.error);
    const style = optionalStyle(body);
    if (style.error) return err(400, ERROR_CODES.invalidBody, style.error);
    // Safety policy: a multi-match quote is never anchored on a guess -
    // the caller must say which occurrence it means.
    const occurrence =
      typeof body.occurrence === "number" ? Math.floor(body.occurrence) : undefined;
    const noteText = await this.plugin.app.vault.cachedRead(file);
    return this.createFromText(notePath, noteText, {
      text,
      quote,
      occurrence,
      author,
      color: color.value,
      markStyle: style.value
    });
  }

  /** Anchor `payload.quote` inside `noteText` and store the thread. */
  async createFromText(
    notePath: string,
    noteText: string,
    payload: CreatePayload
  ): Promise<RouteResult> {
    const found = findPassage(noteText, payload.quote, payload.occurrence);
    if (found.kind === "missing") {
      return err(404, ERROR_CODES.unknownPassage, "quote not found in the note");
    }
    if (found.kind === "ambiguous") {
      return err(
        409,
        ERROR_CODES.ambiguousQuote,
        `quote matches ${found.matches} passages; pass occurrence (1..${found.matches}) to disambiguate`
      );
    }
    const annotation = await this.plugin.store.create({
      sourcePath: notePath,
      sourceType: "markdown",
      status: "open",
      body: payload.text.trim(),
      author: payload.author,
      color: payload.color,
      markStyle: payload.markStyle,
      anchor: buildAnchor(noteText, payload.quote, found.startOffset)
    });
    return { status: 201, body: this.threadPayload(annotation) };
  }

  async addReply(
    notePath: string,
    id: string,
    bodyRaw: VaultRouteContext["body"]
  ): Promise<RouteResult> {
    const annotation = this.plugin.store.get(id);
    if (!annotation || annotation.sourcePath !== notePath) {
      return err(404, ERROR_CODES.unknownAnnotation, `No annotation ${id}`);
    }
    const body = asRecord(bodyRaw);
    const text = stringField(body, "text");
    if (!text.trim()) {
      return err(400, ERROR_CODES.invalidBody, "text is required");
    }
    const author = stringField(body, "author") || "Agent";
    const updated = await this.plugin.store.addReply(id, text, author);
    return { status: 201, body: this.threadPayload(updated) };
  }

  async patch(
    notePath: string,
    id: string,
    bodyRaw: VaultRouteContext["body"]
  ): Promise<RouteResult> {
    const annotation = this.plugin.store.get(id);
    if (!annotation || annotation.sourcePath !== notePath) {
      return err(404, ERROR_CODES.unknownAnnotation, `No annotation ${id}`);
    }
    const body = asRecord(bodyRaw);
    const changes: {
      body?: string;
      status?: Annotation["status"];
      color?: string;
      markStyle?: MarkStyle;
    } = {};
    if (typeof body.text === "string") {
      if (
        typeof body.expected_text === "string" &&
        annotation.body !== body.expected_text
      ) {
        return err(
          409,
          ERROR_CODES.expectedMismatch,
          "annotation text changed since you read it (expected_text mismatch)"
        );
      }
      changes.body = body.text;
    }
    const color = optionalColor(body);
    if (color.error) return err(400, ERROR_CODES.invalidBody, color.error);
    if (color.value !== undefined) changes.color = color.value;
    const style = optionalStyle(body);
    if (style.error) return err(400, ERROR_CODES.invalidBody, style.error);
    if (style.value !== undefined) changes.markStyle = style.value;
    if (body.resolved === true) changes.status = "resolved";
    else if (body.resolved === false) changes.status = "open";
    if (typeof body.read === "boolean") {
      // Never set automatically: only this explicit write records the read.
      changes.readAt = body.read ? new Date().toISOString() : undefined;
    }
    if (Object.keys(changes).length === 0) {
      return err(400, ERROR_CODES.invalidBody, "nothing to update");
    }
    const updated = await this.plugin.store.update(id, changes);
    return { status: 200, body: this.threadPayload(updated) };
  }

  async remove(notePath: string, id: string): Promise<RouteResult> {
    const annotation = this.plugin.store.get(id);
    if (!annotation || annotation.sourcePath !== notePath) {
      return err(404, ERROR_CODES.unknownAnnotation, `No annotation ${id}`);
    }
    if (annotation.replies.some((reply) => reply.id === id)) {
      await this.plugin.store.deleteReply(annotation.id, id);
    } else {
      await this.plugin.store.delete(id);
    }
    return { status: 200, body: { deleted: true } };
  }

  /** Attach an existing annotation to a new passage: the agent-side fix
   *  for drift and orphans. Same quote rules as create. */
  async reanchor(
    notePath: string,
    id: string,
    bodyRaw: VaultRouteContext["body"]
  ): Promise<RouteResult> {
    const file = this.noteFile(notePath);
    if (!file) {
      return err(404, ERROR_CODES.notANote, `No Markdown note at ${notePath}`);
    }
    const annotation = this.plugin.store.get(id);
    if (!annotation || annotation.sourcePath !== notePath) {
      return err(404, ERROR_CODES.unknownAnnotation, `No annotation ${id}`);
    }
    const body = asRecord(bodyRaw);
    const quote = stringField(body, "quote");
    if (!quote.trim()) {
      return err(400, ERROR_CODES.invalidBody, "quote is required");
    }
    if (typeof body.expected_quote === "string") {
      const current =
        annotation.anchor.kind === "document"
          ? undefined
          : annotation.anchor.quote.exact;
      if (current !== body.expected_quote) {
        return err(
          409,
          ERROR_CODES.expectedMismatch,
          "anchor moved since you read it (expected_quote mismatch)"
        );
      }
    }
    const occurrence =
      typeof body.occurrence === "number" ? Math.floor(body.occurrence) : undefined;
    const noteText = await this.plugin.app.vault.cachedRead(file);
    const found = findPassage(noteText, quote, occurrence);
    if (found.kind === "missing") {
      return err(404, ERROR_CODES.unknownPassage, "quote not found in the note");
    }
    if (found.kind === "ambiguous") {
      return err(
        409,
        ERROR_CODES.ambiguousQuote,
        `quote matches ${found.matches} passages; pass occurrence (1..${found.matches}) to disambiguate`
      );
    }
    const anchor = buildAnchor(noteText, quote, found.startOffset);
    const updated = await this.plugin.store.reanchor(id, anchor);
    return { status: 200, body: this.threadPayload(updated) };
  }

  async updateReply(
    notePath: string,
    id: string,
    replyId: string,
    bodyRaw: VaultRouteContext["body"]
  ): Promise<RouteResult> {
    const annotation = this.plugin.store.get(id);
    if (!annotation || annotation.sourcePath !== notePath) {
      return err(404, ERROR_CODES.unknownAnnotation, `No annotation ${id}`);
    }
    if (!annotation.replies.some((reply) => reply.id === replyId)) {
      return err(404, ERROR_CODES.unknownReply, `No reply ${replyId} on ${id}`);
    }
    const body = asRecord(bodyRaw);
    const text = stringField(body, "text");
    if (!text.trim()) {
      return err(400, ERROR_CODES.invalidBody, "text is required");
    }
    const author =
      typeof body.author === "string" && body.author.trim()
        ? body.author
        : undefined;
    const replies = annotation.replies.map((reply) =>
      reply.id === replyId
        ? {
            ...reply,
            body: text,
            ...(author !== undefined ? { author } : {})
          }
        : reply
    );
    const updated = await this.plugin.store.update(id, { replies });
    return { status: 200, body: this.threadPayload(updated) };
  }

  async removeReply(
    notePath: string,
    id: string,
    replyId: string
  ): Promise<RouteResult> {
    const annotation = this.plugin.store.get(id);
    if (!annotation || annotation.sourcePath !== notePath) {
      return err(404, ERROR_CODES.unknownAnnotation, `No annotation ${id}`);
    }
    if (!annotation.replies.some((reply) => reply.id === replyId)) {
      return err(404, ERROR_CODES.unknownReply, `No reply ${replyId} on ${id}`);
    }
    const updated = await this.plugin.store.deleteReply(id, replyId);
    return { status: 200, body: this.threadPayload(updated) };
  }
}
