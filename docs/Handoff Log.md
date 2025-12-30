# TagForge Handoff Log

**Last Updated:** December 30, 2024
**Current Phase:** Phase 1 - Foundation (IN PROGRESS)
**Current Branch:** N/A (repo not initialized)
**Total Features Planned:** 31 (across 8 phases)

---

## Session: Phase 1 Foundation Build - COMPLETE (with bug)

### Session Summary

Built the complete plugin scaffold with TypeScript, esbuild, settings infrastructure, and basic tagging functionality. Encountered and resolved Google Drive File Stream npm compatibility issues. Decided to move development to local filesystem for better npm compatibility.

### Files Created

| File | Purpose | Status |
|------|---------|--------|
| `package.json` | npm project config with TypeScript + esbuild | Done |
| `tsconfig.json` | TypeScript compiler configuration | Done |
| `manifest.json` | Obsidian plugin manifest (id: tagforge) | Done |
| `esbuild.config.mjs` | Build script with watch mode support | Done |
| `main.ts` | Plugin class, settings interface, settings tab | Done |
| `styles.css` | Plugin styles with `bbab-tf-` prefix | Done |
| `main.js` | Compiled plugin (built successfully) | Done |
| `install.bat` | Build helper script (deprecated - moving to local dev) | Done |

### Implementation Details

**Settings Interface (TagForgeSettings):**
- `inheritDepth` (number) - How many folder levels to inherit tags from
- `tagFormat` ('frontmatter' | 'inline') - Where to store tags
- `showMoveConfirmation` (boolean) - Prompt before updating tags on file move
- `folderMappings` - Explicit folder-to-tags overrides
- `folderAliases` - Custom folder name to tag name mappings
- `ignorePaths` - Folders to skip (default: Templates, .obsidian)
- `protectedTags` - Tags plugin should never touch
- `contentRules` / `filenameRules` - Placeholders for Phase 7

**Tag Tracking Interface (TagTrackingEntry):**
- `autoTags` - Array of tags plugin applied to file
- `lastUpdated` - ISO timestamp of last update

**Plugin Features Implemented:**
- `loadSettings()` / `saveSettings()` with proper data persistence
- `TagForgeSettingTab` with full settings UI
- Command: "Tag current file based on folder"
- `getTagsForPath()` - Generates tags from folder hierarchy
- `folderNameToTag()` - Converts "Personal Projects" to "personal-projects"
- `applyTagsToFile()` - Applies tags via frontmatter or inline
- Tag tracking for later smart removal

### Technical Issues Encountered

**Google Drive File Stream + npm:**
- npm cannot reliably write to Google Drive virtual filesystem
- Causes "bad file descriptor" and permission errors
- **Solution:** Moving development to local filesystem at `C:\Users\bwales\projects\obsidian-plugins\tagforge\`

**TFile Type Check Bug:**
- `file.constructor.name !== 'TFile'` doesn't work in production/minified builds
- Command says "Applied tags" but nothing changes in file
- **Fix needed:** Use `instanceof TFile` instead

### Testing Results

- [x] Plugin loads in Obsidian
- [x] Settings tab appears with all controls
- [x] Settings persist after reload
- [ ] "Tag current file" command works - **BUG: Says applied but doesn't change file**

### Directory Change

Moving from Google Drive to local filesystem:
- **Old:** `G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\tagforge\`
- **New (source):** `C:\Users\bwales\projects\obsidian-plugins\tagforge\`
- **Deploy target:** Same Google Drive path (for Obsidian to load)

---

## Session: Planning & Documentation - COMPLETE

### Session Summary

Initial planning session conducted in the main Obsidian vault. Analyzed the existing [obsidian-automatic-tags](https://github.com/Jamalam360/obsidian-automatic-tags) plugin as a reference, identified limitations, and designed TagForge as a comprehensive replacement with hierarchical inheritance, true auto-watch, and intelligent tag tracking.

### Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Plugin name | TagForge | Evokes building/forging a tag system |
| Tag format | Flat tags | Better graph view filtering than nested tags |
| Tag storage | Frontmatter (default) | Standard, clean, with inline option |
| Tag tracking | Internal plugin database | Invisible to user, enables smart removal |
| CSS prefix | `bbab-tf-` | Avoid conflicts, consistent with dev conventions |
| Development environment | Windows 11 PC | User's daily driver, ready to go |
| Development location | `.obsidian/plugins/tagforge/` | Directly in test vault |

### User Context

- Recently diagnosed with ADHD, building "external brain" system
- 99th percentile visual working memory - graph view is critical
- ~300 files across 5-7 folder levels deep
- Primary goals: organization, easy filtering, linked document navigation
- Uses flat tags in frontmatter

### Priority Order Established

1. **Auto-watch** - Files tagged automatically on create/move (most important)
2. **Bulk/selective push** - Retroactive tagging with preview
3. **Hierarchical inheritance** - Folder ancestry becomes tags

### Documentation Created

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Instructions for Claude sessions |
| `docs/Project Summary.md` | Full context for new sessions |
| `docs/ADR-001-Architecture.md` | Core architecture decisions |
| `docs/ADR Priority List - TagForge.md` | Development roadmap (8 phases, 31 features) |
| `docs/Handoff Log.md` | This file - session continuity |

### Reference Material Reviewed

- [obsidian-automatic-tags](https://github.com/Jamalam360/obsidian-automatic-tags) - MIT licensed, ~150 lines
- User's WordPress plugin [bbab-service-center](https://github.com/Brads-Bits-and-Bytes/bbab-service-center) - OOP architecture reference

---

## What Needs to Happen Next

### Phase 1: Foundation

1. Initialize npm project with TypeScript + esbuild
2. Create plugin scaffold (main.ts, manifest.json, package.json)
3. Implement settings infrastructure
4. Build settings UI tab
5. Test basic single-file tagging

### Development Environment Setup

- Install Node.js if not present
- Install Obsidian "Hot Reload" plugin for faster dev cycle
- Run `npm run dev` for watch mode during development

---

## Next Session Prompt

```
Phase 1 Bug Fix + Phase 2 Start

