import {
  MarkdownPostProcessorContext,
  MarkdownRenderer
} from "obsidian";
import type SidenPlugin from "../main";
import { Annotation } from "../domain/annotation";

interface TextSegment {
  node: Text;
  start: number;
  end: number;
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
    segments.push({ node: node as Text, start: text.length, end: text.length + value.length });
    text += value;
  }
  return { text, segments };
}

function highlightOccurrence(
  root: HTMLElement,
  annotation: Annotation,
  plugin: SidenPlugin
): HTMLElement | null {
  if (annotation.anchor.kind === "document") return root;
  const exact = annotation.anchor.quote.exact;
  if (!exact) return null;
  const { text, segments } = textSegments(root);
  const start = locateQuote(text, annotation.anchor.quote);
  if (start < 0) return null;
  const end = start + exact.length;
  let firstMark: HTMLElement | null = null;

  for (const segment of segments) {
    const from = Math.max(start, segment.start);
    const to = Math.min(end, segment.end);
    if (from >= to || !segment.node.parentNode) continue;
    const range = document.createRange();
    range.setStart(segment.node, from - segment.start);
    range.setEnd(segment.node, to - segment.start);
    const mark = document.createElement("mark");
    mark.className = `siden-highlight siden-highlight-${plugin.settings.highlightStyle}`;
    mark.dataset.sidenId = annotation.id;
    mark.addEventListener("click", () => void plugin.activateAnnotation(annotation.id));
    range.surroundContents(mark);
    firstMark ??= mark;
  }
  return firstMark;
}

function renderMarginCard(
  layer: HTMLElement,
  anchor: HTMLElement,
  annotation: Annotation,
  root: HTMLElement,
  plugin: SidenPlugin
): void {
  const card = layer.createDiv({
    cls: "siden-margin-card siden-margin-card-reading",
    attr: {
      "data-siden-id": annotation.id,
      tabindex: "0",
      role: "button",
      "aria-label": `Open annotation: ${annotation.body}`
    }
  });
  const rootRect = root.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  card.style.top = `${anchorRect.top - rootRect.top + root.scrollTop}px`;
  const body = card.createDiv({ cls: "markdown-rendered" });
  void MarkdownRenderer.render(
    plugin.app,
    annotation.body,
    body,
    annotation.sourcePath,
    plugin
  );
  card.addEventListener("click", () => void plugin.activateAnnotation(annotation.id));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void plugin.activateAnnotation(annotation.id);
    }
  });
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
  if (annotations.length === 0) return;

  element.addClass("siden-reading-section");
  let layer: HTMLElement | null = null;
  for (const annotation of annotations) {
    const anchor = plugin.settings.showHighlights
      ? highlightOccurrence(element, annotation, plugin)
      : findAnchorWithoutHighlight(element, annotation);
    if (
      !anchor ||
      !plugin.settings.showMargins ||
      element.clientWidth < plugin.settings.narrowPaneThreshold
    ) {
      continue;
    }
    layer ??= element.createDiv({ cls: "siden-reading-margin-layer" });
    renderMarginCard(layer, anchor, annotation, element, plugin);
  }
}

function findAnchorWithoutHighlight(
  root: HTMLElement,
  annotation: Annotation
): HTMLElement | null {
  if (annotation.anchor.kind === "document") return root;
  const { text, segments } = textSegments(root);
  const start = locateQuote(text, annotation.anchor.quote);
  const segment = segments.find((item) => item.start <= start && item.end > start);
  return segment?.node.parentElement ?? null;
}
