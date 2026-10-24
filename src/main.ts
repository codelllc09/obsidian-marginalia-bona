import {
  Editor,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  normalizePath
} from "obsidian";
import {
  Annotation,
  MarkdownAnchor
} from "./domain/annotation";
import { createMarkdownExtension } from "./editor/markdown-extension";
import { PdfAdapter } from "./pdf/pdf-adapter";
import {
  processReadingView,
  refreshReadingMargins
} from "./reading/reading-renderer";
import {
  DEFAULT_SETTINGS,
  SidenSettings,
  SidenSettingTab
} from "./settings";
import { AnnotationStore } from "./storage/annotation-store";
import { INDEX_DIRECTORY, rebuildIndex } from "./storage/annotation-index";
import {
  SIDEN_VIEW_TYPE,
  SidenSidebarView
} from "./ui/sidebar-view";

export default class SidenPlugin extends Plugin {
  store!: AnnotationStore;
  settings: SidenSettings = DEFAULT_SETTINGS;
  editorRevision = 0;
  private pdfAdapter!: PdfAdapter;

  async onload(): Promise<void> {
    const savedSettings: unknown = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(savedSettings && typeof savedSettings === "object"
        ? savedSettings
        : {})
    };
    this.applyCssSettings();
    this.store = new AnnotationStore(this.app, undefined, () => this.refresh());
    await this.store.load();
    this.pdfAdapter = new PdfAdapter(this);
    this.pdfAdapter.start();

    this.registerView(
      SIDEN_VIEW_TYPE,
      (leaf) => new SidenSidebarView(leaf, this)
    );
    this.registerEditorExtension(createMarkdownExtension(this));
    this.registerMarkdownPostProcessor((element, context) =>
      processReadingView(element, context, this)
    );
    this.addSettingTab(new SidenSettingTab(this.app, this));
    this.addRibbonIcon("message-square-text", "Open Siden annotations", () =>
      void this.openSidebar()
    );

