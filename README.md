# Siden

Siden is an original Obsidian annotation plugin for Markdown notes and PDFs.
Comments stay in a unified sidebar while their source passages can be
highlighted. Markdown comments can additionally appear as margin cards in Live
Preview and Reading View.

## Features

- Human-readable annotation files under `.siden/annotations`
- Sidebar-first creation and editing with Markdown comment bodies
- Current-file and whole-vault review modes
- Search and open/resolved/orphaned filters
- Resolve, reopen, and recoverable delete actions
- Markdown highlights with edit-time position mapping
- Conservative quote-and-context recovery after external edits
- Markdown margin cards in Live Preview and Reading View
- Independent highlight and margin settings
- Automatic sidebar-only layout in narrow panes and on mobile
- Non-destructive PDF selection highlights and sidebar comments
- PDF page navigation
- Markdown export
- Conflict and malformed-file diagnostics

Siden does not modify source notes or PDFs. PDF integration is isolated because
Obsidian's PDF viewer does not currently expose a stable public annotation API.

## Installation for development

Requirements:

- Node.js 20 or newer
- npm

```sh
npm install
npm test
npm run typecheck
npm run build
```

Copy or link this repository into:

```text
<vault>/.obsidian/plugins/siden
```

Enable **Siden** under Obsidian's Community plugins settings. The production
build creates `main.js` in the repository root.

## Usage

### Markdown passage

1. Select text in Live Preview.
2. Use the context menu or run **Siden: Add annotation to selection**.
3. Write the comment in the Siden sidebar.
4. Press `Ctrl/Cmd+Enter` or select **Save**.

### PDF passage

1. Select text in Obsidian's PDF viewer.
2. Run **Siden: Add annotation to PDF selection** or use the selection context
   action.
3. Write and save the comment in the sidebar.

### Document comment

Run **Siden: Add annotation to current document** without selecting text.

### Review and export

- Run **Siden: Open annotations** for the sidebar.
- Switch between the active document and the whole vault.
- Run **Siden: Export all annotations to Markdown** to create a readable export
  under `.siden/exports`.

## Storage and recovery

Every annotation is a standalone Markdown file. Frontmatter contains identity
and lifecycle metadata, the comment body is normal Markdown, and a clearly
labelled JSON block contains the anchor geometry. This format is intentionally
readable without Siden.

Deleting an annotation moves its file to `.siden/trash`; it is not immediately
destroyed. Invalid and duplicate annotation files are preserved and reported
rather than overwritten.

The plugin manages metadata and anchor blocks. Manual edits should be limited to
the text below the `# Annotation` heading.

## Platform behavior

- Desktop Markdown: sidebar, highlights, and margins
- Mobile or narrow panes: sidebar and highlights; margins collapse
- PDF: sidebar and highlights only

PDF behavior depends on Obsidian's internal PDF viewer DOM and therefore needs
regression testing when Obsidian changes its bundled viewer.

## Project status

The feature layers in [MILESTONES.md](MILESTONES.md) are implemented as a
pre-release build. Manual compatibility testing inside supported Obsidian
desktop/mobile versions remains necessary before a public 1.0 release.