**Directory:** C:\Users\bwales\projects\obsidian-plugins\tagforge\
**Deploy to:** G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\tagforge\

**Current state:**
- Phase 1 scaffold COMPLETE (plugin loads, settings work)
- BUG: "Tag current file" command says success but doesn't modify file
- Root cause: `file.constructor.name !== 'TFile'` fails in production builds

**This session - Part 1: Fix the bug**

1. Fix TFile type checking in main.ts:
   - Import `TFile` from 'obsidian'
   - Replace `file.constructor.name !== 'TFile'` with `!(file instanceof TFile)`
   - Check all occurrences (applyTagsToFile, applyFrontmatterTags, applyInlineTags)

2. Update esbuild.config.mjs to output directly to deploy directory:
   - outfile: "G:/My Drive/IT/Obsidian Vault/My Notebooks/.obsidian/plugins/tagforge/main.js"

3. Test the fix:
   - Run `npm run build`
   - Reload plugin in Obsidian
   - Run "Tag current file" command
   - Verify tags appear in frontmatter

**This session - Part 2: Start Phase 2 (Auto-Watch)**

4. Add file create watcher:
   - `this.registerEvent(this.app.vault.on('create', ...))`
   - Auto-tag new files based on folder location

5. Test auto-watch:
   - Create a new file in a folder
   - Verify it gets tagged automatically

**Reference docs:**
- docs/ADR Priority List - TagForge.md (Phase 2 details)
- docs/ADR-001-Architecture.md (file watching decisions)

**After this session:**
Update Handoff Log with results, mark Phase 1 complete, update Phase 2 status.
```

---

## Phase Status

| Phase | Focus | Status |
|-------|-------|--------|
| 1 | Foundation (scaffold, settings, basic tagging) | **IN PROGRESS** - Needs testing |
| 2 | Auto-Watch (file create/move detection) | Planned |
| 3 | Bulk & Selective Push | Planned |
| 4 | One-Time Batch Tagger | Planned |
| 5 | Hierarchical Inheritance | Planned |
| 6 | Move Handling | Planned |
| 7 | Advanced Rules | Planned |
| 8 | Polish & UX | Planned |

---

## Lessons Learned / Tips

### From Phase 1 Build
- **Google Drive + npm don't mix:** Use a local temp folder for npm operations, then copy compiled files back
- **`install.bat` script:** Always use this for builds on this machine
- **Obsidian file API:** Use `file.constructor.name !== 'TFile'` check since getAbstractFileByPath returns TFile | TFolder
- **Frontmatter processing:** Use `app.fileManager.processFrontMatter()` for clean YAML manipulation

### From Planning Session
- Obsidian API doesn't allow intercepting file moves before they happen - must detect after and offer undo
- Nested tags (`#parent/child`) search includes children when searching parent - not ideal for graph filtering
- Flat tags with hierarchical inheritance gives best of both worlds

---

## Quick Reference

### Naming Conventions

```typescript
// Classes: PascalCase
class TagForgePlugin extends Plugin { }
class TagForgeSettings { }

// Files: kebab-case
main.ts
settings.ts
watcher.ts

// CSS Classes: bbab-tf- prefix
.bbab-tf-settings-container { }
```

### Key Files

| File | Purpose |
|------|---------|
| `main.ts` | Plugin source code |
| `main.js` | Compiled plugin (what Obsidian loads) |
| `manifest.json` | Plugin metadata |
| `package.json` | Dependencies and scripts |
| `styles.css` | Plugin styles |
| `install.bat` | Build helper script (Google Drive workaround) |
| `data.json` | Settings + tag tracking (auto-generated by Obsidian) |

### Development Commands

**On Google Drive (this machine):**
```bash
# Double-click install.bat to rebuild
# OR in PowerShell:
.\install.bat
```

**On local filesystem (normal):**
```bash
npm install      # Install dependencies
npm run dev      # Watch mode (auto-rebuild on save)
npm run build    # Production build
```

### Testing Workflow

1. Make changes to TypeScript
2. Save (auto-compiles if `npm run dev` running)
3. Reload Obsidian: Ctrl+P → "Reload app without saving"
4. Or toggle plugin off/on in Settings → Community Plugins

---

## Archived Sessions

_(Sessions will be moved here after subsequent sessions are complete to keep the log manageable)_
