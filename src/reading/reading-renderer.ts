import { MarkdownPostProcessorContext } from "obsidian";
import type SidenPlugin from "../main";
import { Annotation } from "../domain/annotation";

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

interface PreviewState {
  plugin: SidenPlugin;
  preview: HTMLElement;
  layer: HTMLElement;
  observer: ResizeObserver;
  frame: number;
}

const previewStates = new Set<PreviewState>();

function textSegments(root: HTMLElement): {
  text: string;
  segments: TextSegment[];
} {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (
        !parent ||
        parent.closest(
          ".siden-reading-margin-layer, code, pre, script, style, .math"
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const segments: TextSegment[] = [];
  let text = "";
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const value = node.nodeValue ?? "";
    segments.push({
      node: node as Text,
      start: text.length,
      end: text.length + value.length
    });
    text += value;
  }
  return { text, segments };
}

function locateQuote(
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

function highlightOccurrence(
  root: HTMLElement,
  annotation: Annotation,
  plugin: SidenPlugin
): HTMLElement | null {
  if (annotation.anchor.kind !== "markdown") return null;
  const existing = root.querySelector<HTMLElement>(
    `[data-siden-id="${annotation.id}"]`
  );
  if (existing) return existing;
  const { text, segments } = textSegments(root);
  const start = locateQuote(text, annotation.anchor.quote);
  if (start < 0) return null;
  const end = start + annotation.anchor.quote.exact.length;
  let firstMark: HTMLElement | null = null;
  for (const segment of segments) {
    const from = Math.max(start, segment.start);
    const to = Math.min(end, segment.end);
    if (from >= to || !segment.node.parentNode) continue;
    const range = document.createRange();
    range.setStart(segment.node, from - segment.start);
    range.setEnd(segment.node, to - segment.start);
    const mark = createEl("mark");
    mark.className = `siden-highlight siden-highlight-${plugin.settings.highlightStyle}`;
    mark.dataset.sidenId = annotation.id;
    mark.addEventListener("click", () =>
      void plugin.activateAnnotation(annotation.id)
    );
    range.surroundContents(mark);
    firstMark ??= mark;
  }
  return firstMark;
}

function findAnchor(
  root: HTMLElement,
  annotation: Annotation
): HTMLElement | null {
  const highlighted = root.querySelector<HTMLElement>(
    `[data-siden-id="${annotation.id}"]`
  );
  if (highlighted) return highlighted;
  if (annotation.anchor.kind !== "markdown") return null;
  const { text, segments } = textSegments(root);
  const start = locateQuote(text, annotation.anchor.quote);
  const segment = segments.find(
    (candidate) => candidate.start <= start && candidate.end > start
  );
  return segment?.node.parentElement ?? null;
}

function ensurePreviewState(
  preview: HTMLElement,
  plugin: SidenPlugin
): PreviewState {
  const existing = [...previewStates].find(
    (state) => state.preview === preview
  );
  if (existing) return existing;
  preview.addClass("siden-reading-preview");
  const layer = preview.createDiv({ cls: "siden-reading-margin-layer" });
  const state: PreviewState = {
    plugin,
    preview,
    layer,
    observer: new ResizeObserver(() => schedulePreview(state)),
    frame: 0
  };
  state.observer.observe(preview);
  previewStates.add(state);
  plugin.register(() => destroyPreviewState(state));
  return state;
}

function destroyPreviewState(state: PreviewState): void {
  cancelAnimationFrame(state.frame);
  state.observer.disconnect();
  state.layer.remove();
  previewStates.delete(state);
}

function schedulePreview(state: PreviewState): void {
  window.cancelAnimationFrame(state.frame);
  state.frame = window.requestAnimationFrame(() => renderPreviewMargins(state));
}

function measurePlacement(
  state: PreviewState
): { left: number; width: number } | null {
  const { preview, plugin } = state;
  const previewRect = preview.getBoundingClientRect();
  const sizer =
    preview.querySelector<HTMLElement>(".markdown-preview-sizer") ?? preview;
  const contentRect = sizer.getBoundingClientRect();
  const gap = 10;
  const edge = 8;
  const leftWidth = Math.max(
    0,
    contentRect.left - previewRect.left - gap - edge
  );
  const rightWidth = Math.max(
    0,
    previewRect.right - contentRect.right - gap - edge
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
    width,
    left:
      side === "left"
        ? contentRect.left - previewRect.left - gap - width
        : contentRect.right - previewRect.left + gap
  };
}

function renderPreviewMargins(state: PreviewState): void {
  const { preview, layer, plugin } = state;
  if (!preview.isConnected) {
    destroyPreviewState(state);
    return;
  }
  layer.empty();
  layer.style.height = `${preview.scrollHeight}px`;
  if (!plugin.settings.showMargins || plugin.areMarginsSuppressed()) return;
  const placement = measurePlacement(state);
  if (!placement) return;
  const filePath = preview.dataset.sidenSourcePath;
  if (!filePath) return;
  const previewRect = preview.getBoundingClientRect();
  const entries = plugin.store
    .forSource(filePath)
    .filter(
      (annotation) =>
        annotation.anchor.kind === "markdown" &&
        annotation.status !== "orphaned" &&
        (annotation.status !== "resolved" || plugin.settings.showResolved)
    )
    .map((annotation) => {
      const anchor = findAnchor(preview, annotation);
      return anchor
        ? {
            annotation,
            desiredTop:
              anchor.getBoundingClientRect().top -
              previewRect.top +
              preview.scrollTop
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
    const card = layer.createDiv({
      cls: `siden-margin-card siden-margin-card-reading${
        plugin.settings.forceLongWordBreaks
          ? " siden-force-word-breaks"
          : ""
      }`,
      text: entry.annotation.body,
      attr: {
        "data-siden-id": entry.annotation.id,
        tabindex: "0",
        role: "button",
        "aria-label": `Open annotation: ${entry.annotation.body}`
      }
    });
    card.style.left = `${Math.floor(placement.left)}px`;
    card.style.width = `${Math.floor(placement.width)}px`;
    const top = Math.max(entry.desiredTop, nextTop);
    card.style.top = `${Math.floor(top)}px`;
    card.addEventListener("click", () =>
      void plugin.activateAnnotation(entry.annotation.id)
    );
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void plugin.activateAnnotation(entry.annotation.id);
    });
    nextTop = top + card.getBoundingClientRect().height + 8;
  }
}

export function refreshReadingMargins(plugin: SidenPlugin): void {
  for (const state of previewStates) {
    if (state.plugin === plugin) schedulePreview(state);
  }
}

export function processReadingView(
  element: HTMLElement,
  context: MarkdownPostProcessorContext,
  plugin: SidenPlugin
): void {
  if (context.sourcePath.startsWith(".siden/")) return;
  const annotations = plugin.store
    .forSource(context.sourcePath)
    .filter(
      (annotation) =>
        annotation.anchor.kind === "markdown" &&
        (annotation.status !== "resolved" || plugin.settings.showResolved)
    );
  for (const annotation of annotations) {
    if (plugin.settings.showHighlights) {
      highlightOccurrence(element, annotation, plugin);
    }
  }
  const preview = element.closest<HTMLElement>(".markdown-preview-view");
  if (!preview) return;
  preview.dataset.sidenSourcePath = context.sourcePath;
  schedulePreview(ensurePreviewState(preview, plugin));
}
