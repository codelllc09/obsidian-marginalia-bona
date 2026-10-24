# Siden Plus

> Fork of [Siden](https://github.com/giuseqpe/siden) by Giuseppe (MIT), with
> per-annotation styling, reply threads, and an agent-friendly index. All
> credit for the original design and implementation belongs to the upstream
> author.

Siden adds annotations to Markdown notes and PDFs in Obsidian.

Select a passage, write a Markdown comment in the sidebar, and return to it
later. Markdown annotations can also appear beside the text as margin cards.

## What the fork adds

- **Per-annotation styles**: each annotation picks its own color and mark
  style (highlight / underline / wavy / strikethrough / bold)
- **Reply threads**: discuss inside one annotation; replies stay in the same
  Markdown file as the root comment
- **Agent-friendly index**: `.siden-plus/index/<doc>.jsonl` shards give
  quick location lookups without reading every file (rebuildable via the
  *Rebuild annotation index* command)
- **Sidebar ergonomics**: Enter-to-submit (Shift+Enter for newline), card
  collapse, scroll-to-top/bottom, copy comment / thread / quote / reply
- Isolated data directory `.siden-plus/` — coexists with upstream Siden

## Features (inherited from Siden)

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

## Installation

Once Siden is accepted into the community plugin directory, install it from
**Settings → Community plugins → Browse**.

For manual installation, download `main.js`, `manifest.json`, and `styles.css`
from the same GitHub release and copy them into:

```text
<vault>/.obsidian/plugins/siden/
```

Reload Obsidian, then enable **Siden** under **Settings → Community plugins**.

## Usage

### Annotate Markdown

1. Select text in Live Preview.
2. Right-click and choose **Add Siden annotation**, or run
   **Siden: Add annotation to selection**.
3. Write the comment in the Siden sidebar.
4. Press `Ctrl/Cmd+Enter` to save.

### Annotate a PDF

1. Select text in Obsidian's PDF viewer.
2. Right-click and choose **Add Siden annotation**, or run
   **Siden: Add annotation to PDF selection**.
3. Write and save the comment in the sidebar.

### Add a document comment

Run **Siden: Add annotation to current document** without selecting text.

### Open the sidebar

Run **Siden: Open annotations** or use the message icon in the ribbon.

The sidebar can show annotations for the current file or the entire vault.
Use its search box and status filter to find open, resolved, or orphaned
annotations.

## Settings

Siden lets you configure:

- Highlight visibility, color, opacity, and style
- Margin visibility, side, and maximum width
- Automatic narrow-pane fallback
- Resolved annotation visibility
- Forced wrapping for very long words, links, and code

Margins automatically choose the side with more space. They are hidden when the
Siden sidebar is open or when neither side has enough room.

## Storage

Annotations are stored as individual Markdown files under:

```text
.siden/annotations/
```

Deleting an annotation moves it to `.siden/trash/`. Source Markdown and PDF
files are never modified.

Run **Siden: Export all annotations to Markdown** to create a readable export
under `.siden/exports/`.

## Privacy and permissions

- Siden does not collect telemetry, display ads, require an account, or make
  network requests.
- Annotation data stays inside the vault in `.siden/`.
- Siden reads selected source files and writes only its annotation, trash, and
  export files. It does not access files outside the vault.
- Siden does not update itself. Updates are delivered through Obsidian or
  manually installed GitHub releases.

PDF selection and highlight positioning integrate with Obsidian's internal PDF
viewer DOM because the public plugin API does not expose those features. An
Obsidian update can therefore require a compatibility update to Siden.

## Development

Requires Node.js 24 or newer.

```sh
npm ci
npm run lint
npm test
npm run build
```

The production build writes `main.js` to the repository root.

## Releasing

1. Run `npm version patch`, `npm version minor`, or `npm version major`.
2. Push the commit and its numeric tag, for example `0.2.0` (without a `v`
   prefix).
3. GitHub Actions validates the tag, lints, tests, and builds the plugin, then
   creates a draft release containing `main.js`, `manifest.json`, and
   `styles.css`.
4. Review and publish the draft release.

The version in `package.json`, `manifest.json`, the Git tag, and the GitHub
release must match exactly.
