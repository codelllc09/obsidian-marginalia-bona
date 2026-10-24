import {
  ItemView,
  MarkdownRenderer,
  Menu,
  Notice,
  WorkspaceLeaf,
  setIcon
} from "obsidian";
import type SidenPlugin from "../main";
import {
  Annotation,
  AnnotationReply,
  MARK_STYLES,
  MarkStyle,
  NewAnnotation
} from "../domain/annotation";
import { MARK_COLORS } from "../domain/marks";
import { ConfirmModal } from "./confirm-modal";

export const SIDEN_VIEW_TYPE = "siden-annotations";

type Scope = "current" | "vault";
type StatusFilter = "open" | "resolved" | "orphaned" | "all";

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

function formatReplyTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

const MARK_STYLE_LABELS: Record<MarkStyle, string> = {
  highlight: "Highlight",
  underline: "Underline",
  wavy: "Wavy",
  strikethrough: "Strike",
  bold: "Bold"
};

export class SidenSidebarView extends ItemView {
  private viewScope: Scope = "current";
  private status: StatusFilter = "open";
  private query = "";
  private activeId: string | null = null;
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

  constructor(leaf: WorkspaceLeaf, private readonly plugin: SidenPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return SIDEN_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Siden annotations";
  }

  getIcon(): string {
    return "message-square-text";
  }

  async onOpen(): Promise<void> {
    this.render();
    this.plugin.refresh();
  }

  async onClose(): Promise<void> {
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
      .querySelectorAll(".siden-card.is-active")
      .forEach((element) => element.removeClass("is-active"));
    if (id) {
      const card = this.containerEl.querySelector(`[data-siden-id="${id}"]`);
      card?.addClass("is-active");
      card?.scrollIntoView({ block: "nearest" });
    }
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
    root.addClass("siden-sidebar");
    root.toggleClass(
      "siden-force-word-breaks",
      this.plugin.settings.forceLongWordBreaks
    );

    this.renderToolbar(root);
    // Only the body below the toolbar is re-rendered while typing so that
    // the search input and IME composition are never destroyed mid-input.
    this.bodyEl = root.createDiv({ cls: "siden-body" });
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
      active.classList.contains("siden-draft-textarea");
    const caret = wasDraftTextarea ? active.selectionStart : null;
    root.empty();
    if (this.draft) this.renderDraft(root);
    const list = root.createDiv({ cls: "siden-list" });
    this.listEl = list;
    const annotations = this.visibleAnnotations();
    if (annotations.length === 0) {
      list.createDiv({
        cls: "siden-empty",
        text: "No annotations match the current view."
      });
      return;
    }
    for (const annotation of annotations) this.renderCard(list, annotation);
    if (wasDraftTextarea) this.focusDraft(caret ?? 0);
  }

