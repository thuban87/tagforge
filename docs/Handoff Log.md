# TagForge Handoff Log

**Last Updated:** December 30, 2024
**Current Phase:** Phase 6 COMPLETE - Ready for Phase 7
**Current Branch:** main (user to create phase-6-move-handling branch)
**GitHub:** Initialized and connected
**Total Features Planned:** 33 (across 9 phases)

---

## Session: December 30, 2024 - Phase 6 Complete

### Session Summary

Implemented file move handling with confirmation modal. When files are moved between folders, users can choose to retag (apply new folder-based tags), leave tags unchanged, or cancel (undo the move). Added "Remember my choice" option for streamlined batch moves. Settings UI uses a single dropdown with three options: Ask every time (default), Always retag, Always keep current tags. Fixed Cancel loop bug with pendingUndoPath flag.

### What Was Accomplished

| Phase | Status | Notes |
|-------|--------|-------|
| 6 | COMPLETE | Move handling with confirmation modal + remember choice |

---

## Phase 6: Move Handling - COMPLETE

### Features Implemented

**Move Detection:**
- `vault.on('rename')` event handler (wrapped in `onLayoutReady`)
- Detects folder changes vs simple renames (only triggers when parent folder changes)
- Only triggers for `.md` files
- Respects ignored paths
- `pendingUndoPath` flag prevents modal loop when Cancel undoes a move

**Move Confirmation Modal:**
- Shows old folder → new folder paths
- Clear explanation of each option with bullet list
- Three actions:
  - **Continue** - Remove old auto-tags, apply new folder-based tags
  - **Leave Tags** - Keep current tags, don't add new ones
  - **Cancel** - Move file back to original location (undo)
- "Remember my choice" checkbox (for Continue/Leave only)

**Settings Integration:**
- Single dropdown "When files are moved" with three options:
  - **Ask every time** (default) - Shows modal on each move
  - **Always retag** - Silently removes old tags, applies new tags
  - **Always keep current tags** - Silently preserves existing tags
- Dropdown syncs with "Remember my choice" selection from modal

**Tag Management:**
- `removeAutoTagsFromFile()` - Removes only tracked auto-tags
- Respects protected tags (never removed)
- Updates tag tracking on path changes (including simple renames)

### New Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| showMoveConfirmation | boolean | true | Controls whether modal appears |
| rememberedMoveAction | 'continue' \| 'leave' \| null | null | Stored remembered choice |

### Files Modified

| File | Changes |
|------|---------|
| `main.ts` | Added `rememberedMoveAction` setting, `pendingUndoPath` property, `MoveConfirmationModal`, `handleFileRename`, `handleMoveResult`, `applyMoveRetag`, `removeAutoTagsFromFile`, `getParentFolder`, dropdown settings UI |
| `styles.css` | Added move modal styles, options list styles |

---

## Previous Session: December 30, 2024 - Phases 1-5 Complete

### Session Summary

Massive progress session. Fixed Phase 1 bug, implemented Phase 2 auto-watch (with safety fixes after mass-tagging incident), added comprehensive revert commands, built full Phase 3 bulk operations with enhanced preview modal, and completed Phase 5 hierarchical inheritance features. Phase 4 was absorbed into Phase 3's enhanced preview modal.

### What Was Accomplished

| Phase | Status | Notes |
|-------|--------|-------|
| 1 | COMPLETE | Bug fixed, esbuild deploys directly |
| 2 | COMPLETE | Auto-watch with onLayoutReady guard |
| 2.5 | COMPLETE | Enhanced revert commands (bonus) |
| 3 | COMPLETE | Bulk ops + enhanced preview modal |
| 4 | ABSORBED | Merged into Phase 3 preview modal |
| 5 | COMPLETE | Folder aliases UI + multi-tag support |

---

## Phase 1: Foundation - COMPLETE

### Bug Fix
- **Problem:** `file.constructor.name !== 'TFile'` fails in minified production builds
- **Solution:** Changed to `!(file instanceof TFile)` in 3 locations
- **Files modified:** `main.ts` lines 185, 208, 229

### Build Configuration
- Updated `esbuild.config.mjs` to output directly to deploy directory:
  ```javascript
  outfile: "G:/My Drive/IT/Obsidian Vault/My Notebooks/.obsidian/plugins/tagforge/main.js"
  ```

### Settings UI Change
- Changed `inheritDepth` from slider to number input (no max limit)

---

## Phase 2: Auto-Watch - COMPLETE

### File Create Watcher
- Added `vault.on('create')` event listener
- Only processes `.md` files
- Respects ignored paths setting

