import { Notice, TFile } from "obsidian";
import type SidenPlugin from "../main";
import { Annotation, PdfAnchor, PdfRectangle } from "../domain/annotation";

export interface CapturedPdfSelection {
  sourcePath: string;
  anchor: PdfAnchor;
}

export class PdfAdapter {
  private observer: MutationObserver | null = null;
  private renderScheduled = false;

  constructor(private readonly plugin: SidenPlugin) {}

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
    const page = (range.commonAncestorContainer.parentElement ?? range.startContainer.parentElement)
      ?.closest<HTMLElement>(".page[data-page-number]");
    if (!page) return null;
    const pageNumber = Number(page.dataset.pageNumber);
    if (!Number.isFinite(pageNumber)) return null;
    const pageRect = page.getBoundingClientRect();
    const rectangles: PdfRectangle[] = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left - pageRect.left,
        top: rect.top - pageRect.top,
        right: rect.right - pageRect.left,
        bottom: rect.bottom - pageRect.top
      }));
    const context = range.commonAncestorContainer.textContent ?? exact;
    const occurrence = context.indexOf(exact);
    return {
      sourcePath: file.path,
      anchor: {
        kind: "pdf",
        page: pageNumber,
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
        .querySelectorAll(".siden-pdf-highlight-layer")
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

  private renderAnnotation(annotation: Annotation, activeId?: string): void {
    if (annotation.anchor.kind !== "pdf") return;
    const page = document.querySelector<HTMLElement>(
      `.pdf-viewer .page[data-page-number="${annotation.anchor.page}"], .page[data-page-number="${annotation.anchor.page}"]`
    );
    if (!page || page.querySelector(`[data-siden-pdf-id="${annotation.id}"]`)) return;
    const layer = page.createDiv({
      cls: `siden-pdf-highlight-layer${activeId === annotation.id ? " is-active" : ""}`,
      attr: { "data-siden-pdf-id": annotation.id }
    });
    for (const rectangle of annotation.anchor.rectangles) {
      const mark = layer.createDiv({ cls: "siden-pdf-highlight" });
      mark.style.left = `${rectangle.left}px`;
      mark.style.top = `${rectangle.top}px`;
      mark.style.width = `${rectangle.right - rectangle.left}px`;
      mark.style.height = `${rectangle.bottom - rectangle.top}px`;
    }
    layer.addEventListener("click", () => void this.plugin.activateAnnotation(annotation.id));
  }
}
