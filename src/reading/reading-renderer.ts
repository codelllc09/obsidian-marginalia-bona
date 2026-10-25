import { Component, MarkdownPostProcessorContext, MarkdownRenderer } from "obsidian";
import type MarginaliaPlugin from "../main";
import { Annotation } from "../domain/annotation";
import { markPresentation } from "../domain/marks";
import { logEvent, reportError } from "../diagnostics";

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

interface PreviewState {
  plugin: MarginaliaPlugin;
  preview: HTMLElement;
  observer: ResizeObserver;
  frame: number;
  /** Placement can be measured before Obsidian finishes laying the preview
   *  out (or before annotations are marked), so a failed pass retries. */
  retries: number;
  retryTimer: number;
  lastPass: Record<string, unknown> | null;
  /** First block seen inside this preview: a class-name-free way to measure
   *  the content column when the sizer element cannot be found. */
  sample: HTMLElement;
}

const previewStates = new Set<PreviewState>();

/** Counters answering "did the Reading-view pipeline even run?". */
const counters = {
  passes: 0,
  statesCreated: 0,
  skippedOwnUi: 0,
  noContainer: 0,
  deferredDetached: 0,
  skippedForeignPane: 0,
  marksApplied: 0,
  marksFailed: 0
};

const loggedNoContainer = new Set<string>();

function ancestorSignature(element: HTMLElement): string[] {
  const chain: string[] = [];
  let node: HTMLElement | null = element;
  for (let depth = 0; node && depth < 8; depth += 1) {
    const cls = node.className.toString().trim().replace(/\s+/g, ".");
    chain.push(`${node.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`);
    node = node.parentElement;
  }
  return chain;
}

export function readingRunStats(): Record<string, number> {
  return { ...counters, previewStates: previewStates.size };
}

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
  const existing = markSpanFor(root, annotation.id);
  if (existing) return existing;
  const { text, segments } = textSegments(root);
  const start = locateQuote(text, annotation.anchor.quote);
  if (start < 0) {
    noteMarkFailure(annotation, text);
    return null;
  }
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

function unwrapElement(element: HTMLElement): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  element.remove();
  parent.normalize();
}

/** Only the mark is a `span`; margin cards carry the same attribute, so an
 *  unrestricted lookup would mistake a card for the passage (and then place a
 *  card relative to itself). */
function markSpanFor(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`span[data-marginalia-id="${id}"]`);
}

