import {
  ItemView,
  MarkdownRenderer,
  Menu,
  Notice,
  WorkspaceLeaf,
  setIcon
} from "obsidian";
import type MarginaliaPlugin from "../main";
import {
  Annotation,
  AnnotationReply,
  MARK_STYLES,
  MarkStyle,
  NewAnnotation,
  anchorDrift
} from "../domain/annotation";
import { MARK_COLORS, resolveMarkColor, resolveMarkStyle } from "../domain/marks";
import { ConfirmModal } from "./confirm-modal";

export const MARGINALIA_VIEW_TYPE = "marginalia-annotations";


type Scope = "current" | "vault";

/** Compact "when" for reply headers: time alone for today, date otherwise.
 *  Falls back to the raw string when the timestamp is unparseable. */
function formatReplyTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
/** "drifted" is a pseudo-filter: it selects annotations whose anchored
 *  passage changed after creation (anchorDrift), regardless of status.
 *  "unread" selects annotations without a read timestamp. */
type StatusFilter = "open" | "resolved" | "orphaned" | "drifted" | "unread" | "all";

/** Sidebar sort presets; source = document order (grouped by note). */
type SortMode = "source" | "created-desc" | "created-asc" | "updated-desc";

interface DraftState {
  body: string;
  markStyle: MarkStyle;
  /** null = use the default color from settings. */
  color: string | null;
}

/** True while an IME (e.g. Chinese pinyin) is composing: keydown then
 *  carries key "Process"/keyCode 229 and must not trigger shortcuts. */
function isComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/** Sidemark-style submit rule: with "enter" a bare Enter submits and
 *  Shift+Enter makes a newline; with "mod-enter" only Ctrl/Cmd+Enter does.
 *  IME composition never submits (Chromium reports key "Process"). */
function shouldSubmit(
  event: KeyboardEvent,
  shortcut: "enter" | "mod-enter"
): boolean {
  if (isComposing(event) || event.key !== "Enter") return false;
  return shortcut === "enter"
    ? !event.shiftKey && !event.metaKey && !event.ctrlKey
    : event.metaKey || event.ctrlKey;
}

function submitHint(shortcut: "enter" | "mod-enter"): string {
  return shortcut === "enter"
    ? "Enter saves, Shift+Enter = newline"
    : "Ctrl+Enter saves";
}

const MARK_STYLE_LABELS: Record<MarkStyle, string> = {
  highlight: "Highlight",
  underline: "Underline",
  wavy: "Wavy",
  strikethrough: "Strike",
  bold: "Bold"
};

/** Human-readable swatch names for tooltips/AT (the hex codes are not). */
const MARK_COLOR_LABELS: Record<string, string> = {
  "#ffd54f": "Yellow",
  "#ffab91": "Orange",
  "#a5d6a7": "Green",
  "#90caf9": "Blue",
  "#ce93d8": "Purple",
  "#ef9a9a": "Red"
};

