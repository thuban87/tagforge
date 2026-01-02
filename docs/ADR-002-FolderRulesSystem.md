# ADR-002: Folder Rules System

**Status:** Proposed
**Date:** January 2, 2025
**Last Updated:** January 2, 2025

---

## Context

During testing of TagForge v1.0.1, several issues emerged around how folder-based tagging behaves:

1. After bulk-tagging a folder, new files added to that folder inherit tags - but this is via the default algorithm recalculating, not a stored "rule"
2. Users cannot view or manage what tagging behavior is set on each folder
3. The nuclear option doesn't reset any folder-level configuration
4. When users customize tag selections during bulk add (e.g., skipping certain levels, adding special tags), those choices don't persist for future files
5. Moving files into folders applies the default algorithm, not any custom configuration the user set up

The current system uses an implicit algorithm that calculates tags from folder names at runtime. This creates unpredictable behavior - users think they're setting up rules, but they're just doing one-time operations while the algorithm continues running independently.

---

## Decision

### Replace Implicit Algorithm with Explicit Folder Rules

**Core Change:** Remove the default folder-name-to-tag algorithm. Tags are ONLY applied when explicit rules exist.

**Behavior:**
- New file created → Check for applicable folder rules → Apply if found → If no rules, do nothing
- No more "magic" tag generation from folder names
- Users have complete control over what gets tagged and how

---

## Rule System Design

### 1. Rule Storage

Rules stored in `data.json` under `folderRules`:

```json
{
  "tagTracking": { ... },
  "operationHistory": [ ... ],
  "folderRules": {
    "/Projects": {
      "tags": ["projects"],
      "applyDownLevels": [1, 2],
      "inheritFromAncestors": false,
      "applyToNewFiles": true,
      "createdAt": "2025-01-02T10:00:00Z",
      "lastModified": "2025-01-02T10:00:00Z"
    },
    "/Projects/ClientA": {
      "tags": ["clienta", "active"],
      "applyDownLevels": "all",
      "inheritFromAncestors": true,
      "applyToNewFiles": true,
      "createdAt": "2025-01-02T10:00:00Z",
      "lastModified": "2025-01-02T10:00:00Z"
    }
  }
}
```

### 2. Rule Data Model

```typescript
interface FolderRule {
  tags: string[];                      // Tags this rule directly applies
  applyDownLevels: 'all' | number[];   // 'all' or specific levels [1, 2, 4]
  inheritFromAncestors: boolean;       // Also receive tags from parent rules?
  applyToNewFiles: boolean;            // Trigger on file creation?
  createdAt: string;                   // ISO timestamp
  lastModified: string;                // ISO timestamp
}

// Settings addition
interface TagForgeSettings {
  // ... existing settings ...
  folderRules: Record<string, FolderRule>;
}
```

### 3. Rule Behavior: Push-Down Model

Rules "push down" from parent folders to children. They do NOT "pull up" from ancestors automatically.

**Example:**
```
/Projects (rule: tags=["projects"], applyDownLevels=[1,2])
  └─ ClientA (rule: tags=["clienta"], applyDownLevels="all", inheritFromAncestors=true)
       └─ Docs (no rule)
            └─ file.md
```

**Tags applied to file.md:**
1. From `/Projects` rule: `["projects"]` (reaches 2 levels down, Docs is level 2)
2. From `/Projects/ClientA` rule: `["clienta"]` (reaches all subfolders)
3. ClientA has `inheritFromAncestors: true`, so it also gets Projects' tags

**Result:** `["projects", "clienta"]`

### 4. Level Skipping

Rules can apply to specific levels, skipping others:

```json
{
  "/Projects": {
    "tags": ["projects"],
    "applyDownLevels": [1, 3, 4]  // Skip level 2
  }
}
```

This allows fine-grained control. Level 2 folders can have their own independent rules.

### 5. Conflict Resolution

**No conflicts exist** - rules are purely additive. If you're getting unwanted tags:
- Modify the parent rule's `applyDownLevels` to not reach that folder
- Or skip specific levels

