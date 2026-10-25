import {
  Command,
  Editor,
  Events,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  normalizePath
} from "obsidian";
import { attachmentPath, attachmentsFolderFor } from "./attachments";
import { ANNOTATIONS_DIRECTORY } from "./storage/annotation-paths";
import {
  Annotation,
  MarkdownAnchor
} from "./domain/annotation";
import { createMarkdownExtension } from "./editor/markdown-extension";
import { getExportFormat } from "./export";
import { registerHoverPreview } from "./hover/hover-preview";
import { RestBridge } from "./rest-bridge";
import { PdfAdapter } from "./pdf/pdf-adapter";
import {
  describeReadingMargins,
  processReadingView,
  readingRunStats,
  refreshReadingMargins
} from "./reading/reading-renderer";
import {
  clearDiagnostics,
  diagnosticsReport,
  logEvent,
  reportError,
  setSnapshotProvider
} from "./diagnostics";
import {
  DEFAULT_SETTINGS,
  MarginaliaSettings,
  MarginaliaSettingTab
} from "./settings";
import { AnnotationStore } from "./storage/annotation-store";
import { ensureDataReadme } from "./storage/data-readme";
import { INDEX_DIRECTORY, rebuildIndex } from "./storage/annotation-index";
import { registerExternalIngest } from "./storage/external-watcher";
import {
  MARGINALIA_VIEW_TYPE,
  MarginaliaSidebarView
} from "./ui/sidebar-view";

export default class MarginaliaPlugin extends Plugin {
  store!: AnnotationStore;
  settings: MarginaliaSettings = DEFAULT_SETTINGS;
  editorRevision = 0;
  private pdfAdapter!: PdfAdapter;
  /** Commands registered by this plugin, listed in the settings tab. */
  private readonly pluginCommands: Command[] = [];
  /** Annotation waiting for the user to pick its new passage (re-anchor). */
  private pendingReanchor: { id: string } | null = null;
  private readonly restBridge = new RestBridge(this);
  /** Ribbon entry point, kept so it can carry the unread badge. */
  private ribbonIcon: HTMLElement | null = null;
  /** Ids already known to the UI, for "new annotation" notices. */
  private knownAnnotationIds: Set<string> | null = null;

  pendingReanchorId(): string | null {
    return this.pendingReanchor?.id ?? null;
  }

  startReanchor(id: string): void {
    const annotation = this.store.get(id);
    if (!annotation) return;
    const file = this.app.vault.getAbstractFileByPath(annotation.sourcePath);
    if (!(file instanceof TFile)) {
      new Notice("The source note no longer exists; cannot re-anchor.");
      return;
    }
    this.pendingReanchor = { id };
    void this.app.workspace.getLeaf(false)?.openFile(file);
    new Notice(
      "Select the new passage in the editor, then right-click to re-anchor it here."
    );
    this.refresh();
  }

  cancelReanchor(): void {
    if (!this.pendingReanchor) return;
    this.pendingReanchor = null;
    new Notice("Re-anchoring cancelled.");
    this.refresh();
  }

