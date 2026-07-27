# Release checklist

## Automated

- [ ] `npm ci`
- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `git diff --check`
- [ ] Verify `manifest.json`, `versions.json`, and `package.json` versions match

## Desktop manual matrix

- [ ] Create, edit, resolve, reopen, and delete a Markdown annotation
- [ ] Verify highlight mapping across insertions, deletions, undo, and restart
- [ ] Verify ambiguous duplicate text becomes orphaned
- [ ] Verify Live Preview margin positioning and narrow-pane fallback
- [ ] Verify Reading View highlighting and margins
- [ ] Verify current-file and whole-vault sidebar modes
- [ ] Verify search and status filters
- [ ] Verify light and dark themes
- [ ] Verify keyboard-only operation
- [ ] Verify PDF selection capture, highlight overlay, and page navigation
- [ ] Verify source Markdown and PDF bytes are unchanged

## Mobile and synchronization

- [ ] Test iOS
- [ ] Test Android
- [ ] Test Obsidian Sync
- [ ] Test iCloud or filesystem synchronization
- [ ] Force a duplicate annotation conflict and confirm both files survive

## Packaging

- [ ] Include `main.js`, `manifest.json`, and `styles.css`
- [ ] Create a clean-vault smoke test
- [ ] Publish a beta release
- [ ] Collect compatibility feedback
- [ ] Submit to the Obsidian community-plugin registry
