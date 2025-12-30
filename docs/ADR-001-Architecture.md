# ADR-001: TagForge Core Architecture

**Status:** Accepted
**Date:** December 30, 2024

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

### 2. Tag Storage: Frontmatter Default

**Decision:** Store tags in YAML frontmatter by default, with option for inline tags.

**Rationale:**
- Frontmatter is standard and widely compatible
- Easier to programmatically read/write
- Clean separation from note content
- User preference varies, so make it configurable

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
  inheritDepth: number;           // How many folder levels to inherit
  tagFormat: 'frontmatter' | 'inline';
  showMoveConfirmation: boolean;

  folderMappings: {
    [folderPath: string]: string[];  // folder -> tags
  };

  folderAliases: {
    [folderPath: string]: string;    // folder name -> tag name override
  };

  ignorePaths: string[];          // Paths to skip
  protectedTags: string[];        // Never touch these tags

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

## Consequences

### Positive
- Clean separation between auto and manual tags
- Flexible rule system supports simple to complex use cases
- User's frontmatter stays clean (tracking is internal)
- Works on desktop and mobile
- Incremental development possible (each feature is independent)

### Negative
- Internal tracking adds complexity
- Must handle edge cases (file renamed externally, data.json corruption)
- Content rules may have performance impact on large vaults

### Risks
- Obsidian API changes could break event watching
- Large vaults with content rules enabled may see slowdown

---

## Related Decisions

- ADR-002 (future): Batch Tagger Implementation
- ADR-003 (future): Tag Report Dashboard Design