function findAnchor(
  root: HTMLElement,
  annotation: Annotation
): HTMLElement | null {
  const highlighted = markSpanFor(root, annotation.id);
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
/** Class-name independent: the reading view is whatever ancestor actually
 *  scrolls the document. Obsidian's class names are not a stable API. */
function scrollHostFor(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  let best: HTMLElement | null = null;
  let bestDelta = 8;
  while (node && node !== document.body) {
    const overflow = window.getComputedStyle(node).overflowY;
    // Either the stylesheet says it scrolls, or it demonstrably does. The
    // second test survives builds that scroll without declaring overflow;
    // the largest overflow wins, which is the outermost scroller.
    if (overflow === "auto" || overflow === "scroll") return node;
    const delta = node.scrollHeight - node.clientHeight;
    if (node.clientHeight > 0 && delta > bestDelta) {
      best = node;
      bestDelta = delta;
    }
    node = node.parentElement;
  }
  return best;
}

/** One canonical container per leaf: the preview view if the leaf has one,
 *  otherwise the nearest match. Without this, a block outside the preview
 *  (for example the inline title) would create a second, nested container
 *  with its own layer and duplicate every card. */
function canonicalPreviewFor(element: HTMLElement): HTMLElement | null {
  const leaf = element.closest<HTMLElement>(".workspace-leaf-content");
  const inner = leaf?.querySelector<HTMLElement>(".markdown-preview-view");
  if (inner) return inner;
  return readingContainerFor(element);
}

function readingContainerFor(element: HTMLElement): HTMLElement | null {
  const direct = element.closest<HTMLElement>(
    ".markdown-preview-view, .markdown-reading-view"
  );
  if (direct) return direct;
  const sizer = element.closest<HTMLElement>(".markdown-preview-sizer");
  if (sizer?.parentElement) return sizer.parentElement;
  const section = element.closest<HTMLElement>(".markdown-preview-section");
  if (section?.parentElement) return section.parentElement;
  const host = scrollHostFor(element);
  if (host) return host;
  return element.closest<HTMLElement>(".workspace-leaf-content");
}

function ensurePreviewState(
  preview: HTMLElement,
  plugin: MarginaliaPlugin,
  sample: HTMLElement
): PreviewState {
  const existing = [...previewStates].find(
    (state) => state.preview === preview
  );
  if (existing) return existing;
  preview.addClass("marginalia-reading-preview");
  const state: PreviewState = {
    plugin,
    preview,
    observer: new ResizeObserver(() => schedulePreview(state)),
    frame: 0,
    retries: 0,
    retryTimer: 0,
    lastPass: null,
    sample
  };
  state.observer.observe(preview);
  previewStates.add(state);
  counters.statesCreated += 1;
  plugin.register(() => destroyPreviewState(state));
  return state;
}

function destroyPreviewState(state: PreviewState): void {
  cancelAnimationFrame(state.frame);
  window.clearTimeout(state.retryTimer);
  state.observer.disconnect();
  previewStates.delete(state);
}

function schedulePreview(state: PreviewState): void {
  window.cancelAnimationFrame(state.frame);
  window.clearTimeout(state.retryTimer);
  state.frame = window.requestAnimationFrame(() => {
    try {
      renderPreviewPass(state);
    } catch (error) {
      reportError("reading-margins", error, {
        source: state.preview.dataset.marginaliaSourcePath ?? ""
      });
    }
  });
}

/** Retry a pass that could not place cards yet: the preview may not have
 *  been laid out (gutter measured as zero) or the marks may not exist. */
function retryLater(state: PreviewState): void {
  if (state.retries >= 10) {
    state.plugin.scheduleDiagnosticsSnapshot();
    if (state.lastPass?.reason === "no-gutter") state.plugin.hintNoMarginRoom();
    return;
  }
  state.retries += 1;
  window.clearTimeout(state.retryTimer);
  state.retryTimer = window.setTimeout(() => {
    try {
      renderPreviewPass(state);
    } catch (error) {
      reportError("reading-margins", error, {
        source: state.preview.dataset.marginaliaSourcePath ?? ""
      });
    }
  }, 80 * state.retries);
}

/** Height of the rendered document, excluding our own margin layer. */
function contentHeight(state: PreviewState): number {
  const { preview, sample } = state;
  const sizer =
    preview.querySelector<HTMLElement>(".markdown-preview-sizer") ??
    (sample.isConnected && preview.contains(sample) ? sample : null);
  if (sizer) {
    const rect = sizer.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const top = rect.top - previewRect.top + preview.scrollTop;
    // A little slack keeps a card next to the last paragraph from clipping.
    return Math.ceil(top + rect.height + 120);
  }
  return preview.scrollHeight;
}

function measurePlacement(state: PreviewState): {
  placement: { left: number; width: number } | null;
  available: number;
  side: string;
} {
  const { preview, plugin } = state;
  const previewRect = preview.getBoundingClientRect();
  const sizer =
    preview.querySelector<HTMLElement>(".markdown-preview-sizer") ??
    (state.sample.isConnected && preview.contains(state.sample)
      ? state.sample
      : preview);
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
  if (available < 72) return { placement: null, available, side };
  // A missing/NaN setting must not produce a zero-width card.
  const configuredWidth =
    Number.isFinite(plugin.settings.marginWidth) && plugin.settings.marginWidth > 0
      ? plugin.settings.marginWidth
      : 200;
  const width = Math.min(configuredWidth, available);
  return {
    available,
    side,
    placement: {
      width,
      left:
        side === "left"
          ? contentRect.left - previewRect.left - gap - width
          : contentRect.right - previewRect.left + gap
    }
  };
}

const marginComponents = new WeakMap<HTMLElement, Component>();

/** Marks are applied here as well as in the post-processor: Obsidian may
 *  replace the rendered section right after the post-processor ran, and then
 *  the marks would live in a discarded tree. This pass runs on the attached
 *  preview and is retried by the same schedule as the margin cards. */
function markAnnotationsInPreview(
  preview: HTMLElement,
  plugin: MarginaliaPlugin
): void {
  if (!plugin.settings.showHighlights) return;
  const filePath = preview.dataset.marginaliaSourcePath;
  if (!filePath) return;
  for (const annotation of plugin.store.forSource(filePath)) {
    if (annotation.anchor.kind !== "markdown") continue;
    if (annotation.status === "orphaned") continue;
    if (annotation.status === "resolved" && !plugin.settings.showResolved) {
      continue;
    }
    try {
      const marks = Array.from(
        preview.querySelectorAll<HTMLElement>(
          `span[data-marginalia-id="${annotation.id}"]`
        )
      );
      // Obsidian installs a clone of the rendered tree; our spans come along
      // and would double up. Identical text means a duplicate, so rebuild.
      if (marks.length > 1) {
        const texts = new Set(marks.map((mark) => mark.textContent ?? ""));
        if (texts.size === 1) {
          for (const mark of marks) unwrapElement(mark);
        }
      }
      const remaining = preview.querySelectorAll<HTMLElement>(
        `span[data-marginalia-id="${annotation.id}"]`
      ).length;
      if (remaining > 0) continue;
      highlightOccurrence(preview, annotation, plugin);
    } catch (error) {
      reportError("reading-mark", error, {
        source: filePath,
        annotation: annotation.id
      });
    }
  }
}

function renderPreviewPass(state: PreviewState): void {
  if (!state.preview.isConnected) {
    destroyPreviewState(state);
    return;
  }
  resetOwnNodes(state);
  try {
    markAnnotationsInPreview(state.preview, state.plugin);
  } catch (error) {
    reportError("reading-mark", error, {
      source: state.preview.dataset.marginaliaSourcePath ?? ""
    });
  }
  renderPreviewMargins(state);
}

/** Our own nodes are rebuilt every pass. Obsidian clones rendered sections,
 *  and a clone carries a copy of every node we injected, so keeping them
 *  across passes is what produced duplicated cards and double marks. */
function resetOwnNodes(state: PreviewState): void {
  const { preview } = state;
  const leaf = preview.closest<HTMLElement>(".workspace-leaf-content");
  const scope = leaf ?? preview;
  scope
    .querySelectorAll<HTMLElement>(".marginalia-reading-margin-layer")
    .forEach((layer) => layer.remove());
  scope.querySelectorAll<HTMLElement>("span[data-marginalia-id]").forEach((span) => {
    if (!preview.contains(span)) return;
    unwrapElement(span);
  });
}

function renderPreviewMargins(state: PreviewState): void {
  const { preview, plugin } = state;
  const layer = preview.createDiv({ cls: "marginalia-reading-margin-layer" });
  const previousReason = state.lastPass?.reason;
  const record = (reason: string, extra?: Record<string, unknown>): void => {
    state.lastPass = {
      at: new Date().toISOString(),
      reason,
      ...extra
    };
    // Log only transitions: retries would otherwise flood the report.
    if (previousReason !== reason) {
      const source = preview.dataset.marginaliaSourcePath ?? "";
      logEvent("info", "reading", `${reason} ${source}`.trim(), extra);
    }
  };
  if (!preview.isConnected) {
    record("detached");
    destroyPreviewState(state);
    return;
  }
  layer.empty();
  // The layer is absolutely positioned INSIDE the scroller, so its own height
  // counts towards scrollHeight: measuring scrollHeight here would feed the
  // previous height back in and inflate the scroll area on every pass (the
  // document then renders blank). Measure the content sizer instead.
  const height = contentHeight(state);
  layer.style.setProperty("height", `${height}px`);
  if (!plugin.settings.showMargins) {
    state.retries = 0;
    record("margins-disabled");
    return;
  }
  if (plugin.areMarginsSuppressed()) {
    state.retries = 0;
    record("suppressed-sidebar-open");
    return;
  }
  const { placement, available, side } = measurePlacement(state);
  if (!placement) {
    // No gutter yet (layout not ready, or pane too narrow): try again shortly.
      record("no-gutter", { available: Math.round(available), side });
    retryLater(state);
    return;
  }
  const filePath = preview.dataset.marginaliaSourcePath;
  if (!filePath) {
    record("no-source-path");
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
    const stored = plugin.store.forSource(filePath).length;
    record("no-located-anchors", { stored, retries: state.retries });
    if (stored === 0) state.retries = 0;
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
  record("rendered", {
    cards: stacked.length,
    left: Math.round(placement.left),
    width: Math.round(placement.width),
    available: Math.round(available),
    side
  });
  plugin.scheduleDiagnosticsSnapshot();
  // Self-heal: a theme (or another plugin) hiding the layer must not make
  // annotations invisible. The class re-asserts the layout with higher
  // specificity than the stylesheet rule that hid it.
  if (layer.getClientRects().length === 0) {
    layer.addClass("marginalia-reading-margin-layer-forced");
  }
}

function firstBlockIn(preview: HTMLElement): HTMLElement {
  return (
    preview.querySelector<HTMLElement>(
      ".markdown-preview-sizer > div, .markdown-preview-sizer > p"
    ) ?? preview
  );
}

/**
 * Process every Reading view that is actually on screen. The Markdown
 * post-processor is not enough: Obsidian renders a section off-document and
 * then installs a copy, so the nodes handed to the post-processor may never
 * be attached - marks and cards would be written into a discarded tree.
 * Called on layout/file events instead, this always works on live DOM.
 */
export function refreshReadingViews(plugin: MarginaliaPlugin): void {
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view as unknown as {
      getMode?: () => string;
      contentEl?: HTMLElement;
      file?: { path: string } | null;
    };
    if (typeof view.getMode !== "function" || !view.contentEl) return;
    if (view.getMode() !== "preview") return;
    const filePath = view.file?.path ?? "";
    if (!filePath || filePath.startsWith(".marginalia-bona/")) return;
    const container = view.contentEl;
    const preview =
      container.querySelector<HTMLElement>(
        ".markdown-preview-view, .markdown-reading-view"
      ) ??
      container.querySelector<HTMLElement>(".markdown-preview-sizer")
        ?.parentElement ??
      scrollHostFor(container.firstElementChild as HTMLElement) ??
      null;
    if (!preview) {
      counters.noContainer += 1;
      return;
    }
    if (preview.dataset.marginaliaSourcePath !== filePath) {
      preview.dataset.marginaliaSourcePath = filePath;
    }
    schedulePreview(ensurePreviewState(preview, plugin, firstBlockIn(preview)));
  });
}

