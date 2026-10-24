import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate
} from "@codemirror/view";
import { MarkdownView } from "obsidian";
import type SidenPlugin from "../main";
import { Annotation, MarkdownAnchor } from "../domain/annotation";
import { markPresentation } from "../domain/marks";

interface MarginPlacement {
  side: "left" | "right";
  left: number;
  width: number;
}

function markdownPathForEditor(
  editorView: EditorView,
  plugin: SidenPlugin
): string | null {
  let path: string | null = null;
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    if (path || !(leaf.view instanceof MarkdownView) || !leaf.view.file) return;
    const codeMirror = (leaf.view.editor as { cm?: EditorView }).cm;
    if (codeMirror === editorView) path = leaf.view.file.path;
  });
  return path;
}

function visibleAnnotations(
  view: EditorView,
  plugin: SidenPlugin
): Annotation[] {
  const path = markdownPathForEditor(view, plugin);
  if (!path) return [];
  return plugin.store
    .forSource(path)
    .filter(
      (annotation) =>
        annotation.anchor.kind === "markdown" &&
        (annotation.status !== "resolved" || plugin.settings.showResolved)
    )
    .sort(
      (a, b) =>
        (a.anchor as MarkdownAnchor).startOffset -
        (b.anchor as MarkdownAnchor).startOffset
    );
}

function buildHighlights(
  view: EditorView,
  plugin: SidenPlugin
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (!plugin.settings.showHighlights) return builder.finish();
  for (const annotation of visibleAnnotations(view, plugin)) {
    const anchor = annotation.anchor as MarkdownAnchor;
    const from = Math.max(0, Math.min(anchor.startOffset, view.state.doc.length));
    const to = Math.max(from, Math.min(anchor.endOffset, view.state.doc.length));
    if (to <= from) continue;
    const presentation = markPresentation(annotation, {
      defaultStyle: plugin.settings.defaultMarkStyle,
      defaultColor: plugin.settings.highlightColor,
      opacity: plugin.settings.highlightOpacity
    });
    builder.add(
      from,
      to,
      Decoration.mark({
        class: presentation.class,
        attributes: {
          "data-siden-id": annotation.id,
          style: presentation.style
        }
      })
    );
  }
  return builder.finish();
}

function measureContentColumn(view: EditorView): DOMRect {
  const sizer =
    view.dom.querySelector<HTMLElement>(".cm-sizer") ?? view.contentDOM;
  const sizerRect = sizer.getBoundingClientRect();
  const editorRect = view.dom.getBoundingClientRect();
  return new DOMRect(
    Math.max(editorRect.left, sizerRect.left),
    sizerRect.top,
    Math.min(editorRect.right, sizerRect.right) -
      Math.max(editorRect.left, sizerRect.left),
    sizerRect.height
  );
}

function choosePlacement(
  view: EditorView,
  plugin: SidenPlugin
): MarginPlacement | null {
  const editorRect = view.dom.getBoundingClientRect();
  const contentRect = measureContentColumn(view);
  const gap = 10;
  const edge = 8;
  const leftWidth = Math.max(0, contentRect.left - editorRect.left - gap - edge);
  const rightWidth = Math.max(
    0,
    editorRect.right - contentRect.right - gap - edge
  );
  const side =
    plugin.settings.marginSide === "auto"
      ? leftWidth > rightWidth
        ? "left"
        : "right"
      : plugin.settings.marginSide;
  const available = side === "left" ? leftWidth : rightWidth;
  if (available < 72) return null;
  const width = Math.min(plugin.settings.marginWidth, available);
  return {
    side,
    width,
    left:
      side === "left"
        ? contentRect.left - editorRect.left - gap - width
        : contentRect.right - editorRect.left + gap
  };
}

function createMarginCard(
  annotation: Annotation,
  plugin: SidenPlugin,
  width: number
): HTMLElement {
  const card = createDiv();
  card.className = "siden-margin-card siden-margin-card-live";
  card.classList.toggle(
    "siden-force-word-breaks",
    plugin.settings.forceLongWordBreaks
  );
  card.dataset.sidenId = annotation.id;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.style.width = `${Math.floor(width)}px`;
  card.style.setProperty(
    "--siden-card-color",
    annotation.color ?? plugin.settings.highlightColor
  );
  const body = createDiv({ cls: "siden-margin-card-body" });
  body.textContent = annotation.body;
  card.appendChild(body);
  for (const reply of annotation.replies) {
    card.createDiv({
      cls: "siden-margin-card-reply",
      text: reply.body
    });
  }
  if (annotation.replies.length > 0) {
    card.createDiv({
      cls: "siden-margin-card-count",
      text: `${annotation.replies.length} repl${
        annotation.replies.length === 1 ? "y" : "ies"
      }`
    });
  }
  card.setAttribute("aria-label", `Open annotation: ${annotation.body}`);
  card.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void plugin.activateAnnotation(annotation.id);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    void plugin.activateAnnotation(annotation.id);
  });
  return card;
}

