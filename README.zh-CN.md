# Marginalia Bona

[English](README.md) | 简体中文

Marginalia Bona 是 [Siden](https://github.com/giuseqpe/siden) 的 fork，在其基础上增加了独立批注样式、回复线程，以及面向 AI Agent 的索引等功能。

Marginalia Bona 为 Obsidian 的 Markdown 笔记提供批注能力。

选中一段文字，在侧栏写下 Markdown 评论，随时回来查看。Markdown 批注还能以边注卡片的形式显示在正文旁边。批注本身是库内的纯 Markdown 文件，包括 AI Agent 可以直接读写。

![阅读视图中的边注卡片与三层回复线程](media/reading-view.jpg)

[看演示（24 秒，MP4）](media/demo.mp4)：滚动时边注卡片跟着正文走，悬停高亮弹出批注，选中一段文字直接标注（自选样式与颜色），侧栏里排序、回复，再跳回原文。

## 功能

- 选中文字即可添加批注，批注的段落会在原文中高亮显示
- 所有批注在一个侧栏里查看、搜索、编辑、删除；处理完的可以标记"已解决"，之后也能改回未解决
- 边注卡片：批注显示在正文旁边的空白处，实时预览和阅读视图都支持
- 点侧栏里的评论跳到原文位置，点原文里的高亮跳回对应评论
- 每条批注可单独设置颜色和标记样式（高亮、下划线、波浪线、删除线、加粗）
- 在一条批注下面直接回复，形成讨论线程
- 已读/未读状态：未读过滤、"全部标为已读"命令，功能区图标显示未读数量
- 别人（包括 AI Agent）回复或改动批注时，该批注重新变为未读
- 按文档位置、创建时间、更新时间排序；搜索范围是整个库
- 删除的批注进回收站（`.marginalia-bona/trash/`），30 天内可以恢复
- 侧栏支持粘贴图片，存放位置跟随 Obsidian 的附件设置
- 一键把单篇笔记或全库的批注导出成一篇可读的 Markdown
- 笔记改动后批注自动跟随：段落被改写时会尝试找回原位置，找不回就明确标记为"孤立"，不会标错地方
- 源笔记文件不会被修改
- Agent 桥接：通过 Local REST API 插件提供 MCP 工具与 REST 端点，AI Agent 可以安全地创建和编辑批注

![五种标记样式，各自颜色与边注卡片](media/mark-styles.jpg)

![侧栏：筛选、回复线程，以及功能区上的未读角标](media/sidebar.jpg)

## 安装

本插件不在社区插件目录中，可手动安装，或通过 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 安装。

手动安装：从 GitHub Release 下载 `main.js`、`manifest.json` 和 `styles.css`，放入：

```text
<vault>/.obsidian/plugins/marginalia-bona/
```

重载 Obsidian，然后在 **设置 → 第三方插件** 中启用 **Marginalia Bona**。

数据目录 `.marginalia-bona/` 与上游 Siden 的 `.siden/` 完全隔离，两个插件可以在同一个库中共存。

## 使用

### 批注 Markdown

1. 在实时预览中选中文字。
2. 右键选择 **Add annotation**，或运行 **Marginalia Bona: Add annotation to selection**。
3. 在侧栏撰写评论。`Enter` 保存，`Shift+Enter` 换行。
4. 回复某条批注：在侧栏展开它，在线程下方输入即可。

当某条线程需要重新锚定时，从侧栏发起重锚流程，然后选中段落的新位置，右键选择 **Re-anchor annotation here**。

### 添加文档级评论

不选中文字，直接运行 **Marginalia Bona: Add annotation to current document**。评论附着于整篇笔记，而不是某个段落。

### 打开侧栏

运行 **Marginalia Bona: Open annotations**，或点击功能区里的消息图标。

侧栏可以显示当前文件的批注，也可以显示全库。搜索范围覆盖评论正文、回复、引文与笔记路径；可按状态、作者、已读状态过滤；按位置、创建时间或更新时间排序。别人回复、或在外部新增的批注会重新变为未读，出现在未读过滤和功能区图标的数量里；侧栏关闭时，新批注还会弹出提示。

### 已删除的批注

删除批注会先进入回收站，而不是直接抹掉。回收站暂时没有侧栏视图，通过 MCP/REST 端点列出并恢复被删除的线程；条目在 30 天后自动清理。

### 导出

运行 **Marginalia Bona: Export this note's annotations to Markdown** 导出当前笔记，或 **Export all annotations to Markdown** 导出全库。导出文件写入 `.marginalia-bona/exports/`。

## Agent 访问

Marginalia Bona 可以通过 [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 插件让 AI Agent 读写批注。安装该插件并保持它运行在 `127.0.0.1`，即可使用以下任一通道。

**MCP 工具**（默认开启）：在 Local REST API 服务器的 `/mcp` 端点上注册了十一个工具。

| 工具 | 作用 |
|---|---|
| `marginalia_list_annotations` | 列出线程。`source` 限定单篇笔记；省略则检索全库。可按 `status`、`author`、`read`、`q` 过滤，`sort` 加 `dir` 排序，`limit` 限制输出。 |
| `marginalia_create_annotation` | 在 `source` 中锚定 `quote` 并保存 `text`。引文多次出现时会被拒绝并附带匹配数，需用 `occurrence`（从 1 起）指明第几处。可选 `author`、`color`（hex）、`style`。 |
| `marginalia_get_annotation` | 按 `source` 与 `id` 取一条线程，含锚点、回复与已读状态。 |
| `marginalia_update_annotation` | 编辑 `text`（传 `expected_text` 可在线程被读过又变化时以 409 拒绝写入），或设置 `status`、`read`、`color`、`style`。 |
| `marginalia_delete_annotation` | 把线程移入回收站，响应中给出回收站文件路径。 |
| `marginalia_add_reply` | 追加回复。传 `parent_id` 可回复某一条回复（嵌套）；未知父级会被拒绝。 |
| `marginalia_update_reply` | 编辑某条回复的文字（可一并改作者）。 |
| `marginalia_delete_reply` | 删除某条回复。 |
| `marginalia_reanchor` | 把线程锚到新段落：与创建相同的引文规则，可选 `expected_quote` 乐观锁。正文与回复原样保留。 |
| `marginalia_list_trash` | 列出回收站条目的 id、来源与正文摘要。 |
| `marginalia_restore_annotation` | 把回收站条目移回批注目录，并按笔记现状调和锚点。 |

**REST 端点**（默认关闭）：同样的操作以纯 HTTP 形式暴露在 `/vault/<笔记路径>/annotations/` 之下，Local REST API 服务器原有的 `/openapi.yaml` 里有完整描述。例如：

```sh
curl -k -X POST -H "Authorization: Bearer <api key>" -H "Content-Type: application/json" \
  --data '{"text": "Consider a table here", "quote": "the three options", "author": "Pi"}' \
  "https://127.0.0.1:27124/vault/Projects/Plan.md/annotations/"
```

直接读磁盘上的批注文件永远安全，往往也最快；桥接的意义在于让写入经过插件完成——由插件构建锚点、维护索引一致性。

写入时作者不是设置中的用户名，批注会重新标为未读，用户下次打开侧栏就能看到。回复某条回复时传 `parent_id`，回复会嵌套在它下面。

## 设置

- 高亮的可见性、颜色、不透明度与样式
- 页边卡片开关（另有同名命令，可绑热键）、侧边与最大宽度
- 为页边卡片预留空间：无论主题怎么设置行宽都能显示，面板窄到保不住可读正文时不预留
- 已解决批注的可见性
- 超长单词、链接与代码的强制换行
- 粘贴图片的附件目录（默认跟随 Obsidian 约定）
- Agent 访问：MCP 工具开关、REST 端点开关

## 存储

批注以独立 Markdown 文件存储在：

```text
.marginalia-bona/annotations/<源笔记路径>/<引文摘要>-<短id>.md
```

一个文件就是一条线程。下面是一份真实文件的节选：

````markdown
---
siden-schema: 1
id: "606404a7-9c1e-4b2f-8a57-1d0f6f20b9ce"
source: "Projects/Plan.md"
source-type: "markdown"
status: "open"
author: "Pi"
created: "2026-10-24T09:12:40.245Z"
updated: "2026-10-24T09:14:02.881Z"
---

# Annotation

Consider a table here — three rows for the quarterly numbers.

## Replies

### b71c02de | 2026-10-24T09:14:02.881Z | user

Agreed, but keep the totals in the text.

<!-- siden:anchor -->

## Anchor metadata

```json
{
  "kind": "markdown",
  "startOffset": 284,
  "endOffset": 301,
  "startLine": 11,
  "startCharacter": 23,
  "endLine": 11,
  "endCharacter": 40,
  "quote": {
    "exact": "the three options",
    "prefix": "Consider a table here: ",
    "suffix": "."
  },
  "originalQuote": "the three options"
}
```

<!-- /siden:anchor -->
````

frontmatter 携带身份、状态、样式与已读状态；正文是根评论；回复在 `Replies` 标题之下；文件末尾的 JSON 代码块记录锚点。文件名在线程创建时生成，此后保持不变——即使锚定的文本发生变化。

`.marginalia-bona/index/` 目录按文档存放 JSONL 分片——这是可重建的缓存，让 Agent 和侧栏无需读遍所有文件就能定位线程。运行 **Marginalia Bona: Rebuild annotation index** 可随时重建。

删除批注会移入 `.marginalia-bona/trash/` 并保留 30 天。源笔记永远不会被修改。

## 隐私与权限

- 无遥测、无广告、无账号，插件自身不发起网络请求。
- 批注数据只保存在库内的 `.marginalia-bona/`。
- Agent 桥接只与本机的 Local REST API 插件通信，不额外监听任何端口。

## 已知限制

- 回收站暂时没有侧栏视图，Agent 通过 MCP 或 REST 访问。
- 引文在文中多次出现时绝不猜测：调用方必须指明第几处。

## 开发

```sh
npm install
npm run dev     # 改动时自动重新构建 main.js
npm test        # vitest
npm run lint    # eslint
npm run build   # 类型检查并生成 main.js
```

想看效果：把 `main.js`、`manifest.json`、`styles.css` 拷进 `<vault>/.obsidian/plugins/marginalia-bona/`，重载 Obsidian 即可。

## 致谢与许可

- [Siden](https://github.com/giuseqpe/siden)，作者 Giuseppe，MIT 协议。Marginalia Bona 保留上游署名。
- Marginalia Bona 以 MIT 协议发布。
