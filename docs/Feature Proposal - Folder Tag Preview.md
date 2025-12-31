# Feature Proposal: Folder → Tags Preview

**Status:** Proposed (Deferred to post-1.0.0)
**Date:** December 30, 2024
**Priority:** Enhancement

---

## Summary

Add a visual preview system that shows users what tags would be applied to files in a given folder BEFORE any tagging operation occurs. This helps users understand their tag inheritance configuration and folder alias setup.

---

## Problem Statement

Currently, users must:
1. Create or move a file into a folder
2. Wait for auto-tagging to occur
3. Check the file's frontmatter to see what tags were applied

This trial-and-error approach makes it difficult to:
- Verify folder alias configuration is correct
- Understand inheritance depth effects
- Debug why unexpected tags appear (or don't appear)

---

## Proposed Solution

### Option A: Hover Preview (Recommended)

Add a hover tooltip in the file explorer that shows:
- What tags would be applied to files in that folder
- Which tags come from which ancestor (visual hierarchy)
- Whether any aliases are active

**Example Hover:**
```
📁 Health/Therapy/Session Notes

Tags for new files:
  → health (from Health/)
  → therapy (from Therapy/)
  → session-notes (from Session Notes/)
  → therapy-notes (alias)

Depth: 3 levels
```

**Implementation Notes:**
- Use Obsidian's `setHoverElement` or custom tooltip
- Calculate tags on hover (don't cache - respects current settings)
- Show inheritance chain clearly

### Option B: Command-Based Preview

Add a new command: `PREVIEW: Show tags for folder`
- Opens a modal with folder picker
- Shows tag preview for selected folder
- Allows testing different inheritance depths

**Pros:** Simpler implementation, no hover handling
**Cons:** More friction, less discoverable

### Option C: Settings Panel Preview

Add "Test Your Settings" section in settings tab:
- Text input for folder path
- Shows what tags would apply
- Updates live as user types

**Pros:** Natural place for configuration testing
**Cons:** Requires switching to settings

---

## Recommended Approach

Implement Option A (Hover Preview) as primary, with Option B (Command) as fallback for mobile (where hover doesn't work well).

---

## Technical Considerations

### Hover Implementation

```typescript
// Register file-explorer-label decorator
this.registerEvent(
  this.app.workspace.on('file-menu', (menu, file) => {
    if (file instanceof TFolder) {
      // Add menu item showing tag preview
    }
  })
);

// Or use monkey-patching for hover
// (may need to hook into file explorer view)
```

### Performance

- Tag calculation is already fast (getTagsForPath)
- Only calculate on hover (not pre-computed)
- Small visual footprint

### Mobile Considerations

- Hover doesn't work on touch devices
- Use long-press gesture OR
- Rely on command palette command

---

## UI Mockup

```
┌─────────────────────────────────────┐
│ 📁 Health/Therapy/Session Notes     │
├─────────────────────────────────────┤
│ Tags applied to files here:         │
│                                     │
│ • health        (from Health/)      │
│ • therapy       (from Therapy/)     │
│ • session-notes (from this folder)  │
│                                     │
│ Inheritance depth: 3                │
│ Aliases active: none                │
└─────────────────────────────────────┘
```

---

## Acceptance Criteria

1. User can see what tags would apply to a folder without creating a file
2. Shows inheritance chain (which tag from which folder)
3. Indicates if aliases are in effect
4. Works on desktop (hover) and mobile (command/long-press)
5. Respects current settings (depth, aliases, ignored paths)
6. Clearly indicates if folder is in ignored path

---

## Out of Scope (v1)

- Editing aliases from the preview
- Drag-and-drop tag reordering
- "Apply these tags now" action from preview
- Historical tag analytics

---

## Dependencies

- Requires stable folder alias system (Phase 5 - complete)
- Requires inheritance depth system (Phase 5 - complete)
- May need Obsidian API research for file explorer hooks

---

## Estimated Effort

- Option A (Hover): Medium complexity - Obsidian file explorer API research needed
- Option B (Command): Low complexity - Modal with folder picker already exists
- Option C (Settings): Low complexity - Can reuse existing settings patterns

Recommended: Start with Option B (command-based) for quick win, add Option A (hover) if file explorer hooks are feasible.

---

## Related Files

Files that would be modified:
- `main.ts` - New command and preview logic
- `styles.css` - Tooltip/preview styling

Existing code to reuse:
- `getTagsForPath()` - Core tag calculation
- `FolderPickerModal` - Folder selection
- `folderAliases` settings - Alias data

---

## Next Session Prompt

```
TagForge - Folder Tag Preview Feature

**Context:** User requested a feature to preview what tags would be applied
to files in a folder BEFORE creating files. This helps verify configuration.

**Documentation:** See docs/Feature Proposal - Folder Tag Preview.md

**Recommended approach:**
1. Start with command-based preview (simpler, works on mobile)
   - New command: "PREVIEW: Show tags for folder"
   - Reuse FolderPickerModal for folder selection
   - Show modal with tag breakdown and inheritance chain

2. Research Obsidian file explorer hooks for hover preview
   - Check if `setHoverElement` or similar API exists
   - May need monkey-patching approach

**Files to modify:**
- main.ts (add command, preview modal class)
- styles.css (preview styling)

**Key existing code:**
- getTagsForPath(filePath) - Already calculates inheritance
- FolderPickerModal - Can reuse for folder selection
- folderAliases setting - Need to show which are active
```