### Critical Safety Fix
**INCIDENT:** Plugin mass-tagged entire vault on enable because Obsidian fires `create` events during initial vault indexing.

**SOLUTION:** Wrapped watcher registration in `onLayoutReady()`:
```typescript
this.app.workspace.onLayoutReady(() => {
    this.registerEvent(
        this.app.vault.on('create', (file) => { ... })
    );
});
```

### New Method
- `handleFileCreate(file: TFile)` - Processes new files, logs to console

---

## Phase 2.5: Enhanced Revert Commands - COMPLETE

Added three revert commands for safety and recovery:

### 1. Revert All Auto-Tags
- Command: `REVERT: Remove all auto-applied tags`
- Removes only tags tracked in `tagTracking`
- Preserves manually-added tags
- Clears tracking data after revert

### 2. Nuclear Revert
- Command: `REVERT: Remove ALL tags from vault (nuclear option)`
- Double-confirmation required
- Removes ALL tags from ALL markdown files
- Use case: Starting completely fresh

### 3. Date-Filtered Revert
- Command: `REVERT: Remove auto-tags by date`
- Opens `DatePickerModal` showing dates with file counts
- Checkboxes for each date
- Select All / Select None buttons
- Only reverts files from selected dates

---

## Phase 3: Bulk & Selective Push - COMPLETE

### Commands Added
1. `BULK: Apply tags to entire vault (with preview)`
2. `BULK: Apply tags to specific folder (with preview)`

### Enhanced Preview Modal (BulkPreviewModal)

Complete rewrite with advanced features:

**Folder Tags Section:**
- Level toggles: Checkbox for each folder depth level
- "Skip all folder tags" option
- Dynamically shows only levels present in selected files

**Additional Tags Section:**
- Text input for comma-separated tags
- Auto-formats tags (lowercase, hyphens)
- Radio buttons: Apply to "All files" or "Selected only"

**Files Section:**
- Stats: "Files (X total, Y selected, Z with changes)"
- Select All / Select None buttons
- Scrollable list with checkboxes per file
- Shows current tags, tags to add (color-coded)
- "(no changes)" indicator for files already tagged
- **Scroll position preserved** when toggling checkboxes

**Apply Button:**
- Dynamic text: "Apply to X files"
- Disabled when no changes to apply

### Folder Picker Modal (FolderPickerModal)
- Searchable folder list
- **Include subdirectories** checkbox (checked by default)
- When unchecked, only processes direct children

### Technical Details
- `generateEnhancedPreview()` - Creates preview items with tags by level
- `getFolderTagsByLevel()` - Returns tags at each folder depth
- `executeBulkApply()` - Applies tags from computed results
- Backward compatible with old alias format

---

## Phase 4: One-Time Batch Tagger - ABSORBED

Phase 4 features were absorbed into Phase 3's enhanced preview modal:
- File selection checkboxes = batch selection
- Additional tags input = arbitrary tag application
- "Selected only" option = targeted tagging

No separate Phase 4 implementation needed.

---

## Phase 5: Hierarchical Inheritance - COMPLETE

### Folder Aliases UI
Added to Settings tab with:
- List of existing aliases with remove buttons
- Add form: folder path input + tags input
- Displays as: `Personal/Projects → #my-projects, #work`

### Multi-Tag Aliases
- Changed `folderAliases` type from `Record<string, string>` to `Record<string, string[]>`
- Comma-separated input: `dating, relationships, love-life`
- Backward compatible with old single-string format
- Updated `getTagsForPath()` and `getFolderTagsByLevel()` to handle arrays

### Include Subdirectories Option
- Checkbox in folder picker modal
- Checked by default (include subdirs)
- When unchecked, only direct children of selected folder

---

## Files Modified This Session

| File | Changes |
|------|---------|
| `main.ts` | Bug fixes, auto-watch, revert commands, bulk ops, modals, aliases UI |
| `styles.css` | Modal styles, date picker, bulk preview, folder picker, aliases |
| `esbuild.config.mjs` | Deploy path updated |
| `.gitignore` | Created for git repo |

---

## Current Plugin Commands

| Command | Description |
|---------|-------------|
| Tag current file based on folder | Manual single-file tagging |
| REVERT: Remove all auto-applied tags | Undo tracked auto-tags |
| REVERT: Remove ALL tags from vault (nuclear) | Clear all tags everywhere |
| REVERT: Remove auto-tags by date | Date picker for selective revert |
| BULK: Apply tags to entire vault (with preview) | Full vault tagging |
| BULK: Apply tags to specific folder (with preview) | Folder-based tagging |

---

## Current Settings

