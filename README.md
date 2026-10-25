# Marginalia Bona

English | [简体中文](README.zh-CN.md)

Marginalia Bona is a fork of [Siden](https://github.com/giuseqpe/siden) by
Giuseppe (MIT), with per-annotation styling, reply threads, and an
agent-friendly index. All credit for the original design and implementation
belongs to the upstream author.

Marginalia Bona adds annotations to Markdown notes and PDFs in Obsidian.

Select a passage, write a Markdown comment in the sidebar, and return to it
later. Markdown annotations can also appear beside the text as margin cards.
Annotations are plain Markdown files inside your vault, so other tools —
including AI agents — can read and write them directly.

## Features

Inherited from Siden:

- Annotate selected Markdown and PDF text
- Review, search, edit, resolve, reopen, and delete annotations in one sidebar
- Highlight annotated passages
- Show responsive margin cards in Live Preview and Reading View
- Navigate between sidebar comments and their source passages
- Keep source notes and PDFs unchanged
- Store annotations as human-readable Markdown
- Recover Markdown anchors after edits when they can be identified safely

PDF annotations use sidebar comments and highlights only. Margin cards are
available for Markdown notes.

Added by the fork:

- Per-annotation color and mark style (highlight, underline, wavy,
  strikethrough, bold)
- Reply threads inside one annotation file
- Read/unread state with an unread filter and a "mark all read" command
- Sort by document position, creation, or last update; full-vault text search
- A recycle bin: deleting moves the thread to `.marginalia-bona/trash/`,
  restorable for 30 days
- Paste images into the sidebar; they are stored following your attachment
  settings
- Export one note's annotations, or the whole vault, as readable Markdown
- An agent bridge: MCP tools and REST endpoints over the Local REST API
  plugin, so AI agents can create and edit annotations safely

## Installation

The plugin is not in the community plugin directory. Install it manually, or
through [BRAT](https://github.com/TfTHacker/obsidian42-brat).

For manual installation, download `main.js`, `manifest.json`, and
`styles.css` from a GitHub release and copy them into:

```text
<vault>/.obsidian/plugins/marginalia-bona/
```

Reload Obsidian, then enable **Marginalia Bona** under
**Settings → Community plugins**.

The data directory `.marginalia-bona/` is separate from upstream Siden's
`.siden/`, so both plugins can coexist in one vault.

## Usage

### Annotate Markdown

1. Select text in Live Preview.
2. Right-click and choose **Add annotation**, or run
   **Marginalia Bona: Add annotation to selection**.
3. Write the comment in the sidebar. `Enter` saves, `Shift+Enter` inserts a
   newline.
4. To reply to an annotation, open it in the sidebar and write below the
   thread.

When a drifted thread is re-anchored from the sidebar, select its new
location, right-click and choose **Re-anchor annotation here**.

### Annotate a PDF

1. Select text in Obsidian's PDF viewer.
2. Right-click and choose **Add annotation**, or run
   **Marginalia Bona: Add annotation to PDF selection**.
3. Write and save the comment in the sidebar.

### Add a document comment

Run **Marginalia Bona: Add annotation to current document** without selecting
text. The comment attaches to the note as a whole rather than to a passage.

### Open the sidebar

Run **Marginalia Bona: Open annotations** or use the message icon in the
ribbon.

The sidebar can show annotations for the current file or the entire vault.
Search across comment bodies, replies, quotes, and note paths; filter by
status, author, and read state; sort by position, creation date, or last
update.

### Deleted annotations

Deleting an annotation moves it to the recycle bin instead of erasing it.
The bin has no sidebar view yet; agents list and restore deleted threads
through the MCP tools or REST endpoints. Entries are purged after 30
days.

### Export

Run **Marginalia Bona: Export this note's annotations to Markdown** for the
current note, or **Export all annotations to Markdown** for the whole vault.
Exports are written to `.marginalia-bona/exports/`.

## Agent access

Marginalia Bona can let AI agents read and write annotations through the
[Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)
plugin. Install it and keep it running on `127.0.0.1` to use either channel.

**MCP tools** (enabled by default): eleven tools on the Local REST API
server's `/mcp` endpoint.

| Tool | Does |
|---|---|
| `marginalia_list_annotations` | Lists threads. `source` scopes to one note; without it the whole vault is searched. Filters: `status`, `author`, `read`, `q`; ordering with `sort` and `dir`; `limit` caps output. |
| `marginalia_create_annotation` | Anchors `quote` in `source` and stores `text`. A quote matching several passages is rejected with the match count until `occurrence` (1-based) says which one. `author`, `color` (hex), `style` optional. |
| `marginalia_get_annotation` | One thread by `source` and `id`, with its anchor, replies, and read state. |
| `marginalia_update_annotation` | Edits `text` (`expected_text` refuses the write with a 409 when the thread changed since it was read), or sets `status`, `read`, `color`, `style`. |
| `marginalia_delete_annotation` | Moves the thread to the recycle bin; the response names the trash file. |
| `marginalia_add_reply` | Appends a reply to a thread. |
| `marginalia_update_reply` | Edits one reply's text (and optionally its author). |
| `marginalia_delete_reply` | Removes one reply. |
| `marginalia_reanchor` | Attaches a thread to a new passage: same quote rules as create, `expected_quote` optional lock. Body and replies are kept. |
| `marginalia_list_trash` | Lists recycle-bin entries with id, source, and body preview. |
| `marginalia_restore_annotation` | Moves a trash entry back to its annotations folder and reconciles the anchor against the note as it is now. |

**REST endpoints** (off by default): the same operations as plain HTTP under
`/vault/<note path>/annotations/`, described in the `/openapi.yaml` that the
Local REST API server already serves. For example:

```sh
curl -k -X POST -H "Authorization: Bearer <api key>" -H "Content-Type: application/json" \
  --data '{"text": "Consider a table here", "quote": "the three options", "author": "Pi"}' \
  "https://127.0.0.1:27124/vault/Projects/Plan.md/annotations/"
```

Reading annotation files directly from disk is always safe and often fastest;
the bridge exists so that writes go through the plugin, which builds anchors
and keeps the index consistent.

## Settings

- Highlight visibility, color, opacity, and style
- Margin visibility, side, and maximum width
- Automatic narrow-pane fallback
- Resolved annotation visibility
- Forced wrapping for very long words, links, and code
- Attachments folder for pasted images (follows Obsidian's convention by
  default)
- Agent access: MCP tools on/off, REST endpoints on/off

## Storage

Annotations are stored as individual Markdown files under:

```text
.marginalia-bona/annotations/<source path>/<quote excerpt>-<short id>.md
```

Each file is one thread. A real one, shortened:

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

Frontmatter carries identity, status, styling, and read state; the body is
the root comment; replies follow under a `Replies` heading; the fenced JSON
block at the end records the anchor. File names are minted when the thread is
created and stay stable afterwards, even when the anchored text drifts.

The `.marginalia-bona/index/` folder holds one JSONL shard per document — a
rebuildable cache that lets agents and the sidebar locate threads without
reading every file. Run **Marginalia Bona: Rebuild annotation index** to
regenerate it.

Deleting an annotation moves it to `.marginalia-bona/trash/` for 30 days.
Source Markdown and PDF files are never modified.

## Privacy and permissions

- No telemetry, no ads, no accounts, no network requests of its own.
- Annotation data stays inside the vault in `.marginalia-bona/`.
- The agent bridge talks to the Local REST API plugin on your machine only;
  it adds no listeners of its own.
- PDF selection and highlight positioning integrate with Obsidian's internal
  PDF viewer DOM because the public plugin API does not expose those
  features. An Obsidian update can therefore require a compatibility update.

## Limitations

- PDF annotations are sidebar comments and highlights only; no margin cards.
- The recycle bin has no sidebar view yet; agents reach it over MCP or REST.
- A quote that appears more than once in a note is never anchored on a guess:
  the caller must say which occurrence it means.
- PDF selection and highlight positioning depend on Obsidian's internal PDF
  viewer DOM and may need a compatibility update after Obsidian upgrades.

## Development

Requires Node.js 24 or newer.

```sh
npm ci
npm run lint
npm test
npm run build
```

The production build writes `main.js` to the repository root. Changes to
storage or anchoring are expected to come with tests; the suite covers the
query engine, thread format round-trips, trash consistency, and the API
protocol.

## Releasing

1. Run `npm version patch`, `npm version minor`, or `npm version major`.
2. Push the commit and its numeric tag, for example `0.2.0` (without a `v`
   prefix).
3. GitHub Actions validates the tag, lints, tests, and builds the plugin,
   then creates a draft release containing `main.js`, `manifest.json`, and
   `styles.css`.
4. Review and publish the draft release.

The version in `package.json`, `manifest.json`, the Git tag, and the GitHub
release must match exactly.

## Credits and license

- [Siden](https://github.com/giuseqpe/siden) by Giuseppe — the original
  plugin, MIT. Marginalia Bona keeps the upstream attribution.
- Ideas were also drawn from other annotation plugins; no GPL code was used.
- Marginalia Bona is released under the MIT license.
