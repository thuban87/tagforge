# ADR Priority List - TagForge

**Last Updated:** January 3, 2025
**Version:** 1.0.1 (Folder Rules System + Bug Fixes)

---

## Phase 11: Bug Fixes & Polish - IN PROGRESS

**Summary:** Testing revealed critical bugs. Fixed 9 bugs on January 3, 2025. Remaining items are investigations and UI polish.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 56 | Fix old algorithm calls (2 places) | **Done** | Changed to `getRulesForPath()` |
| 57 | Fix undo to restore tracking | **Done** | Added `trackingBefore` to operations |
| 58 | Fix `inheritFromAncestors` logic | **Done** | Barrier-based blocking now works |
| 59 | Fix protected tags (apply vs remove) | **Done** | Can add, can't remove |
| 60 | Fix revert functions (protected tags) | **Done** | All 3 revert functions now respect protected |
| 61 | Add validation dismiss buttons | **Done** | Per-item and "Dismiss All Missing" |
| 62 | Fix move modal messaging | **Done** | Shows tag status for both single/grouped |
| 63 | Fix inherit default & saveability | **Done** | Default true, barrier rules saveable |
| 64 | Fix undo modal language | **Done** | revert→REMOVE, bulk→BULK ADD |
| 65 | Investigate text field unresponsive | Pending | Happens after remove, recovers in seconds |
| 66 | Investigate validation mobile vs desktop | Pending | Different results on different platforms |
| 67 | Rules Manager: expand/collapse all | Pending | Low complexity |
| 68 | Tag Report: scrollable on mobile | Pending | CSS fix |
| 69 | Hide nuclear on mobile | Pending | Low complexity |
| 70 | Bulk Add: clarify radio scope | Pending | Low complexity |
| 71 | Rules Manager: rule summary text | Pending | Medium complexity |
| 72 | Validation: filtering/sorting | Pending | Medium complexity |
| 73 | Folder-scoped nuclear option | Pending | Medium complexity |

---

## Phase 10: Explicit Folder Rules System - COMPLETE

**ADR:** `docs/ADR-002-FolderRulesSystem.md`

**Summary:** Replace implicit folder-name-to-tag algorithm with explicit rules. Tags only apply when rules exist. Full user control.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 49 | Add `folderRules` to data model | **Done** | `Record<string, FolderRule>` in settings |
| 50 | Create `getRulesForPath()` function | **Done** | Replaces implicit algorithm, includes barrier logic |
| 51 | Update file creation watcher | **Done** | Use rules instead of algorithm |
| 52 | Update nuclear option | **Done** | Also wipes `folderRules`, updated warning text |
| 53 | Rules Management Modal | **Done** | Folder tree + rule editor, accessed from settings |
| 54 | Bulk Add Modal: "Save as rule" option | **Done** | Checkbox + level selection |
| 55 | Remove legacy `getTagsForPath()` | **Done** | All calls changed to `getRulesForPath()` |

**Rule Data Model:**
```typescript
interface FolderRule {
  tags: string[];                      // Tags this rule applies
  folderTagLevels: number[];           // Dynamic: derive tags from folder levels
  applyDownLevels: 'all' | number[];   // 'all' or specific levels [1, 2, 4]
  inheritFromAncestors: boolean;       // Accept tags from parent rules? (default: true)
  applyToNewFiles: boolean;            // Trigger on file creation?
  createdAt: string;
  lastModified: string;
}
```

**Key Behaviors:**
- Push-down model: Rules push tags to children based on `applyDownLevels`
- Additive stacking: Multiple rules combine, no conflicts
- Barrier rules: `inheritFromAncestors: false` blocks parent rules from passing through
- Level skipping: `[1, 3, 4]` applies to levels 1, 3, 4 but skips level 2
- No rules = no auto-tags (fully explicit)

---

## Post-v1.0.0: UI Improvements - COMPLETE

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 44 | Settings-window sized modals | **Done** | 90vw x 80vh, max 900px, mobile full-screen |
| 45 | 2-column layout for BulkPreviewModal | **Done** | File tree left, controls right |
| 46 | Grouped move modal close button fix | **Done** | setTimeout + fs.rmdirSync bypass (Google Drive phantoms remain) |
| 47 | Windows system file cleanup | **Done** | desktop.ini, Thumbs.db deleted on folder cleanup |
| 48 | Edit/delete tags in bulk add modal | **Done** | Edit mode with strikethrough deletion, auto-tags freely editable, manual tags with warning |

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
| 8 | File move detection | **Done** | Moved to Phase 6, now complete |

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

## Phase 6: Move Handling - COMPLETE

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 20 | Move confirmation modal | **Done** | Prompt on file path change with 3 options |
| 21 | Update tags on confirm | **Done** | Remove old auto-tags, apply new |
| 22 | Undo move option | **Done** | Cancel moves file back to original location |
| 23 | Protected tags | **Done** | Settings already exist (`protectedTags`) |

