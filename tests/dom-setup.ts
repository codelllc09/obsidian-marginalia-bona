import { Window } from "happy-dom";

/** Installs a happy-dom document plus the Obsidian DOM helpers the plugin
 *  code relies on (addClass/createDiv/...), so DOM-level code can run in
 *  Node tests without the app. */
export function installDom(): { window: Window; document: Document } {
  const window = new Window();
  const document = window.document as unknown as Document;
  const proto = (window as unknown as { Element: { prototype: Element } }).Element
    .prototype as unknown as Record<string, unknown>;

  const toNodes = (children: Array<Node | string>): Node[] =>
    children.map((child) =>
      typeof child === "string" ? document.createTextNode(child) : child
    );

  const applyOptions = (
    element: HTMLElement,
    options?: {
      cls?: string;
      text?: string;
      attr?: Record<string, string>;
      type?: string;
      placeholder?: string;
    }
  ): HTMLElement => {
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    if (options?.type) element.setAttribute("type", options.type);
    if (options?.placeholder) element.setAttribute("placeholder", options.placeholder);
    for (const [key, value] of Object.entries(options?.attr ?? {})) {
      element.setAttribute(key, value);
    }
    return element;
  };

  Object.assign(proto, {
    addClass(this: HTMLElement, ...classes: string[]) {
      this.classList.add(...classes.filter(Boolean));
      return this;
    },
    removeClass(this: HTMLElement, ...classes: string[]) {
      this.classList.remove(...classes.filter(Boolean));
      return this;
    },
    toggleClass(this: HTMLElement, cls: string, value?: boolean) {
      this.classList.toggle(cls, value);
      return this;
    },
    empty(this: HTMLElement) {
      this.replaceChildren();
      return this;
    },
    setText(this: HTMLElement, text: string) {
      this.textContent = text;
      return this;
    },
    createDiv(this: HTMLElement, options?: Parameters<typeof applyOptions>[1], children?: Array<Node | string>) {
      const el = applyOptions(document.createElement("div"), options);
      el.append(...toNodes(children ?? []));
      this.appendChild(el);
      return el;
    },
    createSpan(this: HTMLElement, options?: Parameters<typeof applyOptions>[1], children?: Array<Node | string>) {
      const el = applyOptions(document.createElement("span"), options);
      el.append(...toNodes(children ?? []));
      this.appendChild(el);
      return el;
    },
    createEl(this: HTMLElement, tag: string, options?: Parameters<typeof applyOptions>[1], children?: Array<Node | string>) {
      const el = applyOptions(document.createElement(tag), options);
      el.append(...toNodes(children ?? []));
      this.appendChild(el);
      return el;
    }
  });

  const g = globalThis as unknown as Record<string, unknown>;
  g.window = window;
  g.document = document;
  g.NodeFilter = (window as unknown as Record<string, unknown>).NodeFilter;
  g.Node = (window as unknown as Record<string, unknown>).Node;
  g.ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
  };
  // Run animation frames synchronously so a render pass completes inside the
  // test that triggered it.
  const raf = (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  };
  const cancel = () => undefined;
  g.requestAnimationFrame = raf;
  g.cancelAnimationFrame = cancel;
  Object.assign(window as unknown as Record<string, unknown>, {
    requestAnimationFrame: raf,
    cancelAnimationFrame: cancel
  });
  g.createDiv = (options?: Parameters<typeof applyOptions>[1]) =>
    applyOptions(document.createElement("div"), options);
  g.createSpan = (options?: Parameters<typeof applyOptions>[1]) =>
    applyOptions(document.createElement("span"), options);
  return { window, document };
}
