import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The "Force breaks in long words" setting promises to break words, links and
 * code that are wider than a card - not ordinary words that merely end a line.
 * `word-break: break-all` breaks the latter too (`pape|r,`), so the contract is
 * checked on the stylesheet: long tokens break via `overflow-wrap: anywhere`,
 * and nothing forces a break inside a word that would fit on the next line.
 */
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

const rules = css
  .split("}")
  .map((chunk) => chunk.split("{"))
  .filter((parts) => parts.length === 2)
  .map(([selector, body]) => ({ selector: selector.trim(), body }));

const forceWordBreakRules = rules.filter((rule) =>
  rule.selector.includes("marginalia-force-word-breaks")
);

describe("force long word breaks", () => {
  it("covers the sidebar cards and the margin cards", () => {
    const selectors = forceWordBreakRules.map((rule) => rule.selector).join("\n");
    expect(selectors).toContain(".marginalia-sidebar");
    expect(selectors).toContain(".marginalia-margin-card");
  });

  it("breaks tokens wider than the card", () => {
    for (const rule of forceWordBreakRules) {
      expect(rule.body).toMatch(/overflow-wrap:\s*anywhere/);
    }
  });

  it("keeps ordinary words wrapping at the space before them", () => {
    for (const rule of forceWordBreakRules) {
      expect(rule.body).not.toMatch(/word-break:\s*break-all/);
    }
  });
});
