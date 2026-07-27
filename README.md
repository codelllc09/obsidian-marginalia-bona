# Siden

Siden adds annotations to Markdown notes and PDFs in Obsidian.

Select a passage, write a Markdown comment in the sidebar, and return to it
later. Markdown annotations can also appear beside the text as margin cards.

## Features

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

Copy `main.js`, `manifest.json`, and `styles.css` into:

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

## Development

Requires Node.js 20 or newer.

```sh
npm install
npm test
npm run typecheck
npm run build
```

The production build writes `main.js` to the repository root.

PDF highlighting integrates with Obsidian's internal PDF viewer and may require
compatibility updates when Obsidian changes that viewer.
