import { HoverPopover, MarkdownRenderer, MarkdownView } from "obsidian";
import type MarginaliaPlugin from "../main";
import { Annotation } from "../domain/annotation";

export type HoverPreviewMode = "off" | "hover" | "ctrl";

/** Pure gate so the interaction rule is unit-testable: "hover" always
 *  allows, "ctrl" requires Ctrl/Cmd held when the pointer enters. */
export function hoverModeAllows(
  mode: HoverPreviewMode,
  modifiers: { ctrlKey: boolean; metaKey: boolean }
): boolean {
  if (mode === "off") return false;
  if (mode === "ctrl") return modifiers.ctrlKey || modifiers.metaKey;
  return true;
}

const SHOW_DELAY_MS = 250;

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

/** Hover previews over marked passages: one document-level delegation for
 *  editor and reading view (both marks carry data-marginalia-id). Shows a
 *  native HoverPopover after a short delay; dismissed by moving away,
 *  pressing the mouse (text selection), scrolling, or Escape. */
export function registerHoverPreview(plugin: MarginaliaPlugin): void {
  let popover: HoverPopover | null = null;
  let showTimer = 0;

  const hide = (): void => {
    window.clearTimeout(showTimer);
    if (popover) {
      popover.unload();
      popover = null;
    }
  };

  const show = (mark: HTMLElement, annotation: Annotation): void => {
    hide();
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    popover = new HoverPopover(view, mark, 0);
    popover.hoverEl.addClass("marginalia-hover-preview");
    popover.hoverEl.setAttribute("data-marginalia-id", annotation.id);

    const wrap = popover.hoverEl.createDiv({ cls: "marginalia-hover-body" });
    const meta = wrap.createDiv({ cls: "marginalia-hover-meta" });
    meta.createSpan({
      text: `${annotation.author ?? "user"} · ${formatTime(annotation.createdAt)}`
    });
    const body = wrap.createDiv({
      cls: "marginalia-hover-comment markdown-rendered"
    });
    // The view (not the plugin) is the render lifecycle owner: when the
    // view closes, its renders unload instead of leaking.
    void MarkdownRenderer.render(
      plugin.app,
      annotation.body,
      body,
      annotation.sourcePath,
      view
    );
    for (const reply of annotation.replies) {
      const replyEl = wrap.createDiv({ cls: "marginalia-hover-reply" });
      replyEl.createSpan({
        cls: "marginalia-hover-reply-meta",
        text: `${reply.author ?? "user"} · ${formatTime(reply.createdAt)}`
      });
      const replyBody = replyEl.createDiv({
        cls: "marginalia-hover-reply-body markdown-rendered"
      });
      void MarkdownRenderer.render(
        plugin.app,
        reply.body,
        replyBody,
        annotation.sourcePath,
        view
      );
    }
    wrap.addEventListener("click", (event) => {
      event.stopPropagation();
      hide();
      void plugin.activateAnnotation(annotation.id);
    });
  };

  plugin.registerDomEvent(document, "mouseover", (event: MouseEvent) => {
    if (!hoverModeAllows(plugin.settings.hoverPreview, event)) {
      hide();
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const mark = target.closest<HTMLElement>(
      ".marginalia-highlight[data-marginalia-id]"
    );
    if (!mark) return;
    const id = mark.dataset.marginaliaId;
    const annotation = id ? plugin.store.get(id) : undefined;
    if (!annotation || !id) return;
    if (popover?.hoverEl.dataset.marginaliaId === id) return;
    window.clearTimeout(showTimer);
    showTimer = window.setTimeout(() => show(mark, annotation), SHOW_DELAY_MS);
  });

  plugin.registerDomEvent(document, "mouseout", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.closest(".marginalia-highlight[data-marginalia-id]")) return;
    const related = event.relatedTarget;
    if (
      related instanceof HTMLElement &&
      (related.closest(".marginalia-highlight[data-marginalia-id]") ||
        related.closest(".marginalia-hover-preview"))
    ) {
      return;
    }
    hide();
  });

  // Text selection must never fight the preview: pressing the mouse on a
  // mark cancels a pending or visible popover immediately.
  plugin.registerDomEvent(document, "mousedown", (event: MouseEvent) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest(".marginalia-hover-preview")
    ) {
      return;
    }
    hide();
  });

  plugin.registerDomEvent(
    window,
    "scroll",
    () => hide(),
    { capture: true, passive: true }
  );
  plugin.registerDomEvent(document, "keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") hide();
  });
}
