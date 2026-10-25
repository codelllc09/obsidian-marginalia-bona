import { App, PluginSettingTab, Setting } from "obsidian";
import type MarginaliaPlugin from "./main";
import { MARK_STYLES, MarkStyle } from "./domain/annotation";
import type { HoverPreviewMode } from "./hover/hover-preview";

export type MarginSide = "auto" | "left" | "right";

export interface MarginaliaSettings {
  showHighlights: boolean;
  showMargins: boolean;
  showResolved: boolean;
  marginSide: MarginSide;
  marginWidth: number;
  suppressMarginsWithSidebar: boolean;
  reserveMarginSpace: boolean;
  /** Default color for annotations created without an explicit color. */
  highlightColor: string;
  highlightOpacity: number;
  /** Default mark style for annotations created without an explicit style. */
  defaultMarkStyle: MarkStyle;
  /** Shortcut that saves a draft / sends a reply from a sidebar textarea. */
  submitShortcut: "enter" | "mod-enter";
  /** When hovering a marked passage shows an annotation preview. */
  hoverPreview: HoverPreviewMode;
  /** Author name recorded on annotations and replies created in this vault. */
  userName: string;
  /** Overrides Obsidian's attachment folder convention when non-empty.
   *  Empty (default) follows Settings → Files & links. Must resolve to a
   *  non-hidden folder: dot folders are not indexed, embeds would break. */
  attachmentsFolder: string;
  /** Expose annotation operations as MCP tools on the Local REST API host.
   *  The guarded, default agent channel. */
  agentMcpEnabled: boolean;
  /** Expose the raw annotations REST endpoints for curl/scripts and agents
   *  without MCP. Off by default: the schema-guarded MCP tools are preferred. */
  agentRestEnabled: boolean;
  forceLongWordBreaks: boolean;
}

export const DEFAULT_SETTINGS: MarginaliaSettings = {
  showHighlights: true,
  showMargins: true,
  showResolved: false,
  marginSide: "auto",
  marginWidth: 200,
  suppressMarginsWithSidebar: true,
  reserveMarginSpace: false,
  highlightColor: "#ffd54f",
  highlightOpacity: 0.35,
  defaultMarkStyle: "highlight",
  submitShortcut: "enter",
  hoverPreview: "hover",
  userName: "user",
  attachmentsFolder: "",
  agentMcpEnabled: true,
  agentRestEnabled: false,
  forceLongWordBreaks: true
};