/** State of every Reading view preview we manage, for the diagnostics report. */
export function describeReadingMargins(
  plugin: MarginaliaPlugin
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const state of previewStates) {
    if (state.plugin !== plugin) continue;
    rows.push({
      source: state.preview.dataset.marginaliaSourcePath ?? "",
      containerClass: state.preview.className.slice(0, 120),
      connected: state.preview.isConnected,
      cards: state.preview.querySelectorAll(".marginalia-margin-card").length,
      marks: state.preview.querySelectorAll("span[data-marginalia-id]").length,
      layers: state.preview.querySelectorAll(".marginalia-reading-margin-layer")
        .length,
      layerVisible:
        (state.preview.querySelector<HTMLElement>(
          ".marginalia-reading-margin-layer"
        )?.getClientRects().length ?? 0) > 0,
      retries: state.retries,
      lastPass: state.lastPass
    });
  }
  return rows;
}

export function refreshReadingMargins(plugin: MarginaliaPlugin): void {
  for (const state of previewStates) {
    if (state.plugin === plugin) schedulePreview(state);
  }
}

const reportedMarkFailures = new Set<string>();

/** Record why a quote could not be located: the block text and the quote are
 *  enough to see the mismatch without a debugger. */
function noteMarkFailure(annotation: Annotation, blockText: string): void {
  const key = `${annotation.sourcePath}:${annotation.id}`;
  if (reportedMarkFailures.has(key)) return;
  reportedMarkFailures.add(key);
  const quote =
    annotation.anchor.kind === "markdown" ? annotation.anchor.quote.exact : "";
  logEvent("warn", "reading-mark", "quote not found in this block", {
    annotation: annotation.id,
    quote: quote.slice(0, 120),
    block: blockText.replace(/\s+/g, " ").slice(0, 200)
  });
}