**Phase 6 Goal:** Graceful handling of file moves with user control. ✓

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

## Phase 8: Polish & UX - COMPLETE

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 28 | Undo/history | **Done** | Last 50 operations, history picker modal |
| 29 | Tag report dashboard | **Done** | TagForge tags + manual tags sections |
| 30 | Validation warnings | **Done** | Orphaned, missing, ignored path issues |

**Phase 8 Goal:** Production-ready with great UX. ✓

### Additional Features Added

| Feature | Status | Notes |
|---------|--------|-------|
| Folder-specific revert | **Done** | `REVERT: Remove auto-tags from specific folder` |
| Rename path tracking | **Done** | Operation history updates when files renamed |
| Duplicate tag prevention | **Done** | Case-insensitive comparison |

---

## Phase 9: Mobile Optimization (User Requested) - COMPLETE

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 31 | Responsive modal CSS | **Done** | All modals full-width on mobile, proper sizing |
| 32 | Touch-friendly UI | **Done** | 44px min touch targets, better spacing |
| 33 | Mobile testing | **Done** | Tested on Android, user approved |

### Additional Phase 9 Features

| Feature | Status | Notes |
|---------|--------|-------|
| Command renaming | **Done** | REVERT→REMOVE, BULK→BULK ADD, clearer naming |
| Ribbon icons | **Done** | History (Undo), Tags (Bulk Add to folder) |
| Obsidian Sync | **Compatible** | Works with plugin settings sync enabled |

**Phase 9 Goal:** Full functionality on mobile devices. ✓

---

## Marketplace Prep (v1.0.0) - COMPLETE

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 34 | Code review (Gemini issues) | **Done** | 7 issues addressed |
| 35 | Deep code review | **Done** | Additional issues found and fixed |
| 36 | Console log cleanup | **Done** | Removed 13 console.log statements |
| 37 | Bug fixes (invisible tags, protected tags) | **Done** | Validation and case-insensitivity |
| 38 | Throttling & debouncing | **Done** | UI freeze prevention, duplicate operation prevention |
| 39 | Timeout cleanup | **Done** | Proper onunload() lifecycle |
| 40 | Auto-tagging toggle | **Done** | Global enable/disable setting |
| 41 | README.md | **Done** | Comprehensive marketplace documentation |
| 42 | LICENSE | **Done** | MIT License |
| 43 | Version bump | **Done** | 1.0.0 in manifest.json and package.json |

**Marketplace Prep Goal:** Production-ready, documented, and polished for community submission. ✓

---

## Future Possibilities (Not Scheduled)

| Feature | Notes | Documentation |
|---------|-------|---------------|
| Rules Manager: Show folder names next to levels | Display actual folder names next to Level 1, Level 2, etc. in the rule editor | - |
| Full Tag Management Modal | Dedicated modal to drill into folders/files and add/remove/edit tags granularly | - |
| Grouped Move Modal Refinement | Improve visual hierarchy, spacing, readability | - |
| BulkPreviewModal File Tree | Collapsible folder tree instead of flat list | - |
| Folder Tag Preview | Preview tags before creating files | `docs/Feature Proposal - Folder Tag Preview.md` |
| Phase 7: Filename patterns | Regex/glob on filenames | - |
| Phase 7: Content-based rules | Search content for patterns | - |
| Phase 7: Template integration | Tags based on template origin | - |
| Tag suggestions | AI-powered tag recommendations | - |
| Graph view integration | Custom graph filtering presets | - |
| Tag cleanup command | Remove orphaned/unused tags | - |
| Import/export rules | Share configurations | - |
| Multi-vault sync | Share rules across vaults | - |

---

## Technical Debt / Known Issues

| Item | Priority | Status |
|------|----------|--------|
| ~~TFile type check~~ | ~~High~~ | **RESOLVED** - Changed to `instanceof TFile` |
| ~~Console log spam~~ | ~~Medium~~ | **RESOLVED** - Removed 13 console.log statements |
| ~~Invisible tags~~ | ~~High~~ | **RESOLVED** - Added validation in folderNameToTag |
| ~~Protected tags case sensitivity~~ | ~~Medium~~ | **RESOLVED** - Case-insensitive comparison |
| ~~UI freeze on bulk operations~~ | ~~High~~ | **RESOLVED** - Throttling every 50 files |
| ~~Timeout memory leaks~~ | ~~Medium~~ | **RESOLVED** - Proper cleanup in onunload |
| ~~File watcher duplicates~~ | ~~Medium~~ | **RESOLVED** - Debouncing with pendingFileOps |
| ~~Preview ignores depth~~ | ~~Medium~~ | **RESOLVED** - BulkPreviewModal respects inheritDepth |
| Text field occasionally unresponsive | Low | Rare, non-blocking, resolves on its own |

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