export class MarginaliaSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MarginaliaPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Show highlights")
      .setDesc("Highlight annotated passages in Markdown and PDF documents.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showHighlights)
          .onChange((value) => this.plugin.updateSettings({ showHighlights: value }))
      );

    new Setting(containerEl)
      .setName("Show Markdown margins")
      .setDesc("Display annotation cards beside Markdown in live preview and reading view.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showMargins)
          .onChange((value) => this.plugin.updateSettings({ showMargins: value }))
      );

    new Setting(containerEl)
      .setName("Show resolved annotations")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showResolved)
          .onChange((value) => this.plugin.updateSettings({ showResolved: value }))
      );

    new Setting(containerEl)
      .setName("Margin side")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ auto: "Automatic", left: "Left", right: "Right" })
          .setValue(this.plugin.settings.marginSide)
          .onChange((value) =>
            this.plugin.updateSettings({ marginSide: value as MarginSide })
          )
      );

    new Setting(containerEl)
      .setName("Margin width")
      .setDesc(`${this.plugin.settings.marginWidth}px`)
      .addSlider((slider) =>
        slider
          .setLimits(160, 420, 10)
          .setValue(this.plugin.settings.marginWidth)
          .onChange((value) => this.plugin.updateSettings({ marginWidth: value }))
      );

    new Setting(containerEl)
      .setName("Reserve space for margin cards")
      .setDesc(
        "Narrows the text column so cards always have room. Needed when the theme (or a narrow pane) leaves no empty space beside the text - without it, cards only appear when the pane is wider than the line width."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.reserveMarginSpace)
          .onChange((value) =>
            this.plugin.updateSettings({ reserveMarginSpace: value })
          )
      );

    new Setting(containerEl)
      .setName("Hide margin cards while the sidebar is open")
      .setDesc(
        "On by default: the sidebar already lists every annotation, so inline cards would duplicate it. Turn off to always show margin cards, as long as the pane leaves room for them."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.suppressMarginsWithSidebar)
          .onChange((value) =>
            this.plugin.updateSettings({ suppressMarginsWithSidebar: value })
          )
      );

    new Setting(containerEl)
      .setName("Default color")
      .setDesc("Used by annotations that do not pick their own color.")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.highlightColor)
          .onChange((value) => this.plugin.updateSettings({ highlightColor: value }))
      );

    new Setting(containerEl)
      .setName("Highlight opacity")
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 1, 0.05)
          .setValue(this.plugin.settings.highlightOpacity)
          .onChange((value) =>
            this.plugin.updateSettings({ highlightOpacity: value })
          )
      );

    new Setting(containerEl)
      .setName("Default mark style")
      .setDesc("Applied to annotations created without an explicit style.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(
            Object.fromEntries(
              MARK_STYLES.map((style) => [
                style,
                style[0].toUpperCase() + style.slice(1)
              ])
            )
          )
          .setValue(this.plugin.settings.defaultMarkStyle)
          .onChange((value) =>
            this.plugin.updateSettings({ defaultMarkStyle: value as MarkStyle })
          )
      );

    new Setting(containerEl)
      .setName("Hover preview")
      .setDesc("Show an annotation preview when hovering a marked passage.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            off: "Off",
            hover: "On hover",
            ctrl: "Ctrl/Cmd + hover"
          })
          .setValue(this.plugin.settings.hoverPreview)
          .onChange((value) =>
            this.plugin.updateSettings({
              hoverPreview: value as HoverPreviewMode
            })
          )
      );

    new Setting(containerEl)
      .setName("Your name")
      .setDesc(
        "Author name recorded on annotations and replies you create. AI agents use their own names (Pi, Codex, …)."
      )
      .addText((text) =>
        text
          .setValue(this.plugin.settings.userName)
          .onChange((value) =>
            this.plugin.updateSettings({ userName: value.trim() || "user" })
          )
      );

    new Setting(containerEl)
      .setName("Attachments folder")
      .setDesc(
        "Leave empty to follow the attachment folder configured in Obsidian's file settings. Must resolve to a normal (non-hidden) folder, or embeds will not render."
      )
      .addText((text) => {
        text.setPlaceholder("Follow Obsidian convention");
        text.setValue(this.plugin.settings.attachmentsFolder);
        text.onChange((value) =>
          this.plugin.updateSettings({ attachmentsFolder: value.trim() })
        );
      });

    new Setting(containerEl)
      .setName("Submit shortcut")
      .setDesc("Key that saves an annotation or sends a reply. Hold shift for a newline when using enter.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            enter: "Enter (Shift+Enter = newline)",
            "mod-enter": "Ctrl/Cmd+Enter"
          })
          .setValue(this.plugin.settings.submitShortcut)
          .onChange((value) =>
            this.plugin.updateSettings({
              submitShortcut: value as MarginaliaSettings["submitShortcut"]
            })
          )
      );

    new Setting(containerEl)
      .setName("Force breaks in long words")
      .setDesc(
        "Break words, links, and code that are wider than a margin card instead of showing horizontal overflow."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.forceLongWordBreaks)
          .onChange((value) =>
            this.plugin.updateSettings({ forceLongWordBreaks: value })
          )
      );

    new Setting(containerEl).setName("Agent access").setHeading();

    new Setting(containerEl)
      .setName("MCP tools for agents")
      .setDesc(
        "Expose annotation operations (list/create/get/reply/update/delete) as MCP tools - the guarded default agent channel. Requires the “Local REST API” community plugin to be installed and enabled: it hosts the MCP server."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.agentMcpEnabled)
          .onChange((value) =>
            this.plugin.updateSettings({ agentMcpEnabled: value })
          )
      );

    new Setting(containerEl)
      .setName("REST endpoints for agents")
      .setDesc(
        "Expose the raw annotations REST API for curl, scripts, and agents without MCP. Off by default - MCP tools are the recommended path. No effect unless “Local REST API” is enabled."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.agentRestEnabled)
          .onChange((value) =>
            this.plugin.updateSettings({ agentRestEnabled: value })
          )
      );

    new Setting(containerEl).setName("Troubleshooting").setHeading();
    new Setting(containerEl)
      .setName("Diagnostics report")
      .setDesc(
        "Copies what the plugin currently sees: settings, annotation counts, Reading-view margin state, and recent render decisions. Nothing is sent anywhere - paste it where you need it."
      )
      .addButton((button) =>
        button.setButtonText("Copy report").onClick(() => {
          void this.plugin.copyDiagnosticsFromSettings();
        })
      );

    new Setting(containerEl).setName("Commands").setHeading();
    containerEl
      .createEl("p", {
        text: "Everything below is available from the command palette (Ctrl/Cmd+P). You can bind hotkeys in Settings → Hotkeys by searching “Marginalia”.",
        cls: "setting-item-description"
      })
      .addClass("marginalia-command-hint");
    const list = containerEl.createEl("ul", { cls: "marginalia-command-list" });
    for (const name of this.plugin.commandNames()) {
      list.createEl("li", { text: name });
    }
  }
}