  private confirmReanchor(editor: Editor, file: TFile): void {
    const pending = this.pendingReanchor;
    if (!pending) return;
    const annotation = this.store.get(pending.id);
    if (!annotation) {
      this.cancelReanchor();
      return;
    }
    if (annotation.sourcePath !== file.path) {
      new Notice("Re-anchoring is limited to the annotation's own note (v1).");
      return;
    }
    const exact = editor.getSelection();
    if (!exact.trim()) {
      new Notice("Selection is empty.");
      return;
    }
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
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
      quoteHash: this.hash(exact),
      originalQuote: exact
    };
    const id = pending.id;
    void this.store.reanchor(id, anchor).then(() => {
      this.pendingReanchor = null;
      new Notice("Annotation re-anchored.");
      this.refresh();
      void this.activateAnnotation(id);
    });
  }

  /** addCommand that remembers the command for the settings hint. */
  private addPluginCommand(command: Command): Command {
    const registered = this.addCommand(command);
    this.pluginCommands.push(registered);
    return registered;
  }

  /** Names of this plugin's commands, for the settings hint. */
  commandNames(): string[] {
    return this.pluginCommands.map((command) => command.name);
  }

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
    this.store.setUserName(this.settings.userName);
    await this.store.load();
    await ensureDataReadme(this.app.vault.adapter, this.store.dataRoot);
    registerExternalIngest(this, this.store, this.store.dataRoot + "/annotations");
    this.restBridge.connect();
    // The loaded event is the host plugin's own; it is not in the typed
    // Workspace event union, so listen via the base Events class.
    this.registerEvent(
      (this.app.workspace as unknown as Events).on(
        "obsidian-local-rest-api:loaded",
        () => this.restBridge.connect()
      )
    );
    this.pdfAdapter = new PdfAdapter(this);
    this.pdfAdapter.start();

    setSnapshotProvider(() => this.diagnosticsSnapshot());
    this.registerView(
      MARGINALIA_VIEW_TYPE,
      (leaf) => new MarginaliaSidebarView(leaf, this)
    );
    this.registerEditorExtension(createMarkdownExtension(this));
    registerHoverPreview(this);
    this.registerMarkdownPostProcessor((element, context) =>
      processReadingView(element, context, this)
    );
    this.addSettingTab(new MarginaliaSettingTab(this.app, this));
    this.ribbonIcon = this.addRibbonIcon(
      "message-square-text",
      "Open Marginalia Bona annotations",
      () => void this.openSidebar()
    );
    this.ribbonIcon.addClass("marginalia-ribbon-icon");

    this.addPluginCommand({
      id: "open-annotations",
      name: "Open annotations",
      callback: () => void this.openSidebar()
    });
    this.addPluginCommand({
      id: "mark-all-annotations-read",
      name: "Mark all annotations read",
      callback: async () => {
        const now = new Date().toISOString();
        for (const annotation of this.store.all()) {
          if (annotation.readAt === undefined) {
            await this.store.update(annotation.id, { readAt: now });
          }
        }
      }
    });
    this.addPluginCommand({
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
    this.addPluginCommand({
      id: "add-note-annotation",
      name: "Add annotation to current document",
      callback: () => this.beginDocumentAnnotation()
    });
    this.addPluginCommand({
      id: "add-pdf-annotation",
      name: "Add annotation to PDF selection",
      checkCallback: (checking) => {
        const captured = this.pdfAdapter.captureSelection();
        if (!captured) return false;
        if (!checking) this.beginPdfAnnotation(captured);
        return true;
      }
    });
    this.addPluginCommand({
      id: "copy-diagnostics",
      name: "Copy diagnostics report",
      callback: () => void this.copyDiagnostics()
    });
    this.addPluginCommand({
      id: "rebuild-annotation-index",
      name: "Rebuild annotation index",
      callback: () => void this.rebuildAnnotationIndex()
    });
    this.addPluginCommand({
      id: "confirm-reanchor",
      name: "Re-anchor annotation to selection",
      checkCallback: (checking) => {
        if (!this.pendingReanchor) return false;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file || !view.editor.somethingSelected()) return false;
        if (!checking) this.confirmReanchor(view.editor, view.file);
        return true;
      }
    });
    this.addPluginCommand({
      id: "cancel-reanchor",
      name: "Cancel re-anchoring",
      checkCallback: (checking) => {
        if (!this.pendingReanchor) return false;
        if (!checking) this.cancelReanchor();
        return true;
      }
    });
    this.addPluginCommand({
      id: "export-note-annotations",
      name: "Export this note's annotations to Markdown",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.exportActiveNoteAnnotations();
        return true;
      }
    });
    this.addPluginCommand({
      id: "export-annotations",
      name: "Export all annotations to Markdown",
      callback: () => void this.exportAllAnnotations()
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        if (!(view instanceof MarkdownView) || !view.file) return;
        const file = view.file;
        if (!editor.somethingSelected()) return;
        menu.addItem((item) =>
          item
            .setTitle("Add annotation")
            .setIcon("message-square-plus")
            .onClick(() => this.beginMarkdownAnnotation(editor, view))
        );
        if (this.pendingReanchor) {
          menu.addItem((item) =>
            item
              .setTitle("Re-anchor annotation here")
              .setIcon("anchor")
              .onClick(() => this.confirmReanchor(editor, file))
          );
        }
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
        `Marginalia Bona skipped ${diagnostics.length} invalid annotation file${
          diagnostics.length === 1 ? "" : "s"
        }.`
      );
      console.warn("Marginalia Bona annotation diagnostics", diagnostics);
    }
  }

  onunload(): void {
    this.restBridge.disconnect();
    document.body.style.removeProperty("--marginalia-margin-width");
    document.body.style.removeProperty("--marginalia-highlight-color");
    document.body.style.removeProperty("--marginalia-highlight-opacity");
    delete document.body.dataset.marginaliaForceWordBreaks;
  }

  async updateSettings(changes: Partial<MarginaliaSettings>): Promise<void> {
    this.settings = { ...this.settings, ...changes };
    if ("userName" in changes) this.store.setUserName(this.settings.userName);
    await this.saveData(this.settings);
    this.applyCssSettings();
    this.refresh();
    // Agent channel toggles remount the bridge; other settings don't touch it
    // (text settings fire onChange per keystroke - reconnecting there would
    // churn the host registration).
    if ("agentMcpEnabled" in changes || "agentRestEnabled" in changes) {
      this.restBridge.connect();
    }
  }

  async openSidebar(): Promise<MarginaliaSidebarView | null> {
    let leaf: WorkspaceLeaf | null | undefined =
      this.app.workspace.getLeavesOfType(MARGINALIA_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: MARGINALIA_VIEW_TYPE, active: true });
    }
    if (!leaf) return null;
    await this.app.workspace.revealLeaf(leaf);
    this.refresh();
    return leaf.view instanceof MarginaliaSidebarView ? leaf.view : null;
  }

  /** Ribbon badge: how many threads are waiting to be read. */
  private updateUnreadBadge(): void {
    if (!this.ribbonIcon) return;
    const unread = this.store.query({ unread: true }).length;
    this.ribbonIcon.setAttribute("data-unread", String(unread));
    this.ribbonIcon.setAttribute(
      "aria-label",
      unread > 0
        ? `Open Marginalia Bona annotations (${unread} unread)`
        : "Open Marginalia Bona annotations"
    );
  }

  /** Announce annotations that appeared from outside while the sidebar is
   *  closed, so agent activity is not missed. */
  private announceNewAnnotations(): void {
    const ids = this.store.all().map((annotation) => annotation.id);
    if (this.knownAnnotationIds === null) {
      this.knownAnnotationIds = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !this.knownAnnotationIds?.has(id));
    for (const id of ids) this.knownAnnotationIds.add(id);
    if (fresh.length === 0 || this.areMarginsSuppressed()) return;
    const count = fresh.length;
    new Notice(
      count === 1
        ? "New annotation arrived."
        : `${count} new annotations arrived.`
    );
  }

  areMarginsSuppressed(): boolean {
    if (!this.settings.suppressMarginsWithSidebar) return false;
    return this.app.workspace.getLeavesOfType(MARGINALIA_VIEW_TYPE).some((leaf) => {
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
      if (view.getMode() === "preview") {
        // Reading view has no editor to scroll: find the marked span instead.
        this.revealInReadingView(view, annotation);
        return;
      }
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

  /** Land a jump in Reading view by scrolling the marked passage into view.
   *  The preview may still be rendering right after openFile, so retry. */
  private revealInReadingView(
    view: MarkdownView,
    annotation: Annotation,
    attempt = 0
  ): void {
    const root = view.contentEl.querySelector<HTMLElement>(
      ".markdown-preview-view, .markdown-reading-view"
    );
    const selector = `[data-marginalia-id="${annotation.id}"]`;
    const target = root?.querySelector<HTMLElement>(selector);
    if (!target) {
      if (attempt < 12) {
        window.setTimeout(
          () => this.revealInReadingView(view, annotation, attempt + 1),
          90
        );
      } else {
        logEvent("warn", "jump", "no marked passage in Reading view", {
          source: annotation.sourcePath,
          annotation: annotation.id
        });
        new Notice("Could not find the marked passage. Try Re-anchor.");
      }
      return;
    }
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.addClass("marginalia-jump-target");
    window.setTimeout(() => target.removeClass("marginalia-jump-target"), 1400);
    logEvent("info", "jump", "landed in Reading view", {
      source: annotation.sourcePath
    });
  }

  private diagnosticsSnapshot(): Record<string, unknown> {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    const all = this.store.all();
    const byStatus: Record<string, number> = {};
    for (const annotation of all) {
      byStatus[annotation.status] = (byStatus[annotation.status] ?? 0) + 1;
    }
    let storeIssues: unknown[] = [];
    try {
      storeIssues = this.store.getDiagnostics().slice(0, 5);
    } catch (error) {
      reportError("diagnostics", error);
    }
    return {
      activeMode: active ? active.getMode() : "(no markdown view)",
      activeFile: active?.file?.path ?? "",
      settings: {
        showHighlights: this.settings.showHighlights,
        showMargins: this.settings.showMargins,
        showResolved: this.settings.showResolved,
        marginSide: this.settings.marginSide,
        marginWidth: this.settings.marginWidth,
        defaultMarkStyle: this.settings.defaultMarkStyle
      },
      annotations: {
        total: all.length,
        notes: new Set(all.map((annotation) => annotation.sourcePath)).size,
        byStatus
      },
      marginsSuppressed: this.areMarginsSuppressed(),
      suppressMarginsWithSidebar: this.settings.suppressMarginsWithSidebar,
      sidebarLeaves: this.app.workspace
        .getLeavesOfType(MARGINALIA_VIEW_TYPE)
        .map((leaf) => ({
          connected: leaf.view.containerEl.isConnected,
          rects: leaf.view.containerEl.getClientRects().length
        })),
      readingRuns: readingRunStats(),
      reading: describeReadingMargins(this),
      storeIssues
    };
  }

  /** Entry point for the Settings tab button. */
  copyDiagnosticsFromSettings(): Promise<void> {
    return this.copyDiagnostics();
  }

  /** Write the report into the plugin's data folder so it can be read
   *  without a clipboard round-trip. Best effort: never throws. */
  async writeDiagnosticsToVault(): Promise<string> {
    const report = diagnosticsReport(this.manifest.version);
    const folder = normalizePath(`${ANNOTATIONS_DIRECTORY}/../diagnostics`);
    const path = `${folder}/latest.txt`;
    try {
      if (!(await this.app.vault.adapter.exists(folder))) {
        await this.app.vault.adapter.mkdir(folder);
      }
      await this.app.vault.adapter.write(path, report);
    } catch (error) {
      reportError("diagnostics", error);
    }
    return path;
  }

  private async copyDiagnostics(): Promise<void> {
    const report = diagnosticsReport(this.manifest.version);
    try {
      await navigator.clipboard.writeText(report);
      new Notice("Diagnostics copied to clipboard");
    } catch (error) {
      reportError("diagnostics", error);
      new Notice("Could not copy diagnostics; see the developer console");
    }
    const path = await this.writeDiagnosticsToVault();
    logEvent("info", "diagnostics", "report written", { path });
  }

  refresh(): void {
    this.editorRevision += 1;
    this.updateUnreadBadge();
    this.announceNewAnnotations();
    for (const leaf of this.app.workspace.getLeavesOfType(MARGINALIA_VIEW_TYPE)) {
      if (leaf.view instanceof MarginaliaSidebarView) leaf.view.refresh();
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
      quoteHash: this.hash(exact),
      originalQuote: exact
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
        .setTitle("Add annotation")
        .setIcon("message-square-plus")
        .onClick(() => this.beginPdfAnnotation(captured))
    );
    menu.showAtMouseEvent(event);
  }

  private async rebuildAnnotationIndex(): Promise<void> {
    const shards = await rebuildIndex(this.app.vault.adapter, this.store.all());
    new Notice(`Marginalia Bona index rebuilt: ${shards} shard files in ${INDEX_DIRECTORY}.`);
  }

  /** Per-note digest written next to the note; re-export replaces it. */
  private async exportActiveNoteAnnotations(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const format = getExportFormat("markdown");
    if (!format) return;
    const annotations = this.store.forSource(file.path);
    if (annotations.length === 0) {
      new Notice("This note has no annotations to export.");
      return;
    }
    const base = file.name.replace(/\.md$/i, "");
    const folder = file.parent?.path ?? "";
    const path = normalizePath(
      folder && folder !== "/" ? `${folder}/${base} – Comments.md` : `${base} – Comments.md`
    );
    const content = format.render(annotations, {
      sourcePath: file.path,
      exportedAt: new Date().toISOString()
    });
    await this.writeExportFile(path, content);
    new Notice(`Annotations exported to ${path}`);
  }

  /** Vault-wide digest grouped by source note, in the data directory. */
  private async exportAllAnnotations(): Promise<void> {
    const format = getExportFormat("markdown");
    if (!format) return;
    const bySource = new Map<string, Annotation[]>();
    for (const annotation of this.store.all()) {
      const list = bySource.get(annotation.sourcePath) ?? [];
      list.push(annotation);
      bySource.set(annotation.sourcePath, list);
    }
    if (bySource.size === 0) {
      new Notice("There are no annotations to export.");
      return;
    }
    const exportedAt = new Date().toISOString();
    const sections = [...bySource.entries()].map(([sourcePath, list]) =>
      format.render(list, { sourcePath, exportedAt })
    );
    const content = `# Marginalia Bona — annotation export\n\n${sections.join("\n\n---\n\n")}`;
    const path = normalizePath(
      `.marginalia-bona/exports/annotations-${exportedAt.replaceAll(/[:.]/g, "-")}.md`
    );
    await this.writeExportFile(path, content);
    new Notice(`Annotations exported to ${path}`);
  }

  private async writeExportFile(path: string, content: string): Promise<void> {
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.process(existing, () => content);
    } else {
      await this.app.vault.create(path, content);
    }
    await this.openExport(path);
  }

  /** Open an exported digest in its own tab; reuse a tab already showing it. */
  /** Obsidian's configured attachment folder convention (undocumented
   *  vault config; "/" = root, "folder" = fixed folder, "./f" = beside
   *  the note). Defaults to root when absent or not a string. */
  private attachmentConvention(): string {
    const raw = (
      this.app.vault as unknown as {
        getConfig?: (key: string) => unknown;
      }
    ).getConfig?.("attachmentFolderPath");
    return typeof raw === "string" ? raw : "/";
  }

  /** Save a pasted image into the attachments folder; returns the vault
   *  path for embedding as ![[path]]. The folder follows Obsidian's own
   *  attachment convention unless overridden in plugin settings. */
  async saveImageAttachment(image: File, sourcePath: string): Promise<string> {
    const convention = this.attachmentConvention();
    const sourceDir = sourcePath.split("/").slice(0, -1).join("/");
    const folder = attachmentsFolderFor(
      this.settings.attachmentsFolder,
      convention,
      sourceDir
    );
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => undefined);
    }
    const ext = image.name.includes(".")
      ? image.name.split(".").pop() ?? "png"
      : "png";
    const path = attachmentPath(folder, ext, new Date(), (candidate) =>
      Boolean(this.app.vault.getAbstractFileByPath(candidate))
    );
    await this.app.vault.createBinary(path, await image.arrayBuffer());
    return path;
  }

  private async openExport(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const alreadyOpen = this.app.workspace
      .getLeavesOfType("markdown")
      .find(
        (leaf) =>
          leaf.view instanceof MarkdownView && leaf.view.file?.path === path
      );
    const leaf = alreadyOpen ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: "markdown",
      state: { file: path }
    });
  }

  private async beginSidebarDraft(
    input: Parameters<MarginaliaSidebarView["beginCreate"]>[0]
  ): Promise<void> {
    const sidebar = await this.openSidebar();
    if (!sidebar) {
      new Notice("Marginalia Bona could not open its annotation sidebar.");
      return;
    }
    sidebar.beginCreate(input);
  }

  private async reconcileFile(file: TFile): Promise<void> {
    if (file.path.startsWith(".marginalia-bona/")) return;
    await this.store.reconcileMarkdownSource(
      file.path,
      await this.app.vault.cachedRead(file)
    );
  }

  private applyCssSettings(): void {
    document.body.style.setProperty(
      "--marginalia-margin-width",
      `${this.settings.marginWidth}px`
    );
    document.body.style.setProperty(
      "--marginalia-highlight-color",
      this.settings.highlightColor
    );
    document.body.style.setProperty(
      "--marginalia-highlight-opacity",
      String(this.settings.highlightOpacity)
    );
    document.body.dataset.marginaliaMarginSide = this.settings.marginSide;
    document.body.dataset.marginaliaForceWordBreaks = String(
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
