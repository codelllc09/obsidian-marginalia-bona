/**
 * Self-describing README for the data directory. Generated once so that
 * any agent exploring `.marginalia-bona/` learns the format and the
 * rules before touching anything. Regenerated only when missing.
 */

export const DATA_README_FILENAME = "README.md";

export const DATA_README = `# Marginalia Bona 数据目录 / annotation data

本目录由 Obsidian 插件 Marginalia Bona 管理，存放笔记的批注数据。
本文件说明目录结构与读写规则，**任何 agent 在读写前请先读完**。
This folder is managed by the Marginalia Bona Obsidian plugin. Read this
file before writing anything.

## 目录结构 / layout

- \`annotations/\`  批注线程，**一条讨论线程一个 .md 文件**，按被批注笔记的
  路径镜像分组（\`annotations/<笔记路径>/<引文摘要>-<短id>.md\`）。
  One Markdown file per discussion thread, mirrored after the source note.
- \`index/\`        JSONL 定位索引（每行一条批注的名片：id/位置/状态/drifted）。
  **可随时删除，插件会自动重建——不要手工编辑它。** Rebuildable cache.
- \`exports/\`      「Export all annotations」命令的输出。
- \`README.md\`     本文件。缺失时插件会自动重建。

## 线程文件格式 / thread file format

\`\`\`markdown
---
siden-schema: 1
id: "<uuid>"
source: "<被批注笔记的 vault 路径>"
source-type: "markdown" | "pdf"
status: "open" | "resolved" | "orphaned"
color: "#rrggbb"            # 可选
mark-style: "highlight" | "underline" | "wavy" | "strikethrough" | "bold"  # 可选
author: "Pi"                # 可选，作者（人名或 agent 名）
created: "<ISO 时间>"
updated: "<ISO 时间>"
---

# Annotation

批注正文（Markdown）。

## Replies

### <回复短id> | <ISO 时间> | <作者>

回复正文（Markdown）。
<!-- 更多回复依次追加 -->

<!-- siden:anchor -->

## Anchor metadata

\`\`\`json
{ ... 锚点 JSON（位置/引文/前缀后缀/指纹），见 siden:anchor 注释对 ... }
\`\`\`

<!-- /siden:anchor -->
\`\`\`

## 读写规则 / rules

1. **磁盘是唯一可信源**：插件会自动拾取外部写入（约 4 秒内），侧栏随之刷新。
   The plugin picks up external writes within seconds.
2. **保持结构完整**：frontmatter 的键、\`<!-- siden:anchor -->\` 注释对、
   \`## Replies\` 段落格式不可破坏；新增回复按上面的小节格式追加。
3. **无法解析的文件会被跳过**：插件绝不改写解析失败的文件（铁律），
   只在诊断中告警。所以：不确定时宁可不要写。
4. \`index/\` 永远不要手写——它是可重建缓存。
5. 新建批注：在 \`annotations/<笔记路径>/\` 下新建符合格式的 .md 并写入，
   即可被拾取；\`status\` 用 \`open\`，\`author\` 写你的名字（如 Pi/Codex）。
   **quote 必须带 prefix/suffix 上下文**（前后各 ~64 字符）：空上下文在重复
   文本时会无法唯一定位，批注会被判为 orphaned。
6. 删除文件 = 删除该批注（含回复线程），插件会同步索引。
`;

/** Create the data-directory README when it does not exist yet. Never
 *  overwrites: agents may annotate it with their own notes. */
export async function ensureDataReadme(
  adapter: {
    exists(path: string): Promise<boolean>;
    write(path: string, data: string): Promise<void>;
  },
  dataRoot: string
): Promise<void> {
  const path = `${dataRoot}/${DATA_README_FILENAME}`;
  if (await adapter.exists(path)) return;
  await adapter.write(path, DATA_README);
}