    this.addCommand({
      id: "open-annotations",
      name: "Open annotations",
      callback: () => void this.openSidebar()
    });
    this.addCommand({
      id: "add-markdown-annotation",
      name: "Add annotation to selection",
      editorCheckCallback: (checking, editor, view) => {
        if (
          !editor.somethingSelected() ||
          !(view instanceof MarkdownView) ||
          !view.file
        ) {
          return false;
        }
        if (!checking) this.beginMarkdownAnnotation(editor, view);
        return true;
      }
    });
    this.addCommand({
      id: "add-note-annotation",
      name: "Add annotation to current document",
      callback: () => this.beginDocumentAnnotation()
    });
    this.addCommand({
      id: "add-pdf-annotation",
      name: "Add annotation to PDF selection",
      checkCallback: (checking) => {
        const captured = this.pdfAdapter.captureSelection();
        if (!captured) return false;
        if (!checking) this.beginPdfAnnotation(captured);
        return true;
      }
    });
    this.addCommand({
      id: "rebuild-annotation-index",
      name: "Rebuild annotation index",
      callback: () => void this.rebuildAnnotationIndex()
    });
    this.addCommand({
      id: "export-annotations",
      name: "Export all annotations to Markdown",
      callback: () => void this.exportAnnotations()
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        if (
          !editor.somethingSelected() ||
          !(view instanceof MarkdownView) ||
          !view.file
        ) {
          return;
        }
        menu.addItem((item) =>
          item
            .setTitle("Add Siden annotation")
            .setIcon("message-square-plus")
            .onClick(() => this.beginMarkdownAnnotation(editor, view))
        );
      })
    );
    const pdfContextHandler = (event: MouseEvent) =>
      this.addPdfContextAction(event);
    document.addEventListener("contextmenu", pdfContextHandler, true);
    this.register(() =>
      document.removeEventListener("contextmenu", pdfContextHandler, true)
    );
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        if (file.extension !== "md" && file.extension !== "pdf") return;
        await this.store.renameSource(oldPath, file.path);
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.refresh())
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file?.extension === "md") void this.reconcileFile(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          void this.reconcileFile(file);
        }
      })
    );

    const diagnostics = this.store.getDiagnostics();
    if (diagnostics.length > 0) {
      new Notice(
        `Siden skipped ${diagnostics.length} invalid annotation file${
          diagnostics.length === 1 ? "" : "s"
        }.`
      );
      console.warn("Siden annotation diagnostics", diagnostics);
    }
  }

  onunload(): void {
    document.body.style.removeProperty("--siden-margin-width");
    document.body.style.removeProperty("--siden-highlight-color");
    document.body.style.removeProperty("--siden-highlight-opacity");
    delete document.body.dataset.sidenForceWordBreaks;
  }

  async updateSettings(changes: Partial<SidenSettings>): Promise<void> {
    this.settings = { ...this.settings, ...changes };
    await this.saveData(this.settings);
    this.applyCssSettings();
    this.refresh();
  }

  async openSidebar(): Promise<SidenSidebarView | null> {
    let leaf: WorkspaceLeaf | null | undefined =
      this.app.workspace.getLeavesOfType(SIDEN_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: SIDEN_VIEW_TYPE, active: true });
    }
    if (!leaf) return null;
    await this.app.workspace.revealLeaf(leaf);
    this.refresh();
    return leaf.view instanceof SidenSidebarView ? leaf.view : null;
  }

  areMarginsSuppressed(): boolean {
    return this.app.workspace.getLeavesOfType(SIDEN_VIEW_TYPE).some((leaf) => {
      const element = leaf.view.containerEl;
      return element.isConnected && element.getClientRects().length > 0;
    });
  }

  async activateAnnotation(id: string): Promise<void> {
    const annotation = this.store.get(id);
    if (!annotation) return;
    const sidebar = await this.openSidebar();
    sidebar?.setActiveAnnotation(id);
    this.pdfAdapter.renderVisibleHighlights(id);
  }

  async navigateToAnnotation(annotation: Annotation): Promise<void> {
    await this.activateAnnotation(annotation.id);
    if (annotation.sourceType === "pdf") {
      await this.pdfAdapter.navigate(annotation);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(annotation.sourcePath);
    if (!(file instanceof TFile)) {
      new Notice(`Source note not found: ${annotation.sourcePath}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const view = leaf.view;
    if (view instanceof MarkdownView && annotation.anchor.kind === "markdown") {
      view.editor.setSelection(
        view.editor.offsetToPos(annotation.anchor.startOffset),
        view.editor.offsetToPos(annotation.anchor.endOffset)
      );
      view.editor.scrollIntoView(
        {
          from: view.editor.offsetToPos(annotation.anchor.startOffset),
          to: view.editor.offsetToPos(annotation.anchor.endOffset)
        },
        true
      );
    }
  }

  refresh(): void {
    this.editorRevision += 1;
    for (const leaf of this.app.workspace.getLeavesOfType(SIDEN_VIEW_TYPE)) {
      if (leaf.view instanceof SidenSidebarView) leaf.view.refresh();
    }
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView)) return;
      // Obsidian does not expose CodeMirror's EditorView in its public types.
      const cm = (leaf.view.editor as Editor & { cm?: { dispatch: (value: object) => void } }).cm;
      cm?.dispatch({});
    });
    this.pdfAdapter?.renderVisibleHighlights();
    refreshReadingMargins(this);
  }

  private beginMarkdownAnnotation(editor: Editor, view: MarkdownView): void {
    if (!view.file) return;
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const exact = editor.getSelection();
    if (!exact.trim()) return;
    const startOffset = editor.posToOffset(from);
    const endOffset = editor.posToOffset(to);
    const documentText = editor.getValue();
    const anchor: MarkdownAnchor = {
      kind: "markdown",
      startOffset,
      endOffset,
      startLine: from.line,
      startCharacter: from.ch,
      endLine: to.line,
      endCharacter: to.ch,
      quote: {
        exact,
        prefix: documentText.slice(Math.max(0, startOffset - 64), startOffset),
        suffix: documentText.slice(endOffset, endOffset + 64)
      },
      quoteHash: this.hash(exact)
    };
    void this.beginSidebarDraft({
      sourcePath: view.file.path,
      sourceType: "markdown",
      status: "open",
      body: "",
      anchor
    });
  }

  private beginDocumentAnnotation(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file || (file.extension !== "md" && file.extension !== "pdf")) {
      new Notice("Open a Markdown or PDF file first.");
      return;
    }
    void this.beginSidebarDraft({
      sourcePath: file.path,
      sourceType: file.extension === "pdf" ? "pdf" : "markdown",
      status: "open",
      body: "",
      anchor: { kind: "document" }
    });
  }

  private beginPdfAnnotation(
    captured: ReturnType<PdfAdapter["captureSelection"]> & {}
  ): void {
    if (!captured) return;
    void this.beginSidebarDraft({
      sourcePath: captured.sourcePath,
      sourceType: "pdf",
      status: "open",
      body: "",
      anchor: captured.anchor
    });
  }

  private addPdfContextAction(event: MouseEvent): void {
    if (!this.pdfAdapter.isPdfContext(event.target)) return;
    const captured = this.pdfAdapter.captureSelection();
    if (!captured) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Copy selected text")
        .setIcon("copy")
        .onClick(() => void navigator.clipboard.writeText(captured.anchor.quote.exact))
    );
    menu.addItem((item) =>
      item
        .setTitle("Add Siden annotation")
        .setIcon("message-square-plus")
        .onClick(() => this.beginPdfAnnotation(captured))
    );
    menu.showAtMouseEvent(event);
  }

  private async rebuildAnnotationIndex(): Promise<void> {
    const shards = await rebuildIndex(this.app.vault.adapter, this.store.all());
    new Notice(`Siden index rebuilt: ${shards} shard files in ${INDEX_DIRECTORY}.`);
  }

  private async exportAnnotations(): Promise<void> {
    const lines = [
      "# Siden annotation export",
      "",
      `Generated ${new Date().toISOString()}`,
      ""
    ];
    for (const annotation of this.store.all()) {
      lines.push(
        `## ${annotation.sourcePath}`,
        "",
        `- Status: ${annotation.status}`,
        `- Type: ${annotation.sourceType}`,
        ...(annotation.color ? [`- Color: ${annotation.color}`] : []),
        ...(annotation.markStyle
          ? [`- Mark style: ${annotation.markStyle}`]
          : []),
        `- ID: \`${annotation.id}\``,
        ""
      );
      if (annotation.anchor.kind !== "document") {
        lines.push("> " + annotation.anchor.quote.exact.replaceAll("\n", "\n> "), "");
      }
      lines.push(annotation.body, "");
      for (const reply of annotation.replies) {
        lines.push(`> **Reply** (${reply.createdAt})`, "", reply.body, "");
      }
      lines.push("---", "");
    }
    const directory = ".siden-plus/exports";
    if (!(await this.app.vault.adapter.exists(directory))) {
      await this.app.vault.adapter.mkdir(directory);
    }
    const path = normalizePath(
      `${directory}/annotations-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.md`
    );
    await this.app.vault.adapter.write(path, lines.join("\n"));
    new Notice(`Annotations exported to ${path}`);
  }

  private async beginSidebarDraft(
    input: Parameters<SidenSidebarView["beginCreate"]>[0]
  ): Promise<void> {
    const sidebar = await this.openSidebar();
    if (!sidebar) {
      new Notice("Siden could not open its annotation sidebar.");
      return;
    }
    sidebar.beginCreate(input);
  }

  private async reconcileFile(file: TFile): Promise<void> {
    if (file.path.startsWith(".siden-plus/")) return;
    await this.store.reconcileMarkdownSource(
      file.path,
      await this.app.vault.cachedRead(file)
    );
  }

  private applyCssSettings(): void {
    document.body.style.setProperty(
      "--siden-margin-width",
      `${this.settings.marginWidth}px`
    );
    document.body.style.setProperty(
      "--siden-highlight-color",
      this.settings.highlightColor
    );
    document.body.style.setProperty(
      "--siden-highlight-opacity",
      String(this.settings.highlightOpacity)
    );
    document.body.dataset.sidenMarginSide = this.settings.marginSide;
    document.body.dataset.sidenNarrowThreshold = String(
      this.settings.narrowPaneThreshold
    );
    document.body.dataset.sidenForceWordBreaks = String(
      this.settings.forceLongWordBreaks
    );
  }

  private hash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
}
