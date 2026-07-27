import { App, Modal, Setting } from "obsidian";

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    title: string,
    private readonly message: string,
    private readonly confirmLabel: string,
    private readonly onConfirm: () => Promise<void> | void
  ) {
    super(app);
    this.setTitle(title);
  }

  onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close())
      )
      .addButton((button) =>
        button
          .setButtonText(this.confirmLabel)
          .then((component) => component.buttonEl.addClass("mod-warning"))
          .onClick(async () => {
            await this.onConfirm();
            this.close();
          })
      );
  }
}
