import { App, PluginSettingTab, Setting } from "obsidian";
import type MarginaliaPlugin from "./main";
import { MARK_STYLES, MarkStyle } from "./domain/annotation";

export type MarginSide = "auto" | "left" | "right";

export interface MarginaliaSettings {
  showHighlights: boolean;
  showMargins: boolean;
  showResolved: boolean;
  marginSide: MarginSide;
  marginWidth: number;
  narrowPaneThreshold: number;
  /** Default color for annotations created without an explicit color. */
  highlightColor: string;
  highlightOpacity: number;
  /** Default mark style for annotations created without an explicit style. */
  defaultMarkStyle: MarkStyle;
  /** Shortcut that saves a draft / sends a reply from a sidebar textarea. */
  submitShortcut: "enter" | "mod-enter";
  /** Author name recorded on annotations and replies created in this vault. */
  userName: string;
  forceLongWordBreaks: boolean;
}

export const DEFAULT_SETTINGS: MarginaliaSettings = {
  showHighlights: true,
  showMargins: true,
  showResolved: false,
  marginSide: "auto",
  marginWidth: 200,
  narrowPaneThreshold: 900,
  highlightColor: "#ffd54f",
  highlightOpacity: 0.35,
  defaultMarkStyle: "highlight",
  submitShortcut: "enter",
  userName: "user",
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
      .setName("Narrow pane threshold")
      .setDesc("Margins automatically disappear below this editor width.")
      .addSlider((slider) =>
        slider
          .setLimits(600, 1400, 50)
          .setValue(this.plugin.settings.narrowPaneThreshold)
          .onChange((value) =>
            this.plugin.updateSettings({ narrowPaneThreshold: value })
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
