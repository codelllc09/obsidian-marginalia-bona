import { App, PluginSettingTab, Setting } from "obsidian";
import type SidenPlugin from "./main";

export type MarginSide = "auto" | "left" | "right";
export type HighlightStyle = "background" | "underline" | "both";

export interface SidenSettings {
  showHighlights: boolean;
  showMargins: boolean;
  showResolved: boolean;
  marginSide: MarginSide;
  marginWidth: number;
  narrowPaneThreshold: number;
  highlightColor: string;
  highlightOpacity: number;
  highlightStyle: HighlightStyle;
  forceLongWordBreaks: boolean;
}

export const DEFAULT_SETTINGS: SidenSettings = {
  showHighlights: true,
  showMargins: true,
  showResolved: false,
  marginSide: "auto",
  marginWidth: 200,
  narrowPaneThreshold: 900,
  highlightColor: "#ffd54f",
  highlightOpacity: 0.35,
  highlightStyle: "both",
  forceLongWordBreaks: true
};

export class SidenSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SidenPlugin) {
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
      .setDesc("Display annotation cards beside Markdown in Live Preview and Reading View.")
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
          .setDynamicTooltip()
          .onChange((value) => this.plugin.updateSettings({ marginWidth: value }))
      );

    new Setting(containerEl)
      .setName("Narrow pane threshold")
      .setDesc("Margins automatically disappear below this editor width.")
      .addSlider((slider) =>
        slider
          .setLimits(600, 1400, 50)
          .setValue(this.plugin.settings.narrowPaneThreshold)
          .setDynamicTooltip()
          .onChange((value) =>
            this.plugin.updateSettings({ narrowPaneThreshold: value })
          )
      );

    new Setting(containerEl)
      .setName("Highlight color")
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
          .setDynamicTooltip()
          .onChange((value) =>
            this.plugin.updateSettings({ highlightOpacity: value })
          )
      );

    new Setting(containerEl)
      .setName("Highlight style")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            background: "Background",
            underline: "Underline",
            both: "Background and underline"
          })
          .setValue(this.plugin.settings.highlightStyle)
          .onChange((value) =>
            this.plugin.updateSettings({ highlightStyle: value as HighlightStyle })
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
  }
}
