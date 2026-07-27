# Siden milestone plan

Siden is an original implementation. Other Obsidian annotation plugins are
product references only.

## Product invariants

- Annotation comments are human-readable Markdown under `.siden/annotations`.
- Source Markdown and PDF files are never modified to store annotations.
- Markdown annotations support sidebar, highlight, and margin presentations.
- Live Preview and Reading View margins are part of the first release.
- PDF annotations use the sidebar and non-destructive highlights, never margins.
- Highlight and margin visibility are independent settings.
- Ambiguous anchors become orphaned instead of silently moving.
- Deletes are recoverable through `.siden/trash`.

## Milestone 0 — Specification and feasibility

Status: Implemented; manual compatibility validation remains.

- [x] Define the first-release boundary and domain model.
- [x] Select one readable Markdown file per annotation.
- [x] Prototype Live Preview and Reading View margin renderers.
- [x] Prototype PDF selection capture and overlay highlighting.
- [x] Record the minimum Obsidian version in `manifest.json`.
- [ ] Validate hidden-folder behavior on desktop, mobile, and Obsidian Sync.

Exit criterion: the automated build contains all three presentation adapters.
Manual visual validation is tracked in [RELEASE.md](RELEASE.md).

## Milestone 1 — Annotation core and storage

Status: Implemented.

- [x] Versioned Markdown, PDF, and document anchor types.
- [x] Deterministic Markdown serialization and parsing.
- [x] Hidden adapter-based storage and in-memory indexes.
- [x] Create, update, resolve, reopen, and recoverable-delete operations.
- [x] Source rename tracking.
- [x] Invalid-file and duplicate-ID diagnostics.
- [x] Conservative cold-start anchor reconciliation.
- [x] Tests for format round-tripping, recovery, ambiguity, and trash.

Exit criterion: valid annotation files survive reload independently; invalid or
conflicting files are preserved and reported.

## Milestone 2 — Unified sidebar

Status: Implemented.

- [x] Current-document and whole-vault modes.
- [x] Sidebar-first create and edit forms.
- [x] Unsaved-draft protection and keyboard save/cancel.
- [x] Resolve, reopen, and confirmed recoverable delete.
- [x] Open, resolved, orphaned, and all filters.
- [x] Search by body, quote, and source path.
- [x] Source-position ordering.
- [x] Safe Obsidian Markdown rendering.
- [x] Click and keyboard navigation.
- [x] Shared active-annotation state.

Exit criterion: the complete annotation lifecycle is available in the sidebar.

## Milestone 3 — Markdown anchors and highlights

Status: Implemented.

- [x] Capture selections and surrounding quote context.
- [x] CodeMirror 6 highlight decorations.
- [x] Map offsets through editor transactions.
- [x] Update the quote when users edit inside an anchored passage.
- [x] Recover unique anchors after external edits.
- [x] Orphan deleted or ambiguous anchors.
- [x] Recover anchors when undo restores the passage.
- [x] Configurable highlight color, opacity, style, and visibility.

Exit criterion: editor changes preserve the intended range and cold-start
recovery never chooses between ambiguous duplicates.

## Milestone 4 — Markdown margins

Status: Implemented; visual collision and theme QA remains.

- [x] Consistent accessible margin-card components.
- [x] Live Preview CodeMirror widgets.
- [x] Reading View postprocessor cards.
- [x] Left, right, and automatic placement.
- [x] Configurable width and typography based on Obsidian theme variables.
- [x] CodeMirror viewport-aware rendering.
- [x] Responsive sidebar-only fallback.
- [x] Sidebar/highlight/margin activation synchronization.
- [ ] Complete manual collision testing for dense annotations and uncommon themes.

Exit criterion: both Markdown views expose the same annotation set and narrow
panes automatically suppress margins.

## Milestone 5 — PDF annotations

Status: Implemented as an isolated experimental adapter; compatibility QA remains.

- [x] Capture selected text, page, context, and rectangles.
- [x] Command and context action.
- [x] Non-destructive overlay highlights.
- [x] Sidebar navigation to the source PDF page.
- [x] Page-position ordering.
- [x] Isolate private viewer DOM integration.
- [x] Prevent observer loops while rendering overlays.
- [ ] Run the supported-Obsidian-version compatibility matrix.

Exit criterion: the source PDF is never written by Siden and PDF integration can
be changed without touching storage or sidebar code.

## Milestone 6 — Mobile and synchronization safeguards

Status: Implemented at code level; device and provider QA remains.

- [x] Touch-sized, responsive sidebar controls.
- [x] Sidebar-only presentation on narrow/mobile layouts.
- [x] Preserve duplicate/conflicting files.
- [x] Storage diagnostics.
- [x] Recoverable trash.
- [ ] Validate iOS and Android.
- [ ] Validate Obsidian Sync, iCloud, and filesystem synchronization.

Exit criterion: conflicts cannot silently overwrite an annotation. Device tests
are listed in [RELEASE.md](RELEASE.md).

## Milestone 7 — Release hardening

Status: Engineering work implemented; external release actions remain.

- [x] Strict TypeScript build.
- [x] Automated storage and parser tests.
- [x] Production bundling.
- [x] CI workflow.
- [x] Obsidian theme-variable styling and keyboard accessibility.
- [x] Human-readable Markdown export.
- [x] Onboarding, storage, platform, and release documentation.
- [ ] Complete the manual release matrix.
- [ ] Publish a beta release.
- [ ] Submit to the Obsidian community-plugin registry.

The final three actions require running Siden inside real Obsidian installations
and explicitly publishing externally; they are not implied by a source-code
commit.