const pendingAttached = new WeakSet<HTMLElement>();

/** Obsidian renders sections off-document and runs post-processors before
 *  inserting them, so ancestry lookups fail on the first call. Wait for the
 *  element to be attached, then run the pass for real. */
function deferUntilAttached(
  element: HTMLElement,
  context: MarkdownPostProcessorContext,
  plugin: MarginaliaPlugin,
  attempt = 0
): void {
  if (element.isConnected) {
    pendingAttached.delete(element);
    processReadingView(element, context, plugin);
    return;
  }
  if (attempt >= 20) {
    pendingAttached.delete(element);
    counters.noContainer += 1;
    logEvent("warn", "reading", "block never attached to the document", {
      source: context.sourcePath
    });
    void plugin.writeDiagnosticsToVault();
    return;
  }
  window.setTimeout(
    () => deferUntilAttached(element, context, plugin, attempt + 1),
    60
  );
}

export function processReadingView(
  element: HTMLElement,
  context: MarkdownPostProcessorContext,
  plugin: MarginaliaPlugin
): void {
  counters.passes += 1;
  const leafContent = element.closest<HTMLElement>(".workspace-leaf-content");
  if (leafContent && leafContent.dataset.type !== "markdown") {
    // Markdown rendered inside another plugin's pane (chat panels, previews)
    // is not a Reading view; treating it as one creates junk states.
    counters.skippedForeignPane += 1;
    return;
  }
  if (element.closest(OWN_UI)) {
    counters.skippedOwnUi += 1;
    return;
  }
  if (!element.isConnected) {
    counters.deferredDetached += 1;
    if (!pendingAttached.has(element)) {
      pendingAttached.add(element);
      deferUntilAttached(element, context, plugin);
    }
    return;
  }
  try {
    processReadingViewInner(element, context, plugin);
  } catch (error) {
    reportError("reading", error, { source: context.sourcePath });
  }
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
      if (highlightOccurrence(element, annotation, plugin)) counters.marksApplied += 1;
      else counters.marksFailed += 1;
    } catch (error) {
      // A single block must never abort the whole Reading view pass.
      reportError("reading-mark", error, {
        source: context.sourcePath,
        annotation: annotation.id
      });
    }
  }
  const preview = canonicalPreviewFor(element);
  if (!preview) {
    counters.noContainer += 1;
    if (!loggedNoContainer.has(context.sourcePath)) {
      loggedNoContainer.add(context.sourcePath);
      logEvent("warn", "reading", "no preview container found", {
        source: context.sourcePath,
        ancestors: ancestorSignature(element)
      });
      // Auto-persist the report: a failure in a real vault must be readable
      // from disk without asking the user to copy anything.
      void plugin.writeDiagnosticsToVault();
    }
    return;
  }
  preview.dataset.marginaliaSourcePath = context.sourcePath;
  schedulePreview(ensurePreviewState(preview, plugin, element));
}
