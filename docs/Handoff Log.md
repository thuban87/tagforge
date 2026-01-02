# TagForge Handoff Log

**Last Updated:** January 2, 2025
**Current Phase:** Post-v1.0.0 - Planning Folder Rules System
**Current Branch:** feature-bulk-editing
**GitHub:** Initialized and connected
**Version:** 1.0.1
**Total Features Implemented:** 34 (across 9 phases) + marketplace prep + UI improvements + bulk edit mode

---

## Session: January 2, 2025 (Evening) - Folder Rules System Brainstorming

### Session Summary

Brainstorming session to design an explicit Folder Rules System. During testing, user discovered that bulk-add operations appeared to set "rules" on folders (new files inherited tags), but this was actually just the default algorithm recalculating. This led to unpredictable behavior and no way to manage folder-level tagging configuration.

**Key Decision:** Replace the implicit folder-name-to-tag algorithm with an explicit rules system. Tags are ONLY applied when explicit rules exist. No more "magic."

### What Was Decided

| Decision | Choice |
|----------|--------|
| Rules storage | `data.json` under `folderRules` |
| Default algorithm | **Removed** - only explicit rules apply tags |
| Rule behavior | Push-down from parents, additive stacking |
| Ancestor inheritance | Explicit per-rule (`inheritFromAncestors` boolean) |
| Nuclear option | Wipes `folderRules` too (update warning text) |
| Bulk add `inheritDepth` | Stays as bootstrapping tool for new rules |
| Rules UI | Dedicated modal via button in settings |

### Rule Data Model

```typescript
interface FolderRule {
  tags: string[];                      // Tags this rule applies
  applyDownLevels: 'all' | number[];   // 'all' or specific levels [1, 2, 4]
  inheritFromAncestors: boolean;       // Also receive tags from parent rules?
  applyToNewFiles: boolean;            // Trigger on file creation?
  createdAt: string;                   // ISO timestamp
  lastModified: string;                // ISO timestamp
}
```

### How Rules Work

**Push-down model:** Rules push tags DOWN to children based on `applyDownLevels`. They don't automatically pull UP from ancestors (controlled by `inheritFromAncestors`).

**Additive stacking:** Multiple rules can affect a file. Their tags combine. No "winner takes all."

**Level skipping:** `applyDownLevels: [1, 3, 4]` applies to levels 1, 3, 4 but skips level 2.

### UI Changes Planned

1. **Rules Management Modal** (new)
   - Accessed via `[Manage Folder Rules]` button in settings
   - Left panel: Folder tree with rule indicators
   - Right panel: Rule editor for selected folder
   - Shows warnings when parent rules also affect folder

2. **Bulk Add Modal Updates**
   - Add "Save as folder rule" checkbox
   - If checked: show level selection (this folder / subfolders / custom)
   - Clear explanation that this sets a rule, not just one-time operation

3. **Nuclear Option Update**
   - Also wipes `folderRules`
   - Update warning text to mention rule deletion

### Implementation Phases (When Ready)

1. Data model & core logic (`getRulesForPath()`)
2. Rules Management Modal
3. Bulk Add Modal integration
4. Remove legacy algorithm, cleanup

### Files Created

| File | Purpose |
|------|---------|
| docs/ADR-002-FolderRulesSystem.md | Full architecture decision record for rules system |

### Testing Issues That Led to This

- Nuclear option doesn't reset folder rules (because there weren't any stored)
- No way to view/manage rules on folders
- Bulk add doesn't indicate it's setting a rule
- Special tags don't persist for new files
- "New rule" didn't stick after remove + re-add (algorithm just recalculated)
- Need subfolder toggle (apply to this folder vs this + subfolders)

---

## Session: January 2, 2025 - Bulk Edit Mode & Bug Fixes

### Session Summary

