# ADR Priority List - TagForge

**Last Updated:** December 30, 2024

---

## Phase 1: Foundation (MVP) - COMPLETE

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 1 | Plugin scaffold & build setup | **Done** | TypeScript, esbuild, manifest.json |
| 2 | Settings infrastructure | **Done** | Settings class, data persistence |
| 3 | Settings UI tab | **Done** | Basic configuration interface |
| 4 | Single file tagging | **Done** | Bug fixed: changed to `instanceof TFile` |

**Phase 1 Goal:** Plugin loads, has settings, can manually add a tag to a file. ✓

---

## Phase 2: Auto-Watch (Priority 1) - COMPLETE

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 5 | File create watcher | **Done** | `vault.on('create')` wrapped in `onLayoutReady()` |
| 6 | Basic folder rules | **Done** | Uses hierarchical inheritance from Phase 5 |
| 7 | Apply tags on file create | **Done** | New files get tags based on location |
| 8 | File move detection | Planned | Moved to Phase 6 |

**Phase 2 Goal:** New files automatically get tags based on folder. ✓

### Phase 2.5: Enhanced Revert Commands (Bonus)

| Feature | Status | Notes |
|---------|--------|-------|
| Revert auto-tags only | **Done** | Removes only tracked tags, preserves manual |
| Nuclear revert | **Done** | Remove ALL tags from vault with double-confirm |
| Date-filtered revert | **Done** | DatePickerModal to select dates to revert |

---

## Phase 3: Bulk & Selective Push (Priority 2) - COMPLETE

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 9 | Bulk apply command | **Done** | Full vault with preview |
| 10 | Selective folder push | **Done** | FolderPickerModal with subdirectory option |
| 11 | Preview/dry-run mode | **Done** | Enhanced BulkPreviewModal with level toggles |
| 12 | Tag tracking database | **Done** | Stored in data.json under `tagTracking` |

**Phase 3 Goal:** Can retroactively tag existing files with preview. ✓

---

## Phase 4: One-Time Batch Tagger - ABSORBED

Phase 4 features were absorbed into Phase 3's enhanced preview modal:

| Original Feature | Implementation |
|-----------------|----------------|
| File selection UI | Checkboxes in BulkPreviewModal |
| Batch tag input | Additional tags input field |
| Apply batch tags | "Apply to selected only" option |

**Phase 4 Goal:** Achieved through Phase 3 enhanced modal. ✓

---

## Phase 5: Hierarchical Inheritance (Priority 3) - COMPLETE

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 16 | Depth configuration | **Done** | Number input (no max limit) |
| 17 | Folder name → tag conversion | **Done** | Auto-converts to lowercase-hyphenated |
| 18 | Folder aliases | **Done** | Settings UI with multi-tag support |
| 19 | Inheritance engine | **Done** | `getTagsForPath()` walks folder tree |

**Phase 5 Goal:** Files inherit tags from parent folders up to configured depth. ✓

---

## Phase 6: Move Handling - NEXT UP

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 20 | Move confirmation modal | Planned | Prompt on file path change |
| 21 | Update tags on confirm | Planned | Remove old auto-tags, apply new |
| 22 | Undo move option | Planned | Restore file and original tags |
| 23 | Protected tags | Planned | Settings already exist (`protectedTags`) |

**Phase 6 Goal:** Graceful handling of file moves with user control.

**Implementation Notes:**
- Use `vault.on('rename')` - fires for both renames and moves
- Detect move by checking if parent folder changed
- Store original path/tags temporarily for undo
- `showMoveConfirmation` setting already exists

---

## Phase 7: Advanced Rules

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 24 | Ignore patterns | **Done** | `ignorePaths` setting already implemented |
| 25 | Filename pattern rules | Planned | Regex/glob on filenames |
| 26 | Content-based rules | Planned | Search content for patterns |
| 27 | Template integration | Planned | Tags based on template origin |

**Phase 7 Goal:** Sophisticated rule engine beyond folder-based tagging.

---

## Phase 8: Polish & UX

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 28 | Undo/history | Planned | Rollback last operation |
| 29 | Tag report dashboard | Planned | Visual overview of tag landscape |
| 30 | Validation warnings | Planned | Missing tags, orphaned tags |

**Phase 8 Goal:** Production-ready with great UX.

---

## Phase 9: Mobile Optimization (User Requested)

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 31 | Responsive modal CSS | Planned | All modals work on mobile |
| 32 | Touch-friendly UI | Planned | Larger tap targets, better spacing |
| 33 | Mobile testing | Planned | Test on Obsidian mobile app |

**Phase 9 Goal:** Full functionality on mobile devices.

---

## Future Possibilities (Not Scheduled)

| Feature | Notes |
|---------|-------|
| Tag suggestions | AI-powered tag recommendations |
| Graph view integration | Custom graph filtering presets |
| Tag cleanup command | Remove orphaned/unused tags |
| Import/export rules | Share configurations |
| Multi-vault sync | Share rules across vaults |

---

## Technical Debt / Known Issues

| Item | Priority | Status |
|------|----------|--------|
| ~~TFile type check~~ | ~~High~~ | **RESOLVED** - Changed to `instanceof TFile` |

*No current technical debt items.*

---

## Development Notes

- **Environment:** Windows 11
- **Source code:** `C:\Users\bwales\projects\obsidian-plugins\tagforge\`
- **Deploy target:** `G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\tagforge\`
- **Test vault:** ~300 files, 5-7 folder levels deep
- **Hot reload:** Use Obsidian Hot Reload plugin or manual reload
- **Build command:** `npm run dev` for watch mode (configure esbuild to output to deploy target)

---

## Reference Material

- **Inspiration:** [obsidian-automatic-tags](https://github.com/Jamalam360/obsidian-automatic-tags) (MIT)
- **Plugin template:** [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- **API docs:** https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