The UI will show warnings when a folder is affected by multiple rules, so users can make informed decisions.

---

## UI Changes

### 1. Rules Management Modal

New dedicated modal accessible from Settings via `[Manage Folder Rules]` button.

**Layout:**
- Left panel: Folder tree (collapsible, shows rule indicators)
- Right panel: Rule editor for selected folder

**Rule Editor Shows:**
- Tags to apply (editable tag list)
- Apply to levels selector (this folder only / all subfolders / custom levels)
- Inherit from ancestors toggle
- Apply to new files toggle
- Buttons: Apply to existing files, Delete Rule
- Warning: Shows parent rules that also affect this folder

### 2. Bulk Add Modal Updates

Add to existing Bulk Add modal:

**New Controls:**
- Checkbox: "Save as folder rule (applies to new files)"
- If checked, show:
  - Radio: This folder only / This folder + subfolders / Custom levels
- Explanatory text clarifying this sets a rule, not just a one-time operation

**Behavior:**
- If "Save as rule" unchecked: One-time tag application only
- If "Save as rule" checked: Tags applied AND rule saved to `folderRules`

### 3. Settings Updates

Add to settings page:
- Button: `[Manage Folder Rules]` - Opens Rules Management Modal
- Info text explaining the rules system

---

## Migration Path

### Removing the Default Algorithm

**Current behavior (`getTagsForPath()`):**
1. Walk folder ancestry
2. Convert folder names to tags
3. Apply up to `inheritDepth` levels

**New behavior (`getRulesForPath()`):**
1. Find all rules that apply to the file's path
2. Stack applicable rules (respecting `applyDownLevels` and `inheritFromAncestors`)
3. Return combined tag set
4. If no rules apply, return empty set

**No migration needed** - plugin is unreleased. Existing `inheritDepth` setting becomes a convenience for the Bulk Add modal (suggests default levels when creating new rules).

---

## Nuclear Option Update

**Current:** Removes all tags and tracking data

**Updated:** Also wipes `folderRules`

**Warning text update:**
```
WARNING: This will remove ALL tags from ALL files in your vault,
clear all TagForge tracking data, AND delete all folder rules.
This cannot be undone. Are you sure?
```

---

## Implementation Phases

### Phase 1: Data Model & Core Logic
- Add `folderRules` to settings/data model
- Create `getRulesForPath()` function
- Update file creation watcher to use new function
- Update nuclear option to wipe rules

### Phase 2: Rules Management Modal
- Create folder tree component
- Create rule editor component
- Wire up save/delete functionality
- Add parent rule warnings

### Phase 3: Bulk Add Modal Integration
- Add "Save as rule" checkbox
- Add level selection controls
- Update apply logic to optionally save rules

### Phase 4: Cleanup
- Remove legacy `getTagsForPath()` algorithm
- Update documentation
- Testing across various folder structures

---

## Consequences

### Positive
- **Predictable:** No magic, only explicit rules apply tags
- **Transparent:** Users can see exactly what rules exist on each folder
- **Flexible:** Custom levels, special tags, inheritance control
- **Debuggable:** "Why doesn't this file have tags?" → "No rule set"

### Negative
- **More setup:** Users must create rules to get any auto-tagging
- **Learning curve:** Concept of "rules" vs "one-time operations" may need explanation
- **Complexity:** Rule editor UI is more complex than current simple settings

### Trade-offs Accepted
- Losing "works out of the box" simplicity in favor of explicit control
- Adding UI complexity in exchange for transparency
- Requiring user intent for every automatic behavior

---

## Related Decisions

- **ADR-001:** Core Architecture (tag tracking, frontmatter storage)
- **Phase 7 (future):** Filename patterns, content rules, template rules - these would become additional rule types alongside folder rules

---

## Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Where to store rules? | `data.json` under `folderRules` |
| Implicit vs explicit inheritance? | Explicit - each rule specifies `inheritFromAncestors` |
| What happens with no rules? | Nothing - no tags applied |
| Nuclear option behavior? | Wipes rules too |
| Migration for existing users? | Not needed - unreleased plugin |
