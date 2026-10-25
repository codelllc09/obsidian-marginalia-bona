# Marginalia Bona

[English](README.md) | 简体中文

Marginalia Bona 是 [Siden](https://github.com/giuseqpe/siden)（作者
Giuseppe，MIT 协议）的 fork，在其基础上增加了独立批注样式、回复线程，以及
面向 AI Agent 的索引。原插件的设计与实现全部归功于上游作者。

Marginalia Bona 为 Obsidian 的 Markdown 笔记和 PDF 提供批注能力。

选中一段文字，在侧栏写下 Markdown 评论，随时回来查看。Markdown 批注还能
以边注卡片的形式显示在正文旁边。批注本身是库内的纯 Markdown 文件，其他
工具——包括 AI Agent——可以直接读写。

## 功能

继承自 Siden：

- 批注选中的 Markdown 与 PDF 文本
- 单一侧栏完成查看、搜索、编辑、解决、重开、删除
- 高亮已批注的段落
- 在实时预览和阅读视图中显示自适应的边注卡片
- 在侧栏评论与原文位置之间跳转
- 不修改源笔记与 PDF
- 批注以人类可读的 Markdown 存储
- 编辑后能在安全识别时自动恢复 Markdown 锚点

PDF 批注仅有侧栏评论和高亮；边注卡片只用于 Markdown 笔记。

本 fork 新增：

- 每条批注独立的颜色与标记样式（高亮、下划线、波浪线、删除线、加粗）
- 一条批注内的回复线程
- 已读/未读状态，未读过滤与"全部标为已读"命令
- 按文档位置、创建时间、更新时间排序；全库文本搜索
- 回收站：删除的批注移入 `.marginalia-bona/trash/`，30 天内可恢复
- 侧栏粘贴图片，按 Obsidian 附件设置存放
- 将单篇笔记或全库批注导出为可读的 Markdown
- Agent 桥接：通过 Local REST API 插件提供 MCP 工具与 REST 端点，AI Agent
  可以安全地创建和编辑批注

## 安装

本插件不在社区插件目录中，可手动安装，或通过
[BRAT](https://github.com/TfTHacker/obsidian42-brat) 安装。

手动安装：从 GitHub Release 下载 `main.js`、`manifest.json` 和
`styles.css`，放入：

```text
<vault>/.obsidian/plugins/marginalia-bona/
```

重载 Obsidian，然后在 **设置 → 第三方插件** 中启用 **Marginalia Bona**。

数据目录 `.marginalia-bona/` 与上游 Siden 的 `.siden/` 完全隔离，两个插件
可以在同一个库中共存。

## 使用

### 批注 Markdown

1. 在实时预览中选中文字。
2. 右键选择 **Add annotation**，或运行
   **Marginalia Bona: Add annotation to selection**。
3. 在侧栏撰写评论。`Enter` 保存，`Shift+Enter` 换行。
4. 回复某条批注：在侧栏展开它，在线程下方输入即可。

当某条线程需要重新锚定时，从侧栏发起重锚流程，然后选中段落的新位置，右键
选择 **Re-anchor annotation here**。

### 批注 PDF

1. 在 Obsidian 的 PDF 阅读器中选中文字。
2. 右键选择 **Add annotation**，或运行
   **Marginalia Bona: Add annotation to PDF selection**。
3. 在侧栏撰写并保存评论。

### 添加文档级评论

不选中文字，直接运行
**Marginalia Bona: Add annotation to current document**。评论附着于整篇
笔记，而不是某个段落。

### 打开侧栏

运行 **Marginalia Bona: Open annotations**，或点击功能区里的消息图标。

侧栏可以显示当前文件的批注，也可以显示全库。搜索范围覆盖评论正文、回复、
引文与笔记路径；可按状态、作者、已读状态过滤；按位置、创建时间或更新时间
排序。

### 已删除的批注

删除批注会先进入回收站，而不是直接抹掉。通过 MCP/REST 端点列出并恢复被
删除的线程；条目在 30 天后自动清理。

### 导出

运行 **Marginalia Bona: Export this note's annotations to Markdown** 导出
当前笔记，或 **Export all annotations to Markdown** 导出全库。导出文件写入
`.marginalia-bona/exports/`。

## Agent 访问

Marginalia Bona 可以通过
[Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)
插件让 AI Agent 读写批注。安装该插件并保持它运行在 `127.0.0.1`，即可使用
以下任一通道。

**MCP 工具**（默认开启）：在 Local REST API 服务器的 `/mcp` 端点上注册了
十一个工具——批注的列出、创建、获取、更新、删除，回复管理，重新锚定，以及
回收站的列出与恢复。工具会校验输入，并复用与侧栏相同的规则：引文在文中多次
出现时会被拒绝并附带匹配数，调用方需指明第几处；乐观锁（`expected_text`、
`expected_quote`）在线程被读过又发生变化时返回明确的 409。

**REST 端点**（默认关闭）：同样的操作以纯 HTTP 形式暴露在 `/annotations/`
之下，Local REST API 服务器原有的 `/openapi.yaml` 里有完整描述。

直接读磁盘上的批注文件永远安全，往往也最快；桥接的意义在于让写入经过插件
完成——由插件构建锚点、维护索引一致性。

## 设置

- 高亮的可见性、颜色、不透明度与样式
- 边注的可见性、侧边与最大宽度
- 窄窗格自动回退
- 已解决批注的可见性
- 超长单词、链接与代码的强制换行
- 粘贴图片的附件目录（默认跟随 Obsidian 约定）
- Agent 访问：MCP 工具开关、REST 端点开关

## 存储

批注以独立 Markdown 文件存储在：

```text
.marginalia-bona/annotations/<源笔记路径>/<引文摘要>-<短id>.md
```

一个文件就是一条线程：frontmatter 携带身份、状态、样式与已读状态；正文是
根评论；回复在 `Replies` 标题之下；文件末尾的 JSON 代码块记录锚点。文件名
在线程创建时生成，此后保持不变——即使锚定的文本发生变化。

`.marginalia-bona/index/` 目录按文档存放 JSONL 分片——这是可重建的缓存，
让 Agent 和侧栏无需读遍所有文件就能定位线程。运行
**Marginalia Bona: Rebuild annotation index** 可随时重建。

删除批注会移入 `.marginalia-bona/trash/` 并保留 30 天。源笔记与 PDF 永远
不会被修改。

## 隐私与权限

- 无遥测、无广告、无账号，插件自身不发起网络请求。
- 批注数据只保存在库内的 `.marginalia-bona/`。
- Agent 桥接只与本机的 Local REST API 插件通信，不额外监听任何端口。
- PDF 选择与高亮定位依赖 Obsidian 内部 PDF 阅读器的 DOM——公开插件 API 没有
  暴露这些能力，因此 Obsidian 升级后可能需要一次兼容性更新。

## 开发

需要 Node.js 24 或更新版本。

```sh
npm ci
npm run lint
npm test
npm run build
```

生产构建在仓库根目录生成 `main.js`。涉及存储或锚点的改动应附带测试；测试
覆盖查询引擎、线程格式往返、回收站一致性与 API 协议。

## 发布

1. 运行 `npm version patch`、`npm version minor` 或 `npm version major`。
2. 推送提交与数字标签，例如 `0.2.0`（不带 `v` 前缀）。
3. GitHub Actions 校验标签、运行 lint 与测试并构建插件，然后创建包含
   `main.js`、`manifest.json`、`styles.css` 的草稿 Release。
4. 检查并发布草稿。

`package.json`、`manifest.json`、Git 标签与 GitHub Release 中的版本号必须
完全一致。

## 致谢与许可

- [Siden](https://github.com/giuseqpe/siden)，作者 Giuseppe——原插件，
  MIT 协议。Marginalia Bona 保留上游署名。
- 设计上也参考了其他批注插件的想法；未使用任何 GPL 代码。
- Marginalia Bona 以 MIT 协议发布。
