# ADR-001: TagForge Core Architecture

**Status:** Accepted (Updated for v1.0.0)
**Date:** December 30, 2024
**Last Updated:** December 30, 2024

---

## Context

Building an Obsidian plugin for automatic tag management. The plugin needs to:
1. Watch for file changes and apply tags automatically
2. Track which tags it applied vs user-added tags
3. Support hierarchical folder-to-tag inheritance
4. Handle file moves gracefully
5. Provide batch tagging for retroactive organization

---

## Decisions

### 1. Tag Format: Flat Tags

**Decision:** Use flat tags (`#health`, `#therapy`) not nested tags (`#area/health`).

**Rationale:**
- Better graph view filtering (each tag is distinct color)
- Simpler mental model
- Hierarchical relationship still exists via folder inheritance
- Searching parent folder tag still finds all descendants (via folder rules, not tag nesting)

**Trade-off:** Lose Obsidian's built-in nested tag search (`#parent` matching `#parent/child`). Acceptable because folder inheritance provides similar capability.

---

### 2. Tag Storage: Frontmatter Only

**Decision:** Store tags in YAML frontmatter only. (Inline tags feature was removed in v1.0.0)

**Rationale:**
- Frontmatter is standard and widely compatible
- Easier to programmatically read/write
- Clean separation from note content
- Simpler implementation - removed incomplete inline tags feature for v1.0.0

**Format:**
```yaml
---
tags:
  - health
  - therapy
  - important
---
```

---

### 3. Tag Tracking: Internal Plugin Database

**Decision:** Maintain internal record of auto-applied tags in plugin data storage.

**Rationale:**
- Allows removing only auto-tags when files move (preserve manual tags)
- Invisible to user (frontmatter stays clean)
- Enables rule change propagation
- Supports undo functionality

**Storage Location:** `.obsidian/plugins/tagforge/data.json`

**Structure:**
```json
{
  "tagTracking": {
    "path/to/file.md": {
      "autoTags": ["health", "therapy"],
      "lastUpdated": "2024-12-30T10:00:00Z"
    }
  },
  "settings": { ... }
}
```

**Trade-off:** If user manually adds a tag that matches an auto-tag rule, plugin may later remove it thinking it's an auto-tag. Mitigated by:
- Protected tags feature (user-specified tags to never touch)
- Only removing tags that are in the tracking record AND no longer match rules

---

### 4. File Watching: Obsidian Vault Events

**Decision:** Use Obsidian's `vault.on('create')` and `vault.on('rename')` events.

**Rationale:**
- Native API, reliable
- Handles both new files and moves (rename includes path changes)
- Works on desktop and mobile

**Events to watch:**
- `create` - New file added
- `rename` - File moved or renamed (path changed)
- `modify` - For content-based rules (optional, may be performance concern)

---

### 5. Rule Engine: Layered Approach

**Decision:** Support multiple rule types with clear priority order.

**Rule Types (in priority order):**
1. **Ignore rules** - Folders/patterns to skip entirely
2. **Folder inheritance** - Auto-tags from folder ancestry
3. **Folder mappings** - Explicit folder-to-tag overrides
4. **Filename patterns** - Regex on filename
5. **Content rules** - Search within file content
6. **Template rules** - Based on template origin

**Rationale:** Layered approach allows simple cases (just folder inheritance) while enabling complex configurations.

---

### 6. Move Handling: Post-Move Confirmation

**Decision:** Detect moves after they occur and prompt for confirmation.

**Rationale:**
- Obsidian API doesn't support intercepting moves before they happen
- Post-move prompt still provides safety net
- Undo option returns file to original location with original tags

**Flow:**
1. File moved (detected via `rename` event with path change)
2. Modal appears: "File moved. Update tags?"
3. Options: Yes / No / Undo Move
4. If undo: restore file path and tags

---

### 7. Configuration Format: Structured Settings

**Decision:** Use structured settings object, not plain text configuration.

**Rationale:**
- Better UX than text parsing
- Enables visual settings UI
- Type safety in TypeScript
- Easier validation

**Settings Structure:**
```typescript
interface TagForgeSettings {
  // Core Settings
  autoTagEnabled: boolean;        // Enable/disable automatic tagging (v1.0.0)
  inheritDepth: number;           // How many folder levels to inherit
  showMoveConfirmation: boolean;
  rememberedMoveAction: 'continue' | 'leave' | null;

  // Folder Configuration
  folderAliases: {
    folder: string;               // folder path
    tags: string[];               // tags to apply
  }[];

  // Exclusions
  ignorePaths: string[];          // Paths to skip
  protectedTags: string[];        // Never touch these tags

  // Future (Phase 7)
  contentRules: {
    pattern: string;              // Regex or string
    tags: string[];
  }[];

  filenameRules: {
    pattern: string;              // Glob or regex
    tags: string[];
  }[];
}
```

---

### 8. CSS Naming: bbab-tf- Prefix

**Decision:** All CSS classes prefixed with `bbab-tf-`.

**Rationale:**
- Avoids conflicts with Obsidian core styles
- Avoids conflicts with other plugins
- Consistent with developer's existing conventions (BBAB = Brad's Bits and Bytes)

---

### 9. Auto-Tagging Toggle (v1.0.0)

**Decision:** Provide a global setting to enable/disable automatic tagging on file create.

**Rationale:**
- Users may want to temporarily disable auto-tagging without uninstalling
- Useful when reorganizing vault structure
- Allows manual-only workflows while keeping bulk operations available
- Simple boolean toggle in settings UI

**Default:** Enabled (true) - auto-tagging works out of the box

---

### 10. Performance Safeguards (v1.0.0)

**Decision:** Implement throttling and debouncing for bulk operations and file watchers.

**Rationale:**
- Large vaults (1000+ files) could freeze UI during bulk operations
- Rapid file operations could trigger duplicate processing
- Timeouts must be tracked and cleaned up on plugin unload

**Implementation:**
- Bulk operations yield to main thread every 50 files
- File watchers debounced with 100ms timeout
- All timeouts tracked in `pendingTimeouts` array for cleanup

---

## Consequences

### Positive
- Clean separation between auto and manual tags
- Flexible rule system supports simple to complex use cases
- User's frontmatter stays clean (tracking is internal)
- Works on desktop and mobile
- Incremental development possible (each feature is independent)
- Global toggle provides user control without uninstalling (v1.0.0)
- Throttling prevents UI freezes on large vaults (v1.0.0)
- Proper cleanup prevents memory leaks (v1.0.0)

### Negative
- Internal tracking adds complexity
- Must handle edge cases (file renamed externally, data.json corruption)
- Content rules may have performance impact on large vaults (Phase 7 - future)

### Risks
- Obsidian API changes could break event watching
- Large vaults with content rules enabled may see slowdown (mitigated by throttling)

### Mitigations Added in v1.0.0
- Tag validation prevents invisible/invalid tags
- Case-insensitive comparison prevents duplicate tags
- Debouncing prevents duplicate file operations
- Timeout tracking enables proper cleanup on unload

---

## Related Decisions

- ADR-002 (future): Batch Tagger Implementation
- ADR-003 (future): Tag Report Dashboard Design
