import { describe, expect, it } from "vitest";
import { locateQuote, plainQuoteText } from "../src/reading/reading-renderer";

describe("plainQuoteText", () => {
  it("strips inline code, emphasis, mark, strike and escapes", () => {
    expect(plainQuoteText("评估指标从 `P@10` 换到 `NDCG@10` 之后")).toBe(
      "评估指标从 P@10 换到 NDCG@10 之后"
    );
    expect(plainQuoteText("实际操作是**加权求和**：")).toBe("实际操作是加权求和：");
    expect(plainQuoteText("~~删除~~ ==高亮== *斜体* _下划线_")).toBe("删除 高亮 斜体 下划线");
    expect(plainQuoteText("a \\* b")).toBe("a * b");
  });

  it("unwraps links and embeds to their visible text", () => {
    expect(plainQuoteText("见 [[结论|这一节]] 与 [论文](https://x.y)")).toBe(
      "见 这一节 与 论文"
    );
    expect(plainQuoteText("![[图 1.png]]")).toBe("图 1.png");
  });
});

describe("locateQuote against rendered text", () => {
  const rendered =
    "评估指标从 P@10 换到 NDCG@10 之后，排序质量的分歧被掩盖了一部分：前者只关心前十条是否命中。";

  it("finds a quote that carries code markers in the source", () => {
    const quote = {
      exact: "评估指标从 `P@10` 换到 `NDCG@10` 之后，排序质量的分歧被掩盖了一部分"
    };
    expect(locateQuote(rendered, quote)).toBe(0);
  });

  it("finds a quote that carries emphasis markers in the source", () => {
    const text = "中文文献里常把 attention 译作注意力，但实际动作是加权求和。";
    expect(
      locateQuote(text, { exact: "实际动作是**加权求和**" })
    ).toBe(text.indexOf("实际动作是"));
  });

  it("returns -1 for genuinely missing text", () => {
    expect(locateQuote(rendered, { exact: "不存在的句子" })).toBe(-1);
  });

  it("uses prefix context to disambiguate repeated plain text", () => {
    const text = "第一处：注意。第二处：注意力。";
    expect(
      locateQuote(text, { exact: "**注意**", prefix: "第二处：" })
    ).toBe(text.indexOf("注意", 6));
  });
});
