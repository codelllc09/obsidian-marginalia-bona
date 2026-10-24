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
    if (this.draft) this.renderDraft(root);
    const list = root.createDiv({ cls: "siden-list" });
    const annotations = this.visibleAnnotations();
    if (annotations.length === 0) {
      list.createDiv({
        cls: "siden-empty",
        text: "No annotations match the current view."
      });
      return;
    }
    for (const annotation of annotations) this.renderCard(list, annotation);
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
        placeholder: "Write a Markdown comment…"
      }
    });
    textarea.value = draft.body;
    textarea.addEventListener("input", () => {
      if (this.draft) this.draft.body = textarea.value;
    });
    textarea.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void this.saveDraft();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.cancelDraft();
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
        this.render();
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
      this.render();
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
        this.render();
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
    const scopeButton = toolbar.createEl("button", {
      text: this.viewScope === "current" ? "Current file" : "Whole vault",
      attr: { "aria-label": "Toggle annotation scope" }
    });
    scopeButton.addEventListener("click", () => {
      this.viewScope = this.viewScope === "current" ? "vault" : "current";
      this.render();
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
      this.render();
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
      this.render();
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
    const card = parent.createDiv({
      cls: `siden-card siden-status-${annotation.status}${
        annotation.id === this.activeId ? " is-active" : ""
      }`,
      attr: {
        "data-siden-id": annotation.id,
        tabindex: "0",
        role: "button",
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

    if (annotation.anchor.kind !== "document") {
      card.createEl("blockquote", {
        cls: "siden-card-quote",
        text: annotation.anchor.quote.exact
      });
    }
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

    const activate = () => void this.plugin.navigateToAnnotation(annotation);
    card.addEventListener("click", activate);
    card.addEventListener("keydown", (event) => {
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
    const remove = container.createEl("button", {
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
          placeholder: "Reply… (Ctrl+Enter to send)"
        }
      });
      textarea.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          void this.sendReply(annotation.id, textarea.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          this.replyFor = null;
          this.render();
        }
      });
      const actions = composer.createDiv({ cls: "siden-draft-actions" });
      const cancel = actions.createEl("button", { text: "Cancel" });
      cancel.addEventListener("click", (event) => {
        event.stopPropagation();
        this.replyFor = null;
        this.render();
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
      this.render();
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
