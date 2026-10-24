import { Notice, TFile } from "obsidian";
import type MarginaliaPlugin from "../main";
import { Annotation, MarkStyle, PdfAnchor, PdfRectangle } from "../domain/annotation";
import { resolveMarkStyle } from "../domain/marks";
import { normalizeRectangle, rectangleCss } from "./geometry";

export interface CapturedPdfSelection {
  sourcePath: string;
  anchor: PdfAnchor;
}

export class PdfAdapter {
  private observer: MutationObserver | null = null;
  private renderScheduled = false;
  private readonly legacyMigrations = new Set<string>();

  constructor(private readonly plugin: MarginaliaPlugin) {}

  start(): void {
    this.observer = new MutationObserver(() => {
      if (this.renderScheduled) return;
      this.renderScheduled = true;
      window.requestAnimationFrame(() => {
        this.renderScheduled = false;
        this.renderVisibleHighlights();
      });
    });
    this.observe();
    this.plugin.register(() => this.observer?.disconnect());
  }

  captureSelection(): CapturedPdfSelection | null {
    const file = this.plugin.app.workspace.getActiveFile();
    const selection = window.getSelection();
    if (!file || file.extension !== "pdf" || !selection || selection.rangeCount === 0) {
      return null;
    }
    const exact = selection.toString().trim();
    if (!exact) return null;
    const range = selection.getRangeAt(0);
    const commonElement =
      range.commonAncestorContainer.instanceOf(HTMLElement)
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const startElement =
      range.startContainer.instanceOf(HTMLElement)
        ? range.startContainer
        : range.startContainer.parentElement;
    const page = (commonElement ?? startElement)?.closest<HTMLElement>(
      ".page[data-page-number], .pdf-page[data-page-number], [data-page-number]"
    );
    if (!page) return null;
    const pageNumber = this.readPageNumber(page);
    if (!Number.isFinite(pageNumber)) return null;
    const pageRect = page.getBoundingClientRect();
    const rectangles: PdfRectangle[] = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) =>
        normalizeRectangle(rect, {
          left: pageRect.left,
          top: pageRect.top,
          right: pageRect.right,
          bottom: pageRect.bottom
        })
      )
      .filter(
        (rectangle): rectangle is PdfRectangle => rectangle !== null
      );
    const context = range.commonAncestorContainer.textContent ?? exact;
    const occurrence = context.indexOf(exact);
    return {
      sourcePath: file.path,
      anchor: {
        kind: "pdf",
        page: pageNumber,
        coordinateSpace: "normalized",
        quote: {
          exact,
          prefix: occurrence >= 0 ? context.slice(Math.max(0, occurrence - 48), occurrence) : "",
          suffix:
            occurrence >= 0
              ? context.slice(occurrence + exact.length, occurrence + exact.length + 48)
              : ""
        },
        rectangles
      }
    };
  }

  isPdfContext(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      Boolean(
        target.closest(
          '[data-type="pdf"], .pdf-viewer, .pdf-viewer-container, .pdf-container, .pdf-embed, .pdf-page, .page[data-page-number]'
        )
      )
    );
  }

  async navigate(annotation: Annotation): Promise<void> {
    if (annotation.anchor.kind !== "pdf") return;
    const file = this.plugin.app.vault.getAbstractFileByPath(annotation.sourcePath);
    if (!(file instanceof TFile)) {
      new Notice(`PDF not found: ${annotation.sourcePath}`);
      return;
    }
    await this.plugin.app.workspace.getLeaf(false).openFile(file, {
      eState: { subpath: `#page=${annotation.anchor.page}` }
    });
    window.setTimeout(() => this.renderVisibleHighlights(annotation.id), 250);
  }

  renderVisibleHighlights(activeId?: string): void {
    this.observer?.disconnect();
    try {
      document
        .querySelectorAll(".marginalia-bona-pdf-highlight-layer")
        .forEach((layer) => layer.remove());
      if (!this.plugin.settings.showHighlights) return;
      const file = this.plugin.app.workspace.getActiveFile();
      if (!file || file.extension !== "pdf") return;
      const annotations = this.plugin.store
        .forSource(file.path)
        .filter(
          (annotation) =>
            annotation.anchor.kind === "pdf" &&
            (annotation.status !== "resolved" || this.plugin.settings.showResolved)
        );
      for (const annotation of annotations) {
        this.renderAnnotation(annotation, activeId);
      }
    } finally {
      this.observe();
    }
  }

  private observe(): void {
    this.observer?.observe(document.body, { childList: true, subtree: true });
  }

  private readPageNumber(page: HTMLElement): number {
    const fromData = Number(page.dataset.pageNumber);
    if (Number.isFinite(fromData) && fromData > 0) return fromData;
    const labelled = page.getAttribute("aria-label")?.match(/\d+/)?.[0];
    if (labelled) return Number(labelled);
    const fromId = page.id.match(/(\d+)$/)?.[1];
    return fromId ? Number(fromId) : Number.NaN;
  }

  private renderAnnotation(annotation: Annotation, activeId?: string): void {
    if (annotation.anchor.kind !== "pdf") return;
    const page = document.querySelector<HTMLElement>(
      `.pdf-viewer .page[data-page-number="${annotation.anchor.page}"], .page[data-page-number="${annotation.anchor.page}"]`
    );
    if (!page || page.querySelector(`[data-marginalia-pdf-id="${annotation.id}"]`)) return;
    const recovered =
      annotation.anchor.coordinateSpace === "normalized"
        ? null
        : this.recoverLegacyGeometry(page, annotation);
    const rectangles = recovered ?? annotation.anchor.rectangles;
    const coordinateSpace = recovered
      ? "normalized"
      : (annotation.anchor.coordinateSpace ?? "css-pixels");
    const layer = page.createDiv({
      cls: `marginalia-pdf-highlight-layer${activeId === annotation.id ? " is-active" : ""}`,
      attr: { "data-marginalia-pdf-id": annotation.id }
    });
    const color = annotation.color ?? this.plugin.settings.highlightColor;
    const style: MarkStyle = resolveMarkStyle(
      annotation,
      this.plugin.settings.defaultMarkStyle
    );
    for (const rectangle of rectangles) {
      const mark = layer.createDiv({ cls: `marginalia-pdf-highlight marginalia-pdf-mark-${style}` });
      mark.style.setProperty("--marginalia-mark-color", color);
      mark.style.setProperty(
        "--marginalia-mark-opacity",
        String(this.plugin.settings.highlightOpacity)
      );
      const css = rectangleCss(rectangle, coordinateSpace);
      mark.style.left = css.left;
      mark.style.top = css.top;
      mark.style.width = css.width;
      mark.style.height = css.height;
    }
    layer.addEventListener("click", () => void this.plugin.activateAnnotation(annotation.id));
  }

  private recoverLegacyGeometry(
    page: HTMLElement,
    annotation: Annotation
  ): PdfRectangle[] | null {
    if (
      annotation.anchor.kind !== "pdf" ||
      this.legacyMigrations.has(annotation.id)
    ) {
      return null;
    }
    const textLayer =
      page.querySelector<HTMLElement>(".textLayer") ?? page;
    const walker = document.createTreeWalker(
      textLayer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return node.parentElement?.closest(".marginalia-bona-pdf-highlight-layer")
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    const nodes: Array<{ node: Text; start: number; end: number }> = [];
    let text = "";
    let current: Node | null;
    while ((current = walker.nextNode())) {
      const value = current.nodeValue ?? "";
      nodes.push({
        node: current as Text,
        start: text.length,
        end: text.length + value.length
      });
      text += value;
    }
    const start = this.locateQuote(text, annotation.anchor.quote);
    if (start < 0) return null;
    const end = start + annotation.anchor.quote.exact.length;
    const startNode = nodes.find(
      (entry) => entry.start <= start && entry.end > start
    );
    const endNode = nodes.find(
      (entry) => entry.start < end && entry.end >= end
    );
    if (!startNode || !endNode) return null;
    const range = document.createRange();
    range.setStart(startNode.node, start - startNode.start);
    range.setEnd(endNode.node, end - endNode.start);
    const pageRect = page.getBoundingClientRect();
    const rectangles = Array.from(range.getClientRects())
      .map((rectangle) =>
        normalizeRectangle(rectangle, {
          left: pageRect.left,
          top: pageRect.top,
          right: pageRect.right,
          bottom: pageRect.bottom
        })
      )
      .filter(
        (rectangle): rectangle is PdfRectangle => rectangle !== null
      );
    if (rectangles.length === 0) return null;
    this.legacyMigrations.add(annotation.id);
    void this.plugin.store
      .update(annotation.id, {
        anchor: {
          ...annotation.anchor,
          coordinateSpace: "normalized",
          rectangles
        }
      })
      .finally(() => this.legacyMigrations.delete(annotation.id));
    return rectangles;
  }

  private locateQuote(
    text: string,
    quote: { exact: string; prefix?: string; suffix?: string }
  ): number {
    const candidates: number[] = [];
    let cursor = 0;
    while (cursor <= text.length) {
      const found = text.indexOf(quote.exact, cursor);
      if (found < 0) break;
      candidates.push(found);
      cursor = found + Math.max(1, quote.exact.length);
    }
    const contextual = candidates.filter((candidate) => {
      const prefix = quote.prefix ?? "";
      const suffix = quote.suffix ?? "";
      return (
        (!prefix ||
          text
            .slice(Math.max(0, candidate - prefix.length), candidate)
            .endsWith(prefix)) &&
        (!suffix ||
          text
            .slice(
              candidate + quote.exact.length,
              candidate + quote.exact.length + suffix.length
            )
            .startsWith(suffix))
      );
    });
    if (contextual.length === 1) return contextual[0];
    return candidates.length === 1 ? candidates[0] : -1;
  }
}