export class MarginaliaSidebarView extends ItemView {
  private viewScope: Scope = "current";
  private status: StatusFilter = "open";
  private query = "";
  private sortMode: SortMode = "source";
  private activeId: string | null = null;
  private flashTimer: number | null = null;
  /** A jump that has not landed yet: later re-renders must re-apply it,
   *  otherwise an event-driven rebuild resets scroll and loses the pulse. */
  private pendingJump: { id: string; until: number } | null = null;
  private draft:
    | ({ mode: "create"; input: NewAnnotation } & DraftState)
    | ({ mode: "edit"; annotation: Annotation } & DraftState)
    | null = null;
  /** Annotation id whose reply box is expanded. */
  private replyFor: string | null = null;
  private bodyEl: HTMLElement | null = null;
  /** When true, cards render as compact header-only rows. */
  private collapsed = false;
  /** Per-card collapse overrides on top of the global toggle. */
  private readonly collapseOverrides = new Map<string, boolean>();
  private listEl: HTMLElement | null = null;
  /** Cards whose images are collapsed to thumbnails (session-scoped). */
  private readonly imageCollapsed = new Map<string, boolean>();
  private lightboxEl: HTMLElement | null = null;
  /** Currently open Obsidian menu + the control that owns it, so a
   *  second click on the same control toggles it closed. */
  private openMenuInstance: Menu | null = null;
  /** Closes the currently open filter popover, if any (one at a time). */
  private openFilterClose: (() => void) | null = null;
  private openMenuOwner: HTMLElement | null = null;
  private lastMenuCloseAt = 0;
  private lastMenuOwner: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: MarginaliaPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return MARGINALIA_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Marginalia Bona annotations";
  }

  getIcon(): string {
    return "message-square-text";
  }

  async onOpen(): Promise<void> {
    this.render();
    this.plugin.refresh();
  }

  async onClose(): Promise<void> {
    this.closeLightbox();
    this.plugin.refresh();
  }

  refresh(): void {
    // Never rebuild the DOM while the user is composing: external events
    // (vault modify, active-leaf-change) fire constantly and would destroy
    // the draft/reply textarea together with focus and IME state.
    if (this.draft || this.replyFor) return;
    if (this.containerEl.isConnected) this.render();
  }

  setActiveAnnotation(id: string | null): void {
    this.activeId = id;
    this.containerEl
      .querySelectorAll(".marginalia-card.is-active")
      .forEach((element) => element.removeClass("is-active"));
    if (!id) return;
    const annotation = this.plugin.store.get(id);
    if (annotation) {
      // A jump must land on readable content: expand the card, and widen
      // filters that would hide the target entirely (a resolved annotation
      // under the Open filter, a query that excludes it, another note).
      this.collapseOverrides.set(id, false);
      const hidden = !this.visibleAnnotations().some((item) => item.id === id);
      if (hidden) {
        this.status = "all";
        this.query = "";
        if (annotation.sourcePath !== this.app.workspace.getActiveFile()?.path) {
          this.viewScope = "vault";
        }
        this.render();
      }
    }
    // Remember the jump for a moment: a rebuild triggered by any external
    // event (file open, refresh) would otherwise wipe the scroll and pulse.
    this.pendingJump = { id, until: Date.now() + 1500 };
    this.applyJump(id, true);
  }

  /** Land a jump: mark, centre when off-screen, and pulse the card.
   *  Re-applied after each rebuild while the jump window lasts; rebuilds
   *  reset the scroll position, so they land instantly instead of
   *  animating from wherever the rebuild left the list. */
  private applyJump(id: string, smooth = false): void {
    const card = this.containerEl.querySelector(
      `[data-marginalia-id="${id}"]`
    );
    if (!(card instanceof HTMLElement)) return;
    card.addClass("is-active");
    // Only move the list when the card is not already fully visible, and
    // then centre it: landing at the very top or bottom edge is what made
    // jumps feel like nothing happened.
    const scroller = this.listEl;
    if (scroller) {
      const cardRect = card.getBoundingClientRect();
      const viewRect = scroller.getBoundingClientRect();
      const fullyVisible =
        cardRect.top >= viewRect.top && cardRect.bottom <= viewRect.bottom;
      if (!fullyVisible) {
        card.scrollIntoView({
          block: "center",
          behavior: smooth ? "smooth" : "auto"
        });
      }
    }
    // A short pulse tells the eye where the jump landed.
    if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
    card.removeClass("is-flashing");
    // Restart the animation even when the same card is hit twice.
    void card.offsetWidth;
    card.addClass("is-flashing");
    this.flashTimer = window.setTimeout(() => {
      card.removeClass("is-flashing");
    }, 1400);
  }

  beginCreate(input: NewAnnotation): void {
    this.draft = {
      mode: "create",
      input,
      body: "",
      markStyle: input.markStyle ?? this.plugin.settings.defaultMarkStyle,
      color: input.color ?? null
    };
    this.render();
    this.focusDraft();
  }

  private render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("marginalia-sidebar");
    root.toggleClass(
      "marginalia-force-word-breaks",
      this.plugin.settings.forceLongWordBreaks
    );

    this.renderToolbar(root);
    // Only the body below the toolbar is re-rendered while typing so that
    // the search input and IME composition are never destroyed mid-input.
    this.bodyEl = root.createDiv({ cls: "marginalia-body" });
    this.renderBody();
  }

  private isCollapsed(id: string): boolean {
    return this.collapseOverrides.get(id) ?? this.collapsed;
  }

  private renderBody(): void {
    const root = this.bodyEl;
    if (!root) return;
    const active = document.activeElement;
    const wasDraftTextarea =
      active instanceof HTMLTextAreaElement &&
      active.classList.contains("marginalia-draft-textarea");
    const caret = wasDraftTextarea ? active.selectionStart : null;
    root.empty();
    if (this.draft) this.renderDraft(root);
    const list = root.createDiv({ cls: "marginalia-list" });
    this.listEl = list;
    const annotations = this.visibleAnnotations();
    if (annotations.length === 0) {
      let message = "No annotations match the current filters.";
      if (this.viewScope === "current") {
        message = this.app.workspace.getActiveFile()
          ? "No annotations in this file yet.\nSelect text, then right-click → Add annotation."
          : "Open a note to see its annotations.";
      }
      list.createDiv({ cls: "marginalia-empty", text: message });
      return;
    }
    for (const annotation of annotations) this.renderCard(list, annotation);
    if (wasDraftTextarea) this.focusDraft(caret ?? 0);
    // A jump in flight survives rebuilds: land it on the fresh DOM.
    if (this.pendingJump) {
      if (Date.now() < this.pendingJump.until) {
        this.applyJump(this.pendingJump.id);
      } else {
        this.pendingJump = null;
      }
    }
  }

  private renderDraft(root: HTMLElement): void {
    if (!this.draft) return;
    const draft = this.draft;
    const form = root.createDiv({ cls: "marginalia-draft" });
    form.createEl("label", {
      cls: "marginalia-draft-label",
      text: draft.mode === "create" ? "New annotation" : "Edit annotation"
    });
    const textarea = form.createEl("textarea", {
      cls: "marginalia-draft-textarea",
      attr: {
        "aria-label": "Annotation text",
        placeholder: `Write a Markdown comment… (${submitHint(
          this.plugin.settings.submitShortcut
        )})`
      }
    });
    textarea.value = draft.body;
    textarea.addEventListener("input", () => {
      if (this.draft) this.draft.body = textarea.value;
    });
    const draftSource =
      this.draft?.mode === "edit"
        ? this.draft.annotation.sourcePath
        : this.draft?.input.sourcePath ?? "";
    textarea.addEventListener("paste", (event) =>
      this.handleImagePaste(event, textarea, draftSource)
    );
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancelDraft();
        return;
      }
      if (
        shouldSubmit(event, this.plugin.settings.submitShortcut)
      ) {
        event.preventDefault();
        void this.saveDraft();
      }
    });
    this.renderStylePicker(form, draft);
    const actions = form.createDiv({ cls: "marginalia-draft-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.cancelDraft());
    const save = actions.createEl("button", {
      cls: "mod-cta",
      text: "Save"
    });
    // Empty drafts cannot save: disabled state beats a silent no-op.
    save.disabled = !textarea.value.trim();
    textarea.addEventListener("input", () => {
      save.disabled = !textarea.value.trim();
    });
    save.addEventListener("click", () => void this.saveDraft());
  }

  private renderStylePicker(form: HTMLElement, draft: DraftState): void {
    const picker = form.createDiv({ cls: "marginalia-draft-style" });
    const styles = picker.createDiv({ cls: "marginalia-draft-styles" });
    for (const style of MARK_STYLES) {
      const button = styles.createEl("button", {
        text: MARK_STYLE_LABELS[style],
        attr: {
          type: "button",
          "aria-pressed": String(draft.markStyle === style)
        }
      });
      button.className = draft.markStyle === style ? "is-selected" : "";
      button.addEventListener("click", () => {
        if (this.draft) this.draft.markStyle = style;
        this.renderBody();
        this.focusDraft(0);
      });
    }
    const colors = picker.createDiv({ cls: "marginalia-draft-colors" });
    const auto = colors.createEl("button", {
      text: "Auto",
      attr: {
        type: "button",
        "aria-label": "Auto (default color)",
        title: "Use the default color from settings",
        "aria-pressed": String(draft.color === null)
      }
    });
    auto.className = draft.color === null ? "is-selected" : "";
    auto.addEventListener("click", () => {
      if (this.draft) this.draft.color = null;
      this.renderBody();
      this.focusDraft(0);
    });
    for (const color of MARK_COLORS) {
      const colorLabel = MARK_COLOR_LABELS[color] ?? color;
      const swatch = colors.createEl("button", {
        attr: {
          type: "button",
          "aria-label": colorLabel,
          title: colorLabel,
          "aria-pressed": String(draft.color === color)
        }
      });
      swatch.className =
        draft.color === color ? "marginalia-swatch is-selected" : "marginalia-swatch";
      swatch.style.setProperty("--marginalia-swatch-color", color);
      swatch.addEventListener("click", () => {
        if (this.draft) this.draft.color = color;
        this.renderBody();
        this.focusDraft(0);
      });
    }
  }

  /** Paste images into a draft/reply textarea: saved to the attachments
   *  folder and inserted as wikilink embeds at the caret. */
  private handleImagePaste(
    event: ClipboardEvent,
    textarea: HTMLTextAreaElement,
    sourcePath: string
  ): void {
    const images = Array.from(event.clipboardData?.files ?? []).filter((file) =>
      file.type.startsWith("image/")
    );
    if (images.length === 0) return;
    event.preventDefault();
    const insertAt = textarea.selectionStart ?? textarea.value.length;
    void (async () => {
      let links = "";
      for (const image of images) {
        try {
          links += `![[${await this.plugin.saveImageAttachment(image, sourcePath)}]]\n`;
        } catch {
          new Notice("Could not save the pasted image.");
        }
      }
      if (!links) return;
      const value = textarea.value;
      textarea.value =
        value.slice(0, insertAt) + links + value.slice(insertAt);
      // Programmatic edits don't fire input; our draft/save-state listeners
      // need the synthetic event to stay in sync.
      textarea.dispatchEvent(new Event("input"));
      const caret = insertAt + links.length;
      textarea.setSelectionRange(caret, caret);
      textarea.focus();
    })();
  }

  private async saveDraft(): Promise<void> {
    const draft = this.draft;
    if (!draft?.body.trim()) return;
    const style = {
      markStyle: draft.markStyle,
      color: draft.color ?? undefined
    };
    let annotation: Annotation;
    if (draft.mode === "create") {
      annotation = await this.plugin.store.create({
        ...draft.input,
        body: draft.body.trim(),
        ...style,
        author: this.plugin.settings.userName
      });
    } else {
      annotation = await this.plugin.store.update(draft.annotation.id, {
        body: draft.body.trim(),
        ...style
      });
    }
    this.draft = null;
    this.activeId = annotation.id;
    this.render();
    await this.plugin.activateAnnotation(annotation.id);
  }

  private cancelDraft(): void {
    if (this.draft?.body.trim()) {
      new ConfirmModal(
        this.app,
        "Discard draft?",
        "Discard the unsaved annotation draft?",
        "Discard",
        () => {
          this.draft = null;
          this.render();
        }
      ).open();
      return;
    }
    this.draft = null;
    this.render();
  }

  private focusDraft(cursorAt?: number): void {
    window.setTimeout(() => {
      const textarea =
        this.containerEl.querySelector<HTMLTextAreaElement>(
          ".marginalia-draft-textarea"
        );
      if (textarea) {
        textarea.focus();
        if (cursorAt !== undefined) textarea.setSelectionRange(cursorAt, cursorAt);
      }
    });
  }

  private renderToolbar(root: HTMLElement): void {
    // Search sits at the top, outside the re-rendered body: rebuilding it
    // would abort an active IME composition (Chinese/Japanese input).
    const search = root.createEl("input", {
      cls: "marginalia-search",
      type: "search",
      placeholder: "Search annotations…",
      attr: { "aria-label": "Search annotations" }
    });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      // Re-render only the body below so the search input itself survives.
      this.renderBody();
    });

    const toolbar = root.createDiv({ cls: "marginalia-toolbar" });
    const collapseButton = toolbar.createEl("button", {
      cls: "clickable-icon marginalia-collapse-toggle",
      attr: {
        "aria-label": this.collapsed
          ? "Expand all annotation cards"
          : "Collapse all annotation cards",
        "aria-pressed": String(this.collapsed)
      }
    });
    setIcon(
      collapseButton,
      this.collapsed ? "chevrons-up-down" : "chevrons-down-up"
    );
    collapseButton.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      collapseButton.setAttribute("aria-pressed", String(this.collapsed));
      collapseButton.setAttribute(
        "aria-label",
        this.collapsed
          ? "Expand all annotation cards"
          : "Collapse all annotation cards"
      );
      setIcon(
        collapseButton,
        this.collapsed ? "chevrons-up-down" : "chevrons-down-up"
      );
      this.renderBody();
    });
    const topButton = toolbar.createEl("button", {
      cls: "clickable-icon marginalia-scroll-button",
      attr: { "aria-label": "Scroll annotations back to top" }
    });
    setIcon(topButton, "arrow-up");
    topButton.addEventListener("click", () =>
      this.listEl?.scrollTo({ top: 0, behavior: "smooth" })
    );
    const bottomButton = toolbar.createEl("button", {
      cls: "clickable-icon marginalia-scroll-button",
      attr: { "aria-label": "Scroll annotations to bottom" }
    });
    setIcon(bottomButton, "arrow-down");
    bottomButton.addEventListener("click", () =>
      this.listEl?.scrollTo({ top: this.listEl.scrollHeight, behavior: "smooth" })
    );
    // Filters get their own row of three equal columns so the triggers keep
    // a stable order and width no matter how many annotations are shown.
    const filters = root.createDiv({ cls: "marginalia-filter-row" });
    this.renderDropdown(
      filters,
      "Status",
      [
        { value: "open", label: "Open" },
        { value: "unread", label: "Unread" },
        { value: "drifted", label: "Drifted" },
        { value: "resolved", label: "Resolved" },
        { value: "orphaned", label: "Orphaned" },
        { value: "all", label: "All" }
      ],
      () => this.status,
      (value) => {
        this.status = value;
        this.renderBody();
      }
    );
    this.renderDropdown(
      filters,
      "Scope",
      [
        { value: "current", label: "Current file" },
        { value: "vault", label: "Whole vault" }
      ],
      () => this.viewScope,
      (value) => {
        this.viewScope = value;
        this.renderBody();
      }
    );
    this.renderDropdown(
      filters,
      "Sort",
      [
        { value: "source", label: "Source order" },
        { value: "created-desc", label: "Created newest" },
        { value: "created-asc", label: "Created oldest" },
        { value: "updated-desc", label: "Updated newest" }
      ],
      () => this.sortMode,
      (value) => {
        this.sortMode = value;
        this.renderBody();
      }
    );
  }

  /** Dropdown-style filter trigger: "Name: option" + chevron, opening a
   *  popover anchored under the trigger and exactly as wide as it. The list
   *  opens as a plain stacked menu so every choice is visible at once;
   *  Obsidian's context Menu follows the pointer instead, which reads as a
   *  stray floating panel next to a rail of equal-width filters. */
  private renderDropdown<T extends string>(
    parent: HTMLElement,
    name: string,
    options: ReadonlyArray<{ value: T; label: string }>,
    get: () => T,
    set: (value: T) => void
  ): void {
    const wrap = parent.createDiv({ cls: "marginalia-dropdown-wrap" });
    const button = wrap.createEl("button", {
      cls: "marginalia-dropdown",
      attr: { "aria-haspopup": "menu", "aria-expanded": "false" }
    });
    const label = button.createSpan({ cls: "marginalia-dropdown-label" });
    const iconEl = button.createSpan({ cls: "marginalia-dropdown-icon" });
    setIcon(iconEl, "chevron-down");

    const menu = wrap.createDiv({
      cls: "marginalia-dropdown-menu",
      attr: { role: "menu", "aria-label": name }
    });
    const items = options.map((option) => {
      const item = menu.createEl("button", {
        cls: "marginalia-dropdown-item",
        attr: { role: "menuitemradio", tabindex: "-1" }
      });
      const check = item.createSpan({ cls: "marginalia-dropdown-check" });
      setIcon(check, "check");
      item.createSpan({ cls: "marginalia-dropdown-item-label" }).setText(
        option.label
      );
      item.addEventListener("click", () => {
        close(true);
        if (option.value !== get()) set(option.value);
        sync();
      });
      return item;
    });

    const sync = () => {
      const current = options.find((option) => option.value === get());
      const text = `${name}: ${current?.label ?? ""}`;
      label.setText(text);
      button.setAttribute("aria-label", text);
      button.title = text;
      options.forEach((option, index) => {
        const selected = option.value === get();
        items[index].classList.toggle("is-selected", selected);
        items[index].setAttribute("aria-checked", String(selected));
      });
    };

    const isOpen = () => menu.classList.contains("is-open");

    const focusItem = (index: number) => {
      const clamped = (index + items.length) % items.length;
      items[clamped].focus();
    };

    const onOutside = (event: PointerEvent) => {
      if (!wrap.contains(event.target as Node)) close();
    };
    const onKeydown = (event: KeyboardEvent) => {
      const focused = items.indexOf(document.activeElement as HTMLButtonElement);
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          close(true);
          return;
        case "Tab":
          close();
          return;
        case "ArrowDown":
          event.preventDefault();
          focusItem(focused < 0 ? 0 : focused + 1);
          return;
        case "ArrowUp":
          event.preventDefault();
          focusItem(focused < 0 ? items.length - 1 : focused - 1);
          return;
        case "Home":
          event.preventDefault();
          focusItem(0);
          return;
        case "End":
          event.preventDefault();
          focusItem(items.length - 1);
          return;
        default:
          if (event.key === "Enter" || event.key === " ") {
            // Enter/Space on a focused item is its click; on the trigger it
            // opens the menu.
            if (focused < 0) return;
            event.preventDefault();
            items[focused].click();
          }
      }
    };

    const open = () => {
      // One popover at a time: closing through the stored handle also
      // detaches the previous menu's document listeners.
      this.openFilterClose?.();
      this.openFilterClose = () => close();
      menu.classList.remove("is-end");
      menu.classList.add("is-open");
      // Keep the grown popover inside the sidebar: cap its width at the
      // view's, and flip to right-alignment when it would overflow.
      const boundary = this.containerEl.getBoundingClientRect();
      menu.style.maxWidth = `${Math.max(160, boundary.width - 8)}px`;
      const wrapRect = wrap.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      if (wrapRect.left + menuRect.width > boundary.right - 4) {
        menu.classList.add("is-end");
      }
      button.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", onOutside, true);
      document.addEventListener("keydown", onKeydown, true);
      const selected = options.findIndex((option) => option.value === get());
      const target = items[selected] ?? items[0];
      target.focus();
      target.scrollIntoView({ block: "nearest" });
    };

    const close = (focusTrigger = false) => {
      if (!isOpen()) return;
      menu.classList.remove("is-open");
      button.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKeydown, true);
      if (this.openFilterClose) this.openFilterClose = null;
      if (focusTrigger) button.focus();
    };

    sync();
    button.addEventListener("click", () => {
      if (isOpen()) close();
      else open();
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!isOpen()) open();
      }
    });
  }

  private visibleAnnotations(): Annotation[] {
    const activePath = this.app.workspace.getActiveFile()?.path;
    const sort =
      this.sortMode === "source"
        ? { sort: "source" as const }
        : this.sortMode === "created-asc"
          ? { sort: "created" as const, dir: "asc" as const }
          : this.sortMode === "created-desc"
            ? { sort: "created" as const, dir: "desc" as const }
            : { sort: "updated" as const, dir: "desc" as const };
    return this.plugin.store.query({
      source: this.viewScope === "current" ? activePath : undefined,
      status:
        this.status === "all" ||
        this.status === "drifted" ||
        this.status === "unread"
          ? undefined
          : this.status,
      drifted: this.status === "drifted" || undefined,
      unread: this.status === "unread" || undefined,
      q: this.query.trim() || undefined,
      ...sort
    });
  }

  private renderCard(parent: HTMLElement, annotation: Annotation): void {
    const collapsed = this.isCollapsed(annotation.id);
    const card = parent.createDiv({
      cls: `marginalia-card marginalia-status-${annotation.status}${
        annotation.id === this.activeId ? " is-active" : ""
      }${collapsed ? " marginalia-card-collapsed" : ""}`,
      attr: { "data-marginalia-id": annotation.id }
    });
    card.style.setProperty(
      "--marginalia-card-color",
      annotation.color ?? this.plugin.settings.highlightColor
    );
    const header = card.createDiv({ cls: "marginalia-card-header" });
    const cardCollapseButton = header.createEl("button", {
      cls: "clickable-icon marginalia-card-collapse",
      attr: {
        "aria-label": collapsed ? "Expand card" : "Collapse card",
        "aria-expanded": String(!collapsed)
      }
    });
    setIcon(cardCollapseButton, collapsed ? "chevron-right" : "chevron-down");
    cardCollapseButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.collapseOverrides.set(annotation.id, !collapsed);
      this.renderBody();
    });
    header.createSpan({
      cls: "marginalia-card-source",
      text: annotation.sourcePath.split("/").pop() ?? annotation.sourcePath
    });
    // Unread dot: readAt is only ever written by an explicit mark-read.
    if (annotation.readAt === undefined) {
      header.createSpan({
        cls: "marginalia-card-unread",
        attr: { "aria-label": "Unread annotation" }
      });
    }
    if (annotation.replies.length > 0) {
      header.createSpan({
        cls: "marginalia-card-replies-badge",
        text: `${annotation.replies.length}`
      });
    }
    // Resolved state is conveyed by the resolve/reopen button itself plus
    // the dimmed card style; orphaned and re-anchoring states have no
    // dedicated control, so they are labelled inline.
    const reanchoring = this.plugin.pendingReanchorId() === annotation.id;
    if (reanchoring) {
      header.createSpan({
        cls: "marginalia-card-status",
        text: "re-anchoring..."
      });
    } else if (annotation.status === "orphaned") {
      header.createSpan({
        cls: "marginalia-card-status",
        text: "orphaned"
      });
    }

    // Top-right keeps only state-related and overflow actions; frequent
    // navigation/edit live in the card footer next to Reply.
    const actions = header.createDiv({ cls: "marginalia-card-actions" });
    const resolveButton = actions.createEl("button", {
      cls: "clickable-icon marginalia-card-resolve",
      attr: {
        "aria-label":
          annotation.status === "resolved"
            ? "Reopen annotation"
            : "Resolve annotation"
      }
    });
    setIcon(
      resolveButton,
      annotation.status === "resolved" ? "rotate-ccw" : "check"
    );
    resolveButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (annotation.status === "resolved") {
        void this.plugin.store.reopen(annotation.id);
      } else {
        void this.plugin.store.resolve(annotation.id);
      }
    });
    const copyButton = actions.createEl("button", {
      cls: "clickable-icon marginalia-card-copy",
      attr: { "aria-label": "Copy comment" }
    });
    setIcon(copyButton, "copy");
    copyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.copyText(annotation.body, "Comment copied.");
    });
    const menuButton = actions.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": "More actions" }
    });
    setIcon(menuButton, "ellipsis");
    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openMenu(event, annotation, menuButton);
    });

    if (annotation.anchor.kind !== "document" && !collapsed) {
      // Drift: the passage was edited after the annotation was created.
      // Show the original struck through next to the live quote; ✓ keeps
      // the current text as the new baseline.
      const drift = anchorDrift(annotation);
      if (drift) {
        const driftEl = card.createDiv({ cls: "marginalia-card-drift" });
        const head = driftEl.createDiv({ cls: "marginalia-card-drift-head" });
        head.createSpan({
          cls: "marginalia-card-drift-chip",
          text: "text changed"
        });
        const accept = head.createEl("button", {
          cls: "clickable-icon marginalia-card-drift-accept",
          attr: {
            "aria-label": "Keep the current text (clear drift)",
            title: "Keep the current text"
          }
        });
        setIcon(accept, "check");
        accept.addEventListener("click", (event) => {
          event.stopPropagation();
          if (annotation.anchor.kind !== "markdown") return;
          void this.plugin.store
            .update(annotation.id, {
              // Accepting means the live text is authoritative: an
              // annotation whose passage is back is no longer orphaned.
              ...(annotation.status === "orphaned"
                ? { status: "open" as const }
                : {}),
              anchor: {
                ...annotation.anchor,
                originalQuote: annotation.anchor.quote.exact
              }
            })
            .then(() => this.plugin.refresh());
        });
        driftEl.createSpan({
          cls: "marginalia-card-drift-original",
          text: drift.original,
          attr: { title: drift.original }
        });
      }

      // The quote preview wears the same decoration as the in-text mark:
      // the card hints at highlight/underline/wavy/… at a glance.
      const markStyle = resolveMarkStyle(
        annotation,
        this.plugin.settings.defaultMarkStyle
      );
      const quote = card.createEl("blockquote", {
        cls: `marginalia-card-quote marginalia-mark-${markStyle}`
      });
      quote.style.setProperty(
        "--marginalia-mark-color",
        resolveMarkColor(annotation, this.plugin.settings.highlightColor)
      );
      quote.setText(annotation.anchor.quote.exact);
    }
    if (!collapsed) {
      const body = card.createDiv({ cls: "marginalia-card-body markdown-rendered" });
      void MarkdownRenderer.render(
        this.app,
        annotation.body,
        body,
        annotation.sourcePath,
        this
      ).then(() => this.enhanceImages(body, annotation));
      if (annotation.replies.length > 0) {
        const replies = card.createDiv({ cls: "marginalia-replies" });
        for (const reply of annotation.replies) {
          this.renderReply(replies, annotation, reply);
        }
      }
      if (this.replyFor === annotation.id) {
        this.renderReplyComposer(card, annotation);
      }
      this.renderCardFooter(card, annotation);
    } else {
      // Collapsed rows have no footer: clicking anywhere expands them.
      card.addEventListener("click", () => {
        this.collapseOverrides.set(annotation.id, false);
        this.renderBody();
      });
      const summary = card.createDiv({ cls: "marginalia-card-summary" });
      summary.textContent = annotation.body.split("\n")[0];
    }
  }

  /** Bottom row: Reply on the left, Edit and Jump on the right. */
  private renderCardFooter(card: HTMLElement, annotation: Annotation): void {
    const footer = card.createDiv({ cls: "marginalia-card-footer" });
    const replyButton = footer.createEl("button", {
      cls: "marginalia-footer-action",
      attr: { type: "button", "aria-label": "Reply to annotation" }
    });
    setIcon(replyButton, "reply");
    replyButton.createSpan({ text: "Reply" });
    replyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.replyFor = annotation.id;
      this.renderBody();
    });
    footer.createDiv({ cls: "marginalia-card-footer-spacer" });
    if (annotation.status === "orphaned") {
      // Nothing to jump to: the passage is gone. Re-anchor replaces Jump
      // while orphaned - it is the whole reason the card is stuck.
      const pending = this.plugin.pendingReanchorId() === annotation.id;
      const reanchorButton = footer.createEl("button", {
        cls: "marginalia-footer-action" + (pending ? " marginalia-footer-action-active" : ""),
        attr: {
          type: "button",
          "aria-label": pending ? "Cancel re-anchoring" : "Re-anchor to a new passage"
        }
      });
      setIcon(reanchorButton, "anchor");
      reanchorButton.createSpan({ text: pending ? "Cancel" : "Re-anchor" });
      reanchorButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (pending) {
          this.plugin.cancelReanchor();
        } else {
          this.plugin.startReanchor(annotation.id);
        }
      });
    }
    const editButton = footer.createEl("button", {
      cls: "marginalia-footer-action",
      attr: { type: "button", "aria-label": "Edit annotation" }
    });
    setIcon(editButton, "pencil");
    editButton.createSpan({ text: "Edit" });
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.beginEdit(annotation);
    });
    const readButton = footer.createEl("button", {
      cls: "marginalia-footer-action",
      attr: {
        type: "button",
        "aria-label": annotation.readAt ? "Mark unread" : "Mark read"
      }
    });
    setIcon(readButton, annotation.readAt ? "eye-off" : "eye");
    readButton.createSpan({ text: annotation.readAt ? "Unread" : "Read" });
    readButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.plugin.store.update(annotation.id, {
        readAt: annotation.readAt ? undefined : new Date().toISOString()
      });
    });
    if (annotation.status !== "orphaned") {
      const jumpButton = footer.createEl("button", {
        cls: "marginalia-footer-action",
        attr: { type: "button", "aria-label": "Jump to annotated text" }
      });
      setIcon(jumpButton, "external-link");
      jumpButton.createSpan({ text: "Jump" });
      jumpButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.plugin.navigateToAnnotation(annotation);
      });
    }
  }


  /** Chip that collapses/expands a card's images: text beats icons at
   *  this size - every icon variant (chevrons, triangles) was ambiguous. */
  private renderImageChip(
    container: HTMLElement,
    annotation: Annotation,
    collapsed: boolean
  ): HTMLElement {
    const button = container.createEl("button", {
      cls: "marginalia-img-chip",
      attr: {
        "aria-label": collapsed ? "Show images" : "Hide images",
        title: collapsed ? "Show images" : "Hide images"
      }
    });
    const icon = button.createSpan({ cls: "marginalia-img-chip-icon" });
    setIcon(icon, collapsed ? "chevron-down" : "chevron-up");
    button.createSpan({
      cls: "marginalia-img-chip-label",
      text: collapsed ? "Show images" : "Hide images"
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.imageCollapsed.set(annotation.id, !collapsed);
      this.renderBody();
    });
    return button;
  }

  private enhanceImages(container: HTMLElement, annotation: Annotation): void {
    const images = Array.from(container.querySelectorAll("img"));
    if (images.length === 0) return;
    const collapsed = this.imageCollapsed.get(annotation.id) ?? false;
    container.toggleClass("marginalia-imgs-collapsed", collapsed);
    if (!container.isConnected) return;

    const chipRow = this.renderImageChip(container, annotation, collapsed);
    container.insertBefore(chipRow, container.firstChild);

    for (const img of images) {
      const frame = createSpan({ cls: "marginalia-img-frame" });
      img.replaceWith(frame);
      frame.appendChild(img);
      frame.addEventListener("click", (event) => {
        event.stopPropagation();
        this.openLightbox(img.src);
      });
    }
  }

  /** Full-size temporary view over a dimmed backdrop; click/Esc closes. */
  private openLightbox(src: string): void {
    if (this.lightboxEl) {
      this.closeLightbox();
      return;
    }
    const backdrop = createDiv({ cls: "marginalia-lightbox" });
    backdrop.createEl("img", { attr: { src } });
    const close = (): void => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      this.lightboxEl = null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(backdrop);
    this.lightboxEl = backdrop;
  }

  private closeLightbox(): void {
    this.lightboxEl?.remove();
    this.lightboxEl = null;
  }

  private beginEdit(annotation: Annotation): void {
    this.draft = {
      mode: "edit",
      annotation,
      body: annotation.body,
      markStyle: annotation.markStyle ?? this.plugin.settings.defaultMarkStyle,
      color: annotation.color ?? null
    };
    this.render();
    this.focusDraft();
  }

  private renderReply(
    parent: HTMLElement,
    annotation: Annotation,
    reply: AnnotationReply
  ): void {
    const container = parent.createDiv({ cls: "marginalia-reply" });
    const head = container.createDiv({ cls: "marginalia-reply-head" });
    const author = head.createSpan({ cls: "marginalia-reply-author" });
    author.setText(reply.author ?? "user");
    const time = head.createSpan({ cls: "marginalia-reply-time" });
    time.setText(formatReplyTime(reply.createdAt));
    time.title = reply.createdAt;
    const meta = head.createDiv({ cls: "marginalia-reply-actions" });
    const copyReply = meta.createEl("button", {
      cls: "clickable-icon marginalia-reply-copy",
      attr: { "aria-label": "Copy reply" }
    });
    setIcon(copyReply, "copy");
    copyReply.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.copyText(reply.body, "Reply copied.");
    });
    const remove = meta.createEl("button", {
      cls: "clickable-icon marginalia-reply-remove",
      attr: { "aria-label": "Delete reply" }
    });
    setIcon(remove, "x");
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.plugin.store
        .deleteReply(annotation.id, reply.id)
        .then(() => this.plugin.refresh());
    });
    const bodyEl = container.createDiv({
      cls: "marginalia-reply-body markdown-rendered"
    });
    void MarkdownRenderer.render(
      this.app,
      reply.body,
      bodyEl,
      annotation.sourcePath,
      this
    ).then(() => this.enhanceImages(bodyEl, annotation));
    container.addEventListener("click", (event) => event.stopPropagation());
  }

  private renderReplyComposer(
    card: HTMLElement,
    annotation: Annotation
  ): void {
    if (this.replyFor !== annotation.id) return;
    const composer = card.createDiv({ cls: "marginalia-reply-composer" });
    const textarea = composer.createEl("textarea", {
      cls: "marginalia-reply-textarea",
      attr: {
        "aria-label": "Reply text",
        placeholder: `Reply… (${submitHint(
          this.plugin.settings.submitShortcut
        )})`
      }
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.replyFor = null;
        this.renderBody();
        return;
      }
      if (shouldSubmit(event, this.plugin.settings.submitShortcut)) {
        event.preventDefault();
        void this.sendReply(annotation.id, textarea.value);
      }
    });
    const actions = composer.createDiv({ cls: "marginalia-draft-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", (event) => {
      event.stopPropagation();
      this.replyFor = null;
      this.renderBody();
    });
    const send = actions.createEl("button", {
      cls: "mod-cta",
      text: "Reply"
    });
    send.disabled = !textarea.value.trim();
    textarea.addEventListener("input", () => {
      send.disabled = !textarea.value.trim();
    });
    textarea.addEventListener("paste", (event) =>
      this.handleImagePaste(event, textarea, annotation.sourcePath)
    );
    send.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.sendReply(annotation.id, textarea.value);
    });
    composer.addEventListener("click", (event) => event.stopPropagation());
    window.setTimeout(() => {
      // Long cards: make sure the composer is actually on screen.
      composer.scrollIntoView({ block: "nearest" });
      textarea.focus();
    });
  }

  private async sendReply(id: string, body: string): Promise<void> {
    if (!body.trim()) return;
    try {
      await this.plugin.store.addReply(
        id,
        body,
        this.plugin.settings.userName
      );
    } catch (error) {
      new Notice(
        error instanceof Error ? error.message : "Could not add reply."
      );
      return;
    }
    this.replyFor = null;
    this.plugin.refresh();
  }

  private async copyText(text: string, notice: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      new Notice(notice);
    } catch {
      new Notice("Could not access the clipboard.");
    }
  }

  /** Quote + root comment + replies, ready to paste into a chat or doc. */
  private threadAsText(annotation: Annotation): string {
    const lines: string[] = [];
    if (annotation.anchor.kind !== "document") {
      lines.push(
        `> ${annotation.anchor.quote.exact.replaceAll("\n", "\n> ")}`,
        ""
      );
    }
    lines.push(annotation.body);
    for (const reply of annotation.replies) {
      lines.push("", `» ${reply.body.replaceAll("\n", "\n  ")}`);
    }
    return lines.join("\n");
  }

  /** Show an Obsidian menu with toggle semantics: clicking the same
   *  control again closes it. Obsidian's own outside-click dismissal
   *  races with the control's click handler (the dismissal may land on
   *  mousedown, before the click that re-opens), so both orders are
   *  handled: an open instance is closed, and a just-closed menu from
   *  the same owner is not immediately re-opened. */
  private showMenu(menu: Menu, event: MouseEvent, owner: HTMLElement): void {
    if (this.openMenuInstance) {
      const sameOwner = this.openMenuOwner === owner;
      this.openMenuInstance.close();
      this.openMenuInstance = null;
      this.openMenuOwner = null;
      if (sameOwner) return;
    } else if (
      this.lastMenuOwner === owner &&
      Date.now() - this.lastMenuCloseAt < 250
    ) {
      return;
    }
    menu.onHide(() => {
      if (this.openMenuInstance === menu) {
        this.openMenuInstance = null;
        this.openMenuOwner = null;
      }
      this.lastMenuCloseAt = Date.now();
      this.lastMenuOwner = owner;
    });
    this.openMenuInstance = menu;
    this.openMenuOwner = owner;
    menu.showAtMouseEvent(event);
  }

  private openMenu(
    event: MouseEvent,
    annotation: Annotation,
    owner: HTMLElement
  ): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Copy comment")
        .setIcon("copy")
        .onClick(() =>
          void this.copyText(annotation.body, "Comment copied.")
        )
    );
    menu.addItem((item) =>
      item
        .setTitle("Copy thread")
        .setIcon("messages-square")
        .onClick(() =>
          void this.copyText(
            this.threadAsText(annotation),
            "Thread copied."
          )
        )
    );
    if (annotation.anchor.kind !== "document") {
      menu.addItem((item) =>
        item
          .setTitle("Copy quote")
          .setIcon("quote")
          .onClick(() =>
            void this.copyText(
              annotation.anchor.kind === "document"
                ? ""
                : annotation.anchor.quote.exact,
              "Quote copied."
            )
          )
      );
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("Delete").setIcon("trash-2")
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => {
          new ConfirmModal(
            this.app,
            "Delete annotation?",
            "The annotation will be moved to Marginalia Bona's hidden trash folder.",
            "Delete",
            async () => {
              await this.plugin.store.delete(annotation.id);
              new Notice("Annotation deleted.");
            }
          ).open();
        })
    );
    this.showMenu(menu, event, owner);
  }
}
