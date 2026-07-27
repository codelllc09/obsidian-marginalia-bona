import {
  ItemView,
  MarkdownRenderer,
  Menu,
  Notice,
  WorkspaceLeaf,
  setIcon
} from "obsidian";
import type SidenPlugin from "../main";
import { Annotation, NewAnnotation } from "../domain/annotation";
import { ConfirmModal } from "./confirm-modal";

export const SIDEN_VIEW_TYPE = "siden-annotations";

type Scope = "current" | "vault";
type StatusFilter = "open" | "resolved" | "orphaned" | "all";

export class SidenSidebarView extends ItemView {
  private viewScope: Scope = "current";
  private status: StatusFilter = "open";
  private query = "";
  private activeId: string | null = null;
  private draft:
    | { mode: "create"; input: NewAnnotation; body: string }
    | { mode: "edit"; annotation: Annotation; body: string }
    | null = null;

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
    this.draft = { mode: "create", input, body: "" };
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
    const actions = form.createDiv({ cls: "siden-draft-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.cancelDraft());
    const save = actions.createEl("button", {
      cls: "mod-cta",
      text: "Save"
    });
    save.addEventListener("click", () => void this.saveDraft());
  }

  private async saveDraft(): Promise<void> {
    const draft = this.draft;
    if (!draft?.body.trim()) return;
    let annotation: Annotation;
    if (draft.mode === "create") {
      annotation = await this.plugin.store.create({
        ...draft.input,
        body: draft.body.trim()
      });
    } else {
      annotation = await this.plugin.store.update(draft.annotation.id, {
        body: draft.body.trim()
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

  private focusDraft(): void {
    window.setTimeout(() =>
      this.containerEl.querySelector<HTMLTextAreaElement>(".siden-draft-textarea")?.focus()
    );
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
        return `${item.body}\n${quote}\n${item.sourcePath}`
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
    const header = card.createDiv({ cls: "siden-card-header" });
    header.createSpan({
      cls: "siden-card-source",
      text: annotation.sourcePath.split("/").pop() ?? annotation.sourcePath
    });
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

    const activate = () => void this.plugin.navigateToAnnotation(annotation);
    card.addEventListener("click", activate);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  }

  private openMenu(event: MouseEvent, annotation: Annotation): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle("Edit").setIcon("pencil").onClick(() => {
        this.draft = { mode: "edit", annotation, body: annotation.body };
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
