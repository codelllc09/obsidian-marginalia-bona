export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replaceAll(/\/+/g, "/");
}

export class TFile {
  path = "";
  extension = "";
  stat = { mtime: 0 };
}

/** Minimal MarkdownRenderer: enough for code that renders card bodies. */
export class MarkdownRenderer {
  static async render(
    _app: unknown,
    markdown: string,
    target: HTMLElement
  ): Promise<void> {
    target.textContent = markdown;
  }
  static async renderMarkdown(
    markdown: string,
    target: HTMLElement
  ): Promise<void> {
    target.textContent = markdown;
  }
}

/** Minimal Component: cards register themselves for cleanup. */
export class Component {
  load(): void {}
  unload(): void {}
  register(_callback: () => void): void {}
  addChild<T>(child: T): T {
    return child;
  }
}