| Setting | Type | Description |
|---------|------|-------------|
| Inheritance depth | number | Folder levels to inherit (no max) |
| Tag format | dropdown | frontmatter or inline |
| Show move confirmation | toggle | Prompt on file move (Phase 6) |
| Ignored folders | textarea | Paths to skip |
| Protected tags | textarea | Tags to never touch |
| Folder aliases | UI list | Custom folder→tags mappings |

---

## Technical Notes

### Tag Application Method
Uses `app.fileManager.processFrontMatter()` - Obsidian's official API for safe YAML manipulation. This is why it works reliably vs. raw text manipulation.

### Tag Tracking
All auto-applied tags stored in `data.json` under `tagTracking`:
```json
{
  "tagTracking": {
    "path/to/file.md": {
      "autoTags": ["tag1", "tag2"],
      "lastUpdated": "2024-12-30T18:57:35.529Z"
    }
  }
}
```

### Deploy Workflow
1. Edit files in `C:\Users\bwales\projects\obsidian-plugins\tagforge\`
2. Run `npm run build`
3. `main.js` auto-deploys to Google Drive vault
4. Manually copy `styles.css` to deploy dir
5. Reload Obsidian

---

## Git Status

- **Repo initialized:** Yes
- **GitHub connected:** Yes
- **Branch strategy:** Phase branches, merge after each phase
- **Current branch:** `main` (user to create phase branch as needed)
- **Commits:** User handles all git operations

---

## Remaining Phases

| Phase | Focus | Priority |
|-------|-------|----------|
| 6 | Move Handling | COMPLETE |
| 7 | Advanced Rules | Content, filename, template |
| 8 | Polish & UX | Undo, reports, validation |
| 9 | Mobile Optimization | User requested |

### Phase 7: Advanced Rules (Future - user noted this needs more planning)
- Filename pattern rules (regex/glob) - requires opt-in setting
- Content-based rules (search patterns)
- Template integration

### Phase 8: Polish & UX
- Undo/history
- Tag report dashboard
- Validation warnings

### Phase 9: Mobile Optimization (User Request)
- Responsive CSS for all modals
- Touch-friendly UI elements
- Test on Obsidian mobile

---

## Lessons Learned This Session

1. **onLayoutReady is critical** - Always wrap vault event listeners to prevent firing during initial load
2. **Obsidian's processFrontMatter** - The correct way to modify YAML, handles all edge cases
3. **Preserve scroll position** - Store and restore scrollTop when re-rendering dynamic lists
4. **Modal width in Obsidian** - Target `.modal-content` for sizing, not the outer container
5. **Backward compatibility** - Handle both old and new data formats when changing settings structure
6. **Undo move via vault.rename()** - Can programmatically move files back to original path
7. **Prevent event loops** - When programmatically triggering events (like rename), use a flag to skip the resulting event handler
8. **Test before documenting** - Don't update docs until testing is complete and all bugs are fixed
9. **Deploy styles.css** - Copy to deploy directory after build (esbuild only handles main.js)

---

## Next Session Prompt

```
Phase 8: Polish & UX

**Directory:** C:\Users\bwales\projects\obsidian-plugins\tagforge\
**Deploy to:** G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\tagforge\
**Current branch:** main (create new branch for next phase)

**Context:**
- Phases 1-6 COMPLETE
- Plugin has: auto-watch on create/move, bulk tagging with preview, folder aliases, move handling with dropdown settings
- Git repo initialized, user handles all git commands

**Phase 8 Features (from ADR Priority List):**
- Undo/history - ability to undo recent tag operations
- Tag report dashboard - view all tags applied by TagForge
- Validation warnings - alert user to potential issues

**Important:**
- User handles all git commands - don't run git commands
- Pause after phase completion for user to commit
- Copy styles.css to deploy directory after build
- Test thoroughly before updating docs
```

---

## Quick Reference

### Development Commands
```bash
cd C:\Users\bwales\projects\obsidian-plugins\tagforge
npm run build                    # Production build
npm run dev                      # Watch mode
```

### Deploy After Build
```bash
cp styles.css "G:/My Drive/IT/Obsidian Vault/My Notebooks/.obsidian/plugins/tagforge/"
```

### Required Files in Deploy Directory
- `manifest.json` (REQUIRED)
- `main.js` (REQUIRED)
- `styles.css` (optional but needed for styling)
- `data.json` (auto-created by Obsidian)

### Reload Plugin
Ctrl+P → "Reload app without saving" OR toggle plugin off/on

---

## Archived Sessions

### Planning & Documentation Session
Initial planning, architecture decisions, documentation creation. See above for details.

### Phase 1 Foundation Build Session
Initial scaffold, settings infrastructure. Had TFile bug. See above for details.