Added edit mode to BulkPreviewModal allowing users to delete existing tags before applying new ones. Fixed X button folder cleanup (now uses fs.rmdirSync directly, bypassing Obsidian's stale cache). Fixed tracking property mismatch that caused auto-tags to appear as manual tags.

### What Was Accomplished

| Task | Status | Notes |
|------|--------|-------|
| Fix X button folder cleanup | **Done** | Uses fs.rmdirSync directly; Google Drive phantoms may persist until refresh |
| Add edit mode to BulkPreviewModal | **Done** | Full implementation with auto/manual tag distinction |
| Fix tracking property mismatch | **Done** | Was reading `tags` instead of `autoTags` |
| Add expand/collapse all buttons | **Done** | File tree now has Expand All / Collapse All |

### Edit Mode Feature (New)

**Flow:**
1. Normal mode: "Edit Existing Tags" button below file tree
2. Click to enter edit mode:
   - Right column controls greyed out
   - Auto-tags show as green chips with X buttons
   - Manual tags locked (grey chips, no X)
   - "Stop Editing" and "Edit Manual Tags" buttons appear
3. Click X on tag: Shows strikethrough (pending deletion)
4. Click X again: Removes from deletion list
5. "Edit Manual Tags": Enables editing manual tags (with warning)
6. Apply: Executes all additions AND deletions together

**Key Changes:**
- `EnhancedPreviewItem` now includes `autoTags: string[]`
- `BulkPreviewModal` has edit mode state: `isEditMode`, `allowManualTagEditing`, `tagsToDelete`
- `computeFinalResults()` returns `{ file, tagsToAdd, tagsToRemove }`
- `executeBulkApply()` handles both additions and removals
- New `removeTagsFromFile()` method respects protected tags and updates tracking

### Files Modified

| File | Changes |
|------|---------|
| main.ts | Edit mode state & UI; tracking property fix; removeTagsFromFile method; expand/collapse buttons |
| styles.css | Edit mode styles: tag chips, controls-disabled, warning text |
| docs/ADR Priority List.md | Updated item 48 status; added Full Tag Management Modal to future |

### New CSS Classes

| Class | Purpose |
|-------|---------|
| `.bbab-tf-edit-buttons` | Container for edit mode buttons |
| `.bbab-tf-tag-chips` | Container for editable tag chips |
| `.bbab-tf-tag-chip` | Individual tag chip |
| `.bbab-tf-tag-chip-auto` | Auto-tag styling (green) |
| `.bbab-tf-tag-chip-manual` | Manual tag styling (grey) |
| `.bbab-tf-tag-chip-delete` | Strikethrough for pending deletion |
| `.bbab-tf-tag-chip-locked` | Dimmed, non-editable |
| `.bbab-tf-controls-disabled` | Greyed out right column |

### Bug Fixes

1. **X button folder cleanup**: Changed from Obsidian API (`vault.delete`) to Node.js (`fs.rmdirSync`) to bypass stale cache
2. **Tracking property**: Was reading `tracking?.tags`, should be `tracking?.autoTags`
3. **removeTagsFromFile null safety**: Added check for `tracking.autoTags` existence
4. **Stats counter**: Now includes files with pending deletions

---

## Session: January 1, 2025 - Modal Redesign & Move Fixes

### Session Summary

Major UI improvements session. Resized all modals to settings-window size (90vw x 80vh, max 900px). Added 2-column layout to BulkPreviewModal (file tree left, controls right). Fixed grouped move modal close button not triggering cancel action (setTimeout fix). Added Windows system file cleanup (desktop.ini, Thumbs.db) for folder deletion on move cancel. Fixed folder cleanup with retry logic for ENOTEMPTY race conditions.

### What Was Accomplished

| Task | Status | Notes |
|------|--------|-------|
| Fix close button for grouped move modal | COMPLETE | setTimeout(0) defers callback until modal fully closed |
| Handle Windows system files (desktop.ini) | COMPLETE | Node fs module deletes before folder cleanup |
| Resize all modals to settings-window size | COMPLETE | 90vw x 80vh, max 900px, full-screen on mobile |
| Add 2-column layout to BulkPreviewModal | COMPLETE | File tree left, controls right, stacks on mobile |

### Bug: Close Button Still Not Cleaning Folders (REGRESSION)

**Symptom:** User tested move modal again at end of session. Cancel button works (folders deleted), but close button (X) leaves ghost folders behind.

**Previous Fix Applied:**
- `setTimeout(0)` in `onClose()` to defer callback until modal fully closed
- This matched the Cancel button behavior

**Current State:** Worked during earlier testing but failed at session end. Possibly timing-related or intermittent.

**To Investigate Next Session:**
1. Add debug logging back to trace flow
2. Check if setTimeout is actually firing
3. Compare exact execution order between Cancel button and X button
4. Consider increasing setTimeout delay (try 50ms instead of 0)

### Files Modified

| File | Changes |
|------|---------|
| main.ts | All modals now add `bbab-tf-large-modal` class; BulkPreviewModal restructured with 2-column layout; GroupedMoveConfirmationModal onClose uses setTimeout; Added fs/path requires for Windows file cleanup |
| styles.css | Large modal base styles; 2-column layout styles; Mobile responsiveness for new layout |
| esbuild.config.mjs | Added 'fs' and 'path' to externals for Node.js access |

### New CSS Classes

| Class | Purpose |
|-------|---------|
| `.bbab-tf-large-modal` | Applied to modalEl for settings-window sizing |
| `.bbab-tf-modal-header` | Header section (title + description) |
| `.bbab-tf-columns` | Flex container for 2-column layout |
| `.bbab-tf-column-left` | Left column (file tree, flex: 2) |
| `.bbab-tf-column-right` | Right column (controls, max-width: 280px) |
| `.bbab-tf-files-header` | Files section header with select buttons |

### Technical Details

**Modal Sizing:**
- Desktop: 90vw x 80vh (max 900px width)
- Mobile (<600px): 100% x 100% (full screen, no border-radius)

**2-Column Layout:**
- Left column: flex: 2, contains file tree
- Right column: flex: 1, min 220px, max 280px
- Mobile: Stacks vertically, left column max-height 50vh

**Windows System File Cleanup:**
```typescript
const WINDOWS_SYSTEM_FILES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

// Uses Node.js fs module to see hidden files Obsidian API filters out
const fs = require('fs');
const nodePath = require('path');

// Before deleting folder, check for and remove only safe system files
```

**Close Button Fix (applied but may need revisiting):**
```typescript
onClose() {
    contentEl.empty();
    if (!this.resultSent) {
        setTimeout(() => {
            this.onResult({ action: 'cancel', ... });
        }, 0);
    }
}
```

---

## Previous Session: December 30, 2024 - Marketplace Prep & Code Review

*See archived sessions below for full details.*

---

## Current Plugin Commands

| Command | Description |
|---------|-------------|
| TAG: Manually tag current file | Manual single-file tagging |
| REMOVE: Remove all auto-applied tags | Undo tracked auto-tags |
| REMOVE: Remove ALL tags from vault (nuclear) | Clear all tags everywhere |
| REMOVE: Remove auto-tags by date | Date picker for selective removal |
| REMOVE: Remove auto-tags from specific folder | Folder picker for selective removal |
| BULK ADD: Apply tags to entire vault (with preview) | Full vault tagging |
| BULK ADD: Apply tags to specific folder (with preview) | Folder-based tagging |
| UNDO: Undo a recent tag operation | History picker to undo operations |
| REPORT: View tag report dashboard | See all TagForge and manual tags |
| VALIDATE: Check for tag issues | Find and fix tracking problems |

## Ribbon Icons (Mobile Menu)

| Icon | Action | Description |
|------|--------|-------------|
| History | TagForge: Undo | Opens undo history modal |
| Tags | TagForge: Bulk Add to folder | Opens folder picker for bulk add |

---

## Next Session Prompt

```
TagForge - v1.0.1 → Folder Rules System Implementation

**Directory:** C:\Users\bwales\projects\obsidian-plugins\tagforge\
**Deploy to:** G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\tagforge\
**Current branch:** feature-bulk-editing
**Version:** 1.0.1

**Docs:**
- docs\Handoff Log.md - START HERE for full context
- docs\ADR-001-Architecture.md - Core architecture
- docs\ADR-002-FolderRulesSystem.md - NEW: Full rules system design
- docs\ADR Priority List - TagForge.md

**Last Session:** Brainstorming for Folder Rules System (ADR-002 written)

**MAJOR FEATURE: Explicit Folder Rules System**

Replace the implicit folder-name-to-tag algorithm with explicit rules.
Tags only apply when rules exist. No more magic.

**Implementation Phases:**

Phase 1: Data Model & Core Logic
- Add `folderRules: Record<string, FolderRule>` to settings
- Create `getRulesForPath()` function (replaces getTagsForPath logic)
- Update file creation watcher to use new function
- Update nuclear option to wipe folderRules

Phase 2: Rules Management Modal
- New modal accessed via button in settings
- Left panel: folder tree with rule indicators
- Right panel: rule editor (tags, levels, inheritance, apply to new files)
- Parent rule warnings

Phase 3: Bulk Add Modal Integration
- Add "Save as folder rule" checkbox
- Level selection (this folder / subfolders / custom levels)
- Explanatory text about setting rules vs one-time operations

Phase 4: Cleanup
- Remove legacy getTagsForPath() algorithm
- Update documentation
- Testing

**Key Data Model:**
```typescript
interface FolderRule {
  tags: string[];
  applyDownLevels: 'all' | number[];
  inheritFromAncestors: boolean;
  applyToNewFiles: boolean;
  createdAt: string;
  lastModified: string;
}
```

**Build & Deploy:**
npm run build → Reload Obsidian

**esbuild externals:** 'obsidian', 'fs', 'path'
```

---

## Quick Reference

### Development Commands
```bash
cd C:\Users\bwales\projects\obsidian-plugins\tagforge
npm run build                    # Production build
npm run dev                      # Watch mode
```

### Required Files in Deploy Directory
- `manifest.json` (REQUIRED)
- `main.js` (REQUIRED)
- `styles.css` (auto-copied by build)
- `data.json` (auto-created by Obsidian)

### Reload Plugin
Ctrl+P → "Reload app without saving" OR toggle plugin off/on

---

## Archived Sessions

### December 30, 2024 - Marketplace Prep & Code Review
Comprehensive code review for Obsidian Community Marketplace submission. Addressed 7 issues identified by Gemini plus additional issues. Added global auto-tagging toggle. Removed incomplete inline tags feature. Created README.md and LICENSE. Version 1.0.0.

### December 30, 2024 - Phase 9 Complete
Mobile optimization. Responsive CSS, 44px touch targets, command renaming, ribbon icons.

### December 30, 2024 - Phase 8 Complete
Operation history (50 ops), undo functionality, tag report dashboard, validation warnings.

### December 30, 2024 - Phase 6 Complete
Move handling with confirmation modal, remember choice option, cancel undo.

### December 30, 2024 - Phases 1-5 Complete
Foundation, auto-watch, bulk operations, hierarchical inheritance.