function renderMargins(
  view: EditorView,
  plugin: SidenPlugin,
  layer: HTMLElement
): void {
  layer.empty();
  if (
    !plugin.settings.showMargins ||
    plugin.areMarginsSuppressed() ||
    view.dom.clientWidth < 320
  ) {
    return;
  }
  const placement = choosePlacement(view, plugin);
  if (!placement) return;
  const editorRect = view.dom.getBoundingClientRect();
  const entries = visibleAnnotations(view, plugin)
    .filter(
      (annotation) =>
        annotation.status !== "orphaned" &&
        annotation.anchor.kind === "markdown" &&
        annotation.anchor.startOffset <= view.state.doc.length
    )
    .map((annotation) => {
      const anchor = annotation.anchor as MarkdownAnchor;
      const coordinates = view.coordsAtPos(anchor.startOffset);
      return coordinates
        ? {
            annotation,
            desiredTop: coordinates.top - editorRect.top
          }
        : null;
    })
    .filter(
      (
        entry
      ): entry is { annotation: Annotation; desiredTop: number } => Boolean(entry)
    )
    .sort((a, b) => a.desiredTop - b.desiredTop);

  let nextTop = 6;
  for (const entry of entries) {
    if (entry.desiredTop < -200 || entry.desiredTop > editorRect.height + 200) {
      continue;
    }
    const card = createMarginCard(entry.annotation, plugin, placement.width);
    card.style.left = `${Math.floor(placement.left)}px`;
    layer.appendChild(card);
    const top = Math.max(6, entry.desiredTop, nextTop);
    card.style.top = `${Math.floor(top)}px`;
    nextTop = top + card.getBoundingClientRect().height + 8;
  }
}

async function mapChangedAnchors(
  update: ViewUpdate,
  plugin: SidenPlugin
): Promise<void> {
  if (!update.docChanged) return;
  const path = markdownPathForEditor(update.view, plugin);
  if (!path) return;
  for (const annotation of plugin.store.forSource(path)) {
    if (annotation.anchor.kind !== "markdown") continue;
    const anchor = annotation.anchor;
    const startOffset = update.changes.mapPos(anchor.startOffset, 1);
    const endOffset = update.changes.mapPos(anchor.endOffset, -1);
    const selected = update.state.sliceDoc(startOffset, endOffset);
    const isOrphaned = endOffset <= startOffset || selected.length === 0;
    const startLine = update.state.doc.lineAt(startOffset);
    const endLine = update.state.doc.lineAt(endOffset);
    const documentText = update.state.doc.toString();
    await plugin.store.update(annotation.id, {
      status: isOrphaned ? "orphaned" : annotation.status,
      anchor: {
        ...anchor,
        startOffset,
        endOffset,
        startLine: startLine.number - 1,
        startCharacter: startOffset - startLine.from,
        endLine: endLine.number - 1,
        endCharacter: endOffset - endLine.from,
        quote: isOrphaned
          ? anchor.quote
          : {
              exact: selected,
              prefix: documentText.slice(
                Math.max(0, startOffset - 64),
                startOffset
              ),
              suffix: documentText.slice(endOffset, endOffset + 64)
            }
      }
    });
  }
}

export function createMarkdownExtension(plugin: SidenPlugin) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private revision: number;
      private readonly marginLayer: HTMLElement;
      private readonly resizeObserver: ResizeObserver;
      private renderFrame = 0;

      constructor(private readonly view: EditorView) {
        this.revision = plugin.editorRevision;
        this.decorations = buildHighlights(view, plugin);
        this.marginLayer = view.dom.createDiv({
          cls: "siden-editor-margin-layer"
        });
        this.resizeObserver = new ResizeObserver(() => this.scheduleMargins());
        this.resizeObserver.observe(view.dom);
        view.scrollDOM.addEventListener("scroll", this.handleScroll, {
          passive: true
        });
        this.scheduleMargins();
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) void mapChangedAnchors(update, plugin);
        const revisionChanged = this.revision !== plugin.editorRevision;
        if (update.docChanged || update.viewportChanged || revisionChanged) {
          this.revision = plugin.editorRevision;
          this.decorations = buildHighlights(update.view, plugin);
          this.scheduleMargins();
        }
      }

      destroy(): void {
        cancelAnimationFrame(this.renderFrame);
        this.resizeObserver.disconnect();
        this.view.scrollDOM.removeEventListener("scroll", this.handleScroll);
        this.marginLayer.remove();
      }

      private readonly handleScroll = (): void => this.scheduleMargins();

      private scheduleMargins(): void {
        window.cancelAnimationFrame(this.renderFrame);
        this.renderFrame = window.requestAnimationFrame(() =>
          renderMargins(this.view, plugin, this.marginLayer)
        );
      }
    },
    {
      decorations: (instance) => instance.decorations,
      eventHandlers: {
        click(event) {
          const target = event.target as HTMLElement;
          const highlight = target.closest<HTMLElement>("[data-siden-id]");
          if (!highlight?.dataset.sidenId) return false;
          void plugin.activateAnnotation(highlight.dataset.sidenId);
          return true;
        }
      }
    }
  );
}
