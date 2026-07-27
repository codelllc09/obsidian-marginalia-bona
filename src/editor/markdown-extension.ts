import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType
} from "@codemirror/view";
import { MarkdownView } from "obsidian";
import type SidenPlugin from "../main";
import { Annotation, MarkdownAnchor } from "../domain/annotation";

class MarginWidget extends WidgetType {
  constructor(
    private readonly annotation: Annotation,
    private readonly plugin: SidenPlugin
  ) {
    super();
  }

  eq(other: MarginWidget): boolean {
    return (
      other.annotation.id === this.annotation.id &&
      other.annotation.body === this.annotation.body &&
      other.annotation.status === this.annotation.status
    );
  }

  toDOM(): HTMLElement {
    const card = document.createElement("button");
    card.className = "siden-margin-card siden-margin-card-live";
    card.dataset.sidenId = this.annotation.id;
    card.type = "button";
    card.textContent = this.annotation.body;
    card.setAttribute("aria-label", `Open annotation: ${this.annotation.body}`);
    card.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.plugin.activateAnnotation(this.annotation.id);
    });
    return card;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function activeMarkdownPath(plugin: SidenPlugin): string | null {
  const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  return view?.file?.path ?? null;
}

function buildDecorations(
  view: EditorView,
  plugin: SidenPlugin
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const path = activeMarkdownPath(plugin);
  if (!path) return builder.finish();

  const visible = plugin.store
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

  for (const annotation of visible) {
    const anchor = annotation.anchor as MarkdownAnchor;
    const from = Math.max(0, Math.min(anchor.startOffset, view.state.doc.length));
    const to = Math.max(from, Math.min(anchor.endOffset, view.state.doc.length));
    if (plugin.settings.showHighlights && to > from) {
      builder.add(
        from,
        to,
        Decoration.mark({
          class: `siden-highlight siden-highlight-${plugin.settings.highlightStyle}`,
          attributes: { "data-siden-id": annotation.id }
        })
      );
    }
    if (
      plugin.settings.showMargins &&
      annotation.status !== "orphaned" &&
      view.dom.clientWidth >= plugin.settings.narrowPaneThreshold
    ) {
      builder.add(
        to,
        to,
        Decoration.widget({
          widget: new MarginWidget(annotation, plugin),
          side: 1
        })
      );
    }
  }
  return builder.finish();
}

async function mapChangedAnchors(
  update: ViewUpdate,
  plugin: SidenPlugin
): Promise<void> {
  if (!update.docChanged) return;
  const path = activeMarkdownPath(plugin);
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
              prefix: documentText.slice(Math.max(0, startOffset - 64), startOffset),
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

      constructor(view: EditorView) {
        this.revision = plugin.editorRevision;
        this.decorations = buildDecorations(view, plugin);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) void mapChangedAnchors(update, plugin);
        const revisionChanged = this.revision !== plugin.editorRevision;
        if (
          update.docChanged ||
          update.viewportChanged ||
          revisionChanged
        ) {
          this.revision = plugin.editorRevision;
          this.decorations = buildDecorations(update.view, plugin);
        }
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
