import { TFile } from "obsidian";
import type MarginaliaPlugin from "../main";
import { anchorDrift } from "../domain/annotation";
import type { Annotation } from "../domain/annotation";
import { buildAnchor, findPassage } from "./anchor";
import type { RouteResult, VaultRouteContext } from "./types";

const ERROR_CODES = {
  invalidBody: 40001,
  unknownAnnotation: 40401,
  notANote: 40402,
  unknownPassage: 40403,
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

export interface CreatePayload {
  text: string;
  quote: string;
  occurrence?: number;
  author: string;
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
    // Safety policy: a multi-match quote is never anchored on a guess -
    // the caller must say which occurrence it means.
    const occurrence =
      typeof body.occurrence === "number" ? Math.floor(body.occurrence) : undefined;
    const noteText = await this.plugin.app.vault.cachedRead(file);
    return this.createFromText(notePath, noteText, {
      text,
      quote,
      occurrence,
      author
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
    if (body.resolved === true) changes.status = "resolved";
    else if (body.resolved === false) changes.status = "open";
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
}