  private renderDraft(root: HTMLElement): void {
    if (!this.draft) return;
    const draft = this.draft;
    const form = root.createDiv({ cls: "siden-draft" });
    form.createEl("label", {
      cls: "siden-draft-label",
      text: draft.mode === "create" ? "New annotation" : "Edit annotation"
    });
    const textarea = form.createEl("textarea", {
      cls: "siden-draft-textarea",
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
    const actions = form.createDiv({ cls: "siden-draft-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.cancelDraft());
    const save = actions.createEl("button", {
      cls: "mod-cta",
      text: "Save"
    });
    save.addEventListener("click", () => void this.saveDraft());
  }

  private renderStylePicker(form: HTMLElement, draft: DraftState): void {
    const picker = form.createDiv({ cls: "siden-draft-style" });
    const styles = picker.createDiv({ cls: "siden-draft-styles" });
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
    const colors = picker.createDiv({ cls: "siden-draft-colors" });
    const auto = colors.createEl("button", {
      text: "Auto",
      attr: { type: "button", "aria-label": "Default color", "aria-pressed": String(draft.color === null) }
    });
    auto.className = draft.color === null ? "is-selected" : "";
    auto.addEventListener("click", () => {
      if (this.draft) this.draft.color = null;
      this.renderBody();
      this.focusDraft(0);
    });
    for (const color of MARK_COLORS) {
      const swatch = colors.createEl("button", {
        attr: {
          type: "button",
          "aria-label": color,
          "aria-pressed": String(draft.color === color)
        }
      });
      swatch.className =
        draft.color === color ? "siden-swatch is-selected" : "siden-swatch";
      swatch.style.setProperty("--siden-swatch-color", color);
      swatch.addEventListener("click", () => {
        if (this.draft) this.draft.color = color;
        this.renderBody();
        this.focusDraft(0);
      });
    }
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
        ...style
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
          ".siden-draft-textarea"
        );
      if (textarea) {
        textarea.focus();
        if (cursorAt !== undefined) textarea.setSelectionRange(cursorAt, cursorAt);
      }
    });
  }

  private renderToolbar(root: HTMLElement): void {
    const toolbar = root.createDiv({ cls: "siden-toolbar" });
    const collapseButton = toolbar.createEl("button", {
      cls: "clickable-icon siden-collapse-toggle",
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
      cls: "clickable-icon siden-scroll-button",
      attr: { "aria-label": "Scroll annotations back to top" }
    });
    setIcon(topButton, "arrow-up");
    topButton.addEventListener("click", () =>
      this.listEl?.scrollTo({ top: 0, behavior: "smooth" })
    );
    const bottomButton = toolbar.createEl("button", {
      cls: "clickable-icon siden-scroll-button",
      attr: { "aria-label": "Scroll annotations to bottom" }
    });
    setIcon(bottomButton, "arrow-down");
    bottomButton.addEventListener("click", () =>
      this.listEl?.scrollTo({ top: this.listEl.scrollHeight, behavior: "smooth" })
    );
    const scopeButton = toolbar.createEl("button", {
      text: this.viewScope === "current" ? "Current file" : "Whole vault",
      attr: { "aria-label": "Toggle annotation scope" }
    });
    scopeButton.addEventListener("click", () => {
      this.viewScope = this.viewScope === "current" ? "vault" : "current";
      scopeButton.textContent =
        this.viewScope === "current" ? "Current file" : "Whole vault";
      this.renderBody();
    });

    const filter = toolbar.createEl("select", {
      attr: { "aria-label": "Filter annotation status" }
    });
    for (const [value, label] of [
      ["open", "Open"],
      ["resolved", "Resolved"],
      ["orphaned", "Orphaned"],
      ["all", "All"]
    ] as const) {
      filter.createEl("option", { value, text: label });
    }
    filter.value = this.status;
    filter.addEventListener("change", () => {
      this.status = filter.value as StatusFilter;
      this.renderBody();
    });

    const search = root.createEl("input", {
      cls: "siden-search",
      type: "search",
      placeholder: "Search annotations…",
      attr: { "aria-label": "Search annotations" }
    });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      // Re-render only the body: rebuilding the search input itself would
      // abort an active IME composition (Chinese/Japanese input).
      this.renderBody();
    });
  }

  private visibleAnnotations(): Annotation[] {
    const activePath = this.app.workspace.getActiveFile()?.path;
    let annotations =
      this.viewScope === "current" && activePath
        ? this.plugin.store.forSource(activePath)
        : this.plugin.store.all();
    if (this.status !== "all") {
      annotations = annotations.filter((item) => item.status === this.status);
    }
    const query = this.query.trim().toLocaleLowerCase();
    if (query) {
      annotations = annotations.filter((item) => {
        const quote = item.anchor.kind === "document" ? "" : item.anchor.quote.exact;
        const replies = item.replies.map((reply) => reply.body).join("\n");
        return `${item.body}\n${replies}\n${quote}\n${item.sourcePath}`
          .toLocaleLowerCase()
          .includes(query);
      });
    }
    return annotations.sort((a, b) => {
      if (a.sourcePath !== b.sourcePath) {
        return a.sourcePath.localeCompare(b.sourcePath);
      }
      const aPosition =
        a.anchor.kind === "markdown"
          ? a.anchor.startOffset
          : a.anchor.kind === "pdf"
            ? a.anchor.page
            : 0;
      const bPosition =
        b.anchor.kind === "markdown"
          ? b.anchor.startOffset
          : b.anchor.kind === "pdf"
            ? b.anchor.page
            : 0;
      return aPosition - bPosition;
    });
  }

  private renderCard(parent: HTMLElement, annotation: Annotation): void {
    const collapsed = this.isCollapsed(annotation.id);
    const card = parent.createDiv({
      cls: `siden-card siden-status-${annotation.status}${
        annotation.id === this.activeId ? " is-active" : ""
      }${collapsed ? " siden-card-collapsed" : ""}`,
      attr: {
        "data-siden-id": annotation.id,
        tabindex: "0",
        role: "button",
        "aria-expanded": String(!collapsed),
        "aria-label": `Open annotation in ${annotation.sourcePath}`
      }
    });
    card.style.setProperty(
      "--siden-card-color",
      annotation.color ?? this.plugin.settings.highlightColor
    );
    const header = card.createDiv({ cls: "siden-card-header" });
    header.createSpan({
      cls: "siden-card-source",
      text: annotation.sourcePath.split("/").pop() ?? annotation.sourcePath
    });
    if (annotation.replies.length > 0) {
      header.createSpan({
        cls: "siden-card-replies-badge",
        text: `${annotation.replies.length}`
      });
    }
    header.createSpan({
      cls: "siden-card-status",
      text: annotation.status
    });
    const menuButton = header.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": "Annotation actions" }
    });
    setIcon(menuButton, "ellipsis");
    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openMenu(event, annotation);
    });
    const cardCollapseButton = header.createEl("button", {
      cls: "clickable-icon siden-card-collapse",
      attr: {
        "aria-label": collapsed ? "Expand card" : "Collapse card",
        "aria-pressed": String(collapsed)
      }
    });
    setIcon(cardCollapseButton, collapsed ? "chevron-right" : "chevron-down");
    cardCollapseButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.collapseOverrides.set(annotation.id, !collapsed);
      this.renderBody();
    });

    if (annotation.anchor.kind !== "document" && !collapsed) {
      card.createEl("blockquote", {
        cls: "siden-card-quote",
        text: annotation.anchor.quote.exact
      });
    }
    if (!collapsed) {
      const body = card.createDiv({ cls: "siden-card-body markdown-rendered" });
      void MarkdownRenderer.render(
        this.app,
        annotation.body,
        body,
        annotation.sourcePath,
        this
      );
      for (const reply of annotation.replies) {
        this.renderReply(card, annotation, reply);
      }
      this.renderReplyComposer(card, annotation);
    } else {
      const summary = card.createDiv({ cls: "siden-card-summary" });
      summary.textContent = annotation.body.split("\n")[0];
    }

    const activate = () => void this.plugin.navigateToAnnotation(annotation);
    card.addEventListener("click", activate);
    card.addEventListener("keydown", (event) => {
      // Inner form controls (reply composer) must keep Enter/Space for text
      // input; only act when the card itself has focus.
      if (event.target !== card) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  }

  private renderReply(
    card: HTMLElement,
    annotation: Annotation,
    reply: AnnotationReply
  ): void {
    const container = card.createDiv({ cls: "siden-reply" });
    const meta = container.createDiv({ cls: "siden-reply-meta" });
    meta.createSpan({
      cls: "siden-reply-time",
      text: formatReplyTime(reply.createdAt)
    });
    const remove = meta.createEl("button", {
      cls: "clickable-icon siden-reply-remove",
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
      cls: "siden-reply-body markdown-rendered"
    });
    void MarkdownRenderer.render(
      this.app,
      reply.body,
      bodyEl,
      annotation.sourcePath,
      this
    );
    container.addEventListener("click", (event) => event.stopPropagation());
  }

  private renderReplyComposer(
    card: HTMLElement,
    annotation: Annotation
  ): void {
    if (this.replyFor === annotation.id) {
      const composer = card.createDiv({ cls: "siden-reply-composer" });
      const textarea = composer.createEl("textarea", {
        cls: "siden-reply-textarea",
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
        if (
          shouldSubmit(event, this.plugin.settings.submitShortcut)
        ) {
          event.preventDefault();
          void this.sendReply(annotation.id, textarea.value);
        }
      });
      const actions = composer.createDiv({ cls: "siden-draft-actions" });
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
      send.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.sendReply(annotation.id, textarea.value);
      });
      composer.addEventListener("click", (event) =>
        event.stopPropagation()
      );
      window.setTimeout(() => textarea.focus());
      return;
    }
    const replyButton = card.createEl("button", {
      cls: "siden-reply-button",
      text: "Reply",
      attr: { type: "button" }
    });
    replyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.replyFor = annotation.id;
      this.renderBody();
    });
  }

  private async sendReply(id: string, body: string): Promise<void> {
    if (!body.trim()) return;
    try {
      await this.plugin.store.addReply(id, body);
    } catch (error) {
      new Notice(
        error instanceof Error ? error.message : "Could not add reply."
      );
      return;
    }
    this.replyFor = null;
    this.plugin.refresh();
  }

  private openMenu(event: MouseEvent, annotation: Annotation): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle("Edit").setIcon("pencil").onClick(() => {
        this.draft = {
          mode: "edit",
          annotation,
          body: annotation.body,
          markStyle:
            annotation.markStyle ?? this.plugin.settings.defaultMarkStyle,
          color: annotation.color ?? null
        };
        this.render();
        this.focusDraft();
      })
    );
    menu.addItem((item) =>
      item
        .setTitle(annotation.status === "resolved" ? "Reopen" : "Resolve")
        .setIcon(annotation.status === "resolved" ? "rotate-ccw" : "check")
        .onClick(async () => {
          if (annotation.status === "resolved") {
            await this.plugin.store.reopen(annotation.id);
          } else {
            await this.plugin.store.resolve(annotation.id);
          }
        })
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Delete")
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => {
          new ConfirmModal(
            this.app,
            "Delete annotation?",
            "The annotation will be moved to Siden's hidden trash folder.",
            "Delete",
            async () => {
              await this.plugin.store.delete(annotation.id);
              new Notice("Annotation deleted.");
            }
          ).open();
        })
    );
    menu.showAtMouseEvent(event);
  }
}
