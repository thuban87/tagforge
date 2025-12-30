# TagForge - Project Summary

**Purpose:** Provide full project context for Claude Code sessions.

**Note:** For current state and next steps, see `Handoff Log.md` first. This document covers the "what and why" - the Handoff Log covers the "where we are now."

---

## What Is TagForge?

TagForge is an Obsidian plugin that automatically manages tags based on folder structure. It solves the problem of maintaining consistent tagging across a vault without manual effort.

**Primary Use Case:** Users building PKM/external brain systems who rely on tags for graph view filtering and file organization.

---

## Origin

Based on analysis of [obsidian-automatic-tags](https://github.com/Jamalam360/obsidian-automatic-tags) by Jamalam360 (MIT licensed). That plugin is functional but limited:

- Basic glob patterns only
- No true auto-watch (requires manual trigger)
- No tag inheritance
- No tracking of which tags it applied
- Single text area config UI

TagForge builds on this foundation with significantly expanded capabilities.

---

## Core Features

### 1. True Auto-Watch (Priority 1)
Automatically tag files when:
- New file is created
- File is moved to a different folder

This must work reliably without manual intervention.

### 2. Bulk & Selective Push (Priority 2)
- **Bulk push:** Apply rules to all existing files in vault
- **Selective push:** Apply rules to a specific folder/subtree on demand
- **Preview mode:** See what changes would occur before applying

### 3. One-Time Batch Tagger (Priority 2)
Separate from rule-based tagging. Allows user to:
- Select a set of existing files
- Apply arbitrary tags to them
- Tags are NOT part of ongoing auto-tagging rules

Use case: Tagging files by project phase (e.g., `#phase-1`, `#phase-2`) where the grouping is historical, not folder-based.

### 4. Hierarchical Inheritance (Priority 3)
Files inherit tags from ancestor folders:
```
Health/Therapy/Session Notes/2024-01-15.md
→ Gets: #health, #therapy, #session-notes
```

Configurable depth (e.g., top 3 levels only).

### 5. Tag Tracking / Source of Truth
Plugin maintains internal record of which tags it applied to each file. This enables:
- Removing only auto-tags when files move (preserve manual tags)
- Updating tags when rules change
- Clear separation between auto and manual tags

### 6. Move Detection
When a file moves:
1. Detect the move
2. Prompt user: "Update tags? [Yes / No / Undo Move]"
3. If yes: Remove old auto-tags, apply new ones
4. If undo: Move file back, restore original tags

---

## Tag Management Features

- **Tag aliasing:** Multiple folders map to same tag
- **Protected tags:** Tags the plugin should never touch
- **Format choice:** Frontmatter (default) or inline tags
- **Ignore patterns:** Skip certain folders (e.g., Templates, .obsidian)

---

## Intelligence Features

- **Content-based rules:** "If file contains 'TODO', add `#has-todos`"
- **Filename patterns:** "Files named `*-meeting-notes.md` get `#meetings`"
- **Template integration:** Files from specific templates get specific tags

---

## UX Features

- **Undo/history:** Rollback last tagging operation
- **Tag report:** Dashboard showing tag landscape and folder mappings
- **Validation:** Warnings for missing expected tags or orphaned tags

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tag format | Flat tags | Better graph view filtering than nested tags |
| Tag storage | Frontmatter | Standard, widely compatible |
| Tag tracking | Internal plugin database | Invisible to user, keeps frontmatter clean |
| Naming | `bbab-tf-` prefix for CSS | Avoid conflicts with other plugins |

---

## Development Approach

Build incrementally with testing at each phase:

1. **Phase 1:** Plugin scaffold, settings UI, basic single-file tagging
2. **Phase 2:** Auto-watch on file create
3. **Phase 3:** Folder rules engine
4. **Phase 4:** Hierarchical inheritance
5. **Phase 5:** Move detection
6. **Phase 6:** Batch tagger
7. **Phase 7:** Advanced rules (content, filename, template)
8. **Phase 8:** Polish (undo, reports, validation)

---

## Environment

- **Development:** Windows 11 PC
- **Source code:** `C:\Users\bwales\projects\obsidian-plugins\tagforge\`
- **Deploy target:** `G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\tagforge\`
- **Test vault:** ~300 files, directories 5-7 levels deep
- **Build:** TypeScript + esbuild (outputs directly to deploy target)
- **Hot reload:** Available via Obsidian Hot Reload plugin or manual reload

---

## Reference

- Original plugin: https://github.com/Jamalam360/obsidian-automatic-tags
- Obsidian Plugin API: https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
- Sample plugin template: https://github.com/obsidianmd/obsidian-sample-plugin
