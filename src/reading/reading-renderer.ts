import { Component, MarkdownPostProcessorContext, MarkdownRenderer } from "obsidian";
import type MarginaliaPlugin from "../main";
import { Annotation } from "../domain/annotation";
import { markPresentation } from "../domain/marks";

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

interface PreviewState {
  plugin: MarginaliaPlugin;
  preview: HTMLElement;
  layer: HTMLElement;
  observer: ResizeObserver;
  frame: number;
  /** Placement can be measured before Obsidian finishes laying the preview
   *  out (or before annotations are marked), so a failed pass retries. */
  retries: number;
  retryTimer: number;
}

const previewStates = new Set<PreviewState>();

export function textSegments(root: HTMLElement): {
  text: string;
  segments: TextSegment[];
} {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (
        !parent ||
        // Code used to be excluded from the searchable text, which made
        // any quote containing inline code impossible to locate. It is
        // included now; only our own layer, scripts and math stay out.
        parent.closest(
          ".marginalia-bona-reading-margin-layer, script, style, .math"
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

/** Rendered text loses inline Markdown markers: `code`, **bold**, ==mark==,
 *  [[links]] and [text](url) survive only as their inner text. Anchors are
 *  captured against the source, so both sides are normalised before
 *  searching the DOM - otherwise a quote with formatting is never found and
 *  its card silently disappears in Reading view. */

export function plainQuoteText(value: string): string {
  return value
    .replaceAll(/!\[\[([^\]]+)\]\]/g, "$1")
    .replaceAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => alias ?? target)
    .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replaceAll(/(\*\*|__)(.*?)\1/g, "$2")
    .replaceAll(/(\*|_)(.*?)\1/g, "$2")
    .replaceAll(/~~(.*?)~~/g, "$1")
    .replaceAll(/==(.*?)==/g, "$1")
    .replaceAll(/\\([\\`*_{}[\]()#+\-.!])/g, "$1");
}

export function locateQuote(
  text: string,
  quote: { exact: string; prefix?: string; suffix?: string }
): number {
  const needles = [quote.exact];
  const plain = plainQuoteText(quote.exact);
  if (plain && plain !== quote.exact) needles.push(plain);
  const prefix = plainQuoteText(quote.prefix ?? "");
  const suffix = plainQuoteText(quote.suffix ?? "");
  for (const needle of needles) {
    const found = locateNeedle(text, needle, prefix, suffix);
    if (found >= 0) return found;
  }
  return -1;
}

function locateNeedle(
  text: string,
  exact: string,
  prefix: string,
  suffix: string
): number {
  if (!exact) return -1;
  const candidates: number[] = [];
  let cursor = 0;
  while (cursor <= text.length) {
    const found = text.indexOf(exact, cursor);
    if (found < 0) break;
    candidates.push(found);
    cursor = found + Math.max(1, exact.length);
  }
  const contextual = candidates.filter((candidate) => {
    return (
      (!prefix ||
        text
          .slice(Math.max(0, candidate - prefix.length), candidate)
          .endsWith(prefix)) &&
      (!suffix ||
        text
          .slice(candidate + exact.length, candidate + exact.length + suffix.length)
          .startsWith(suffix))
    );
  });
  if (contextual.length === 1) return contextual[0];
  return candidates.length === 1 ? candidates[0] : -1;
}


export function highlightOccurrence(
  root: HTMLElement,
  annotation: Annotation,
  plugin: MarginaliaPlugin
): HTMLElement | null {
  if (annotation.anchor.kind !== "markdown") return null;
  const existing = root.querySelector<HTMLElement>(
    `[data-marginalia-id="${annotation.id}"]`
  );
  if (existing) return existing;
  const { text, segments } = textSegments(root);
  const start = locateQuote(text, annotation.anchor.quote);
  if (start < 0) return null;
  const exact = annotation.anchor.quote.exact;
  const end =
    start +
    (text.startsWith(plainQuoteText(exact), start)
      ? plainQuoteText(exact).length
      : exact.length);
  let firstMark: HTMLElement | null = null;
  for (const segment of segments) {
    const from = Math.max(start, segment.start);
    const to = Math.min(end, segment.end);
    if (from >= to || !segment.node.parentNode) continue;
    const range = document.createRange();
    range.setStart(segment.node, from - segment.start);
    range.setEnd(segment.node, to - segment.start);
    // A span, not <mark>: Obsidian's theme styles `mark` with its own
    // highlight background at higher specificity, which made every style
    // (underline, wavy, strikethrough, bold) look like a plain highlight in
    // Reading view. The editor path uses spans for the same reason.
    const mark = createSpan();
    const presentation = markPresentation(annotation, {
      defaultStyle: plugin.settings.defaultMarkStyle,
      defaultColor: plugin.settings.highlightColor,
      opacity: plugin.settings.highlightOpacity
    });
    mark.className = presentation.class;
    mark.setAttribute("style", presentation.style);
    mark.dataset.marginaliaId = annotation.id;
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
    `[data-marginalia-id="${annotation.id}"]`
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

/** Containers rendered by OUR markdown renders (sidebar cards, hover cards,
 *  margin cards) trigger the same post-processor; running the reading-view
 *  pass inside them would recurse and inject marks into our own UI. */
const OWN_UI =
  ".marginalia-sidebar, .marginalia-hover-preview, .marginalia-margin-card, .marginalia-lightbox, .cm-editor";

/** The scroll container of a Reading view, found without relying on one
 *  class name (Obsidian has used .markdown-preview-view and
 *  .markdown-reading-view; extensions/embeds may sit above either). */
function readingContainerFor(element: HTMLElement): HTMLElement | null {
  const direct = element.closest<HTMLElement>(
    ".markdown-preview-view, .markdown-reading-view"
  );
  if (direct) return direct;
  const sizer = element.closest<HTMLElement>(".markdown-preview-sizer");
  if (sizer?.parentElement) return sizer.parentElement;
  const section = element.closest<HTMLElement>(".markdown-preview-section");
  return section?.parentElement ?? null;
}

function ensurePreviewState(
  preview: HTMLElement,
  plugin: MarginaliaPlugin
): PreviewState {
  const existing = [...previewStates].find(
    (state) => state.preview === preview
  );
  if (existing) return existing;
  preview.addClass("marginalia-reading-preview");
  const layer = preview.createDiv({ cls: "marginalia-reading-margin-layer" });
  const state: PreviewState = {
    plugin,
    preview,
    layer,
    observer: new ResizeObserver(() => schedulePreview(state)),
    frame: 0,
    retries: 0,
    retryTimer: 0
  };
  state.observer.observe(preview);
  previewStates.add(state);
  plugin.register(() => destroyPreviewState(state));
  return state;
}

function destroyPreviewState(state: PreviewState): void {
  cancelAnimationFrame(state.frame);
  window.clearTimeout(state.retryTimer);
  state.observer.disconnect();
  state.layer.remove();
  previewStates.delete(state);
}

function schedulePreview(state: PreviewState): void {
  window.cancelAnimationFrame(state.frame);
  window.clearTimeout(state.retryTimer);
  state.frame = window.requestAnimationFrame(() => renderPreviewMargins(state));
}

/** Retry a pass that could not place cards yet: the preview may not have
 *  been laid out (gutter measured as zero) or the marks may not exist. */
function retryLater(state: PreviewState): void {
  if (state.retries >= 10) return;
  state.retries += 1;
  window.clearTimeout(state.retryTimer);
  state.retryTimer = window.setTimeout(
    () => renderPreviewMargins(state),
    80 * state.retries
  );
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
  // A missing/NaN setting must not produce a zero-width card.
  const configuredWidth =
    Number.isFinite(plugin.settings.marginWidth) && plugin.settings.marginWidth > 0
      ? plugin.settings.marginWidth
      : 200;
  const width = Math.min(configuredWidth, available);
  return {
    width,
    left:
      side === "left"
        ? contentRect.left - previewRect.left - gap - width
        : contentRect.right - previewRect.left + gap
  };
}

const marginComponents = new WeakMap<HTMLElement, Component>();

function renderPreviewMargins(state: PreviewState): void {
  const { preview, layer, plugin } = state;
  if (!preview.isConnected) {
    destroyPreviewState(state);
    return;
  }
  layer.empty();
  layer.style.height = `${preview.scrollHeight}px`;
  if (!plugin.settings.showMargins || plugin.areMarginsSuppressed()) {
    state.retries = 0;
    return;
  }
  const placement = measurePlacement(state);
  if (!placement) {
    // No gutter yet (layout not ready, or pane too narrow): try again shortly.
    retryLater(state);
    return;
  }
  const filePath = preview.dataset.marginaliaSourcePath;
  if (!filePath) {
    retryLater(state);
    return;
  }
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

  if (entries.length === 0) {
    // No annotations here: nothing to retry. Otherwise the marks may simply
    // not exist yet in this pass, so try again shortly.
    if (plugin.store.forSource(filePath).length === 0) state.retries = 0;
    else retryLater(state);
    return;
  }
  state.retries = 0;

  marginComponents.get(layer)?.unload();
  const component = new Component();
  component.load();
  marginComponents.set(layer, component);
  const stacked: Array<{ card: HTMLElement; desiredTop: number }> = [];
  const stack = (): void => {
    let nextTop = 6;
    for (const item of stacked) {
      const top = Math.max(item.desiredTop, nextTop);
      item.card.style.top = `${Math.floor(top)}px`;
      nextTop = top + item.card.getBoundingClientRect().height + 8;
    }
  };
  for (const entry of entries) {
    const card = layer.createDiv({
      cls: `marginalia-margin-card marginalia-margin-card-reading${
        plugin.settings.forceLongWordBreaks
          ? " marginalia-force-word-breaks"
          : ""
      }`,
      attr: {
        "data-marginalia-id": entry.annotation.id,
        tabindex: "0",
        role: "button",
        "aria-label": `Open annotation: ${entry.annotation.body}`
      }
    });
    card.style.setProperty(
      "--marginalia-card-color",
      entry.annotation.color ?? plugin.settings.highlightColor
    );
    const body = card.createDiv({
      cls: "marginalia-margin-card-body markdown-rendered"
    });
    const renderInto = (target: HTMLElement, markdown: string): void => {
      void MarkdownRenderer.render(plugin.app, markdown, target, filePath, component)
        .then(stack)
        .catch(() => {
          target.textContent = markdown;
        });
    };
    renderInto(body, entry.annotation.body);
    for (const reply of entry.annotation.replies) {
      renderInto(
        card.createDiv({
          cls: "marginalia-margin-card-reply markdown-rendered"
        }),
        reply.body
      );
    }
    card.style.left = `${Math.floor(placement.left)}px`;
    card.style.width = `${Math.floor(placement.width)}px`;
    stacked.push({ card, desiredTop: entry.desiredTop });
    card.addEventListener("click", () =>
      void plugin.activateAnnotation(entry.annotation.id)
    );
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void plugin.activateAnnotation(entry.annotation.id);
    });
  }
  stack();
  // Self-heal: a theme (or another plugin) hiding the layer must not make
  // annotations invisible. The class re-asserts the layout with higher
  // specificity than the stylesheet rule that hid it.
  if (layer.getClientRects().length === 0) {
    layer.addClass("marginalia-reading-margin-layer-forced");
  }
}

export function refreshReadingMargins(plugin: MarginaliaPlugin): void {
  for (const state of previewStates) {
    if (state.plugin === plugin) schedulePreview(state);
  }
}

export function processReadingView(
  element: HTMLElement,
  context: MarkdownPostProcessorContext,
  plugin: MarginaliaPlugin
): void {
  if (element.closest(OWN_UI)) return;
  processReadingViewInner(element, context, plugin);
}

function processReadingViewInner(
  element: HTMLElement,
  context: MarkdownPostProcessorContext,
  plugin: MarginaliaPlugin
): void {
  if (context.sourcePath.startsWith(".marginalia-bona/")) return;
  const annotations = plugin.store
    .forSource(context.sourcePath)
    .filter(
      (annotation) =>
        annotation.anchor.kind === "markdown" &&
        (annotation.status !== "resolved" || plugin.settings.showResolved)
    );
  for (const annotation of annotations) {
    if (!plugin.settings.showHighlights) continue;
    try {
      highlightOccurrence(element, annotation, plugin);
    } catch (error) {
      // A single block must never abort the whole Reading view pass.
      console.warn("Marginalia: could not mark a passage in Reading view", error);
    }
  }
  const preview = readingContainerFor(element);
  if (!preview) return;
  preview.dataset.marginaliaSourcePath = context.sourcePath;
  schedulePreview(ensurePreviewState(preview, plugin));
}
