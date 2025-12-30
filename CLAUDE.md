# CLAUDE.md - TagForge

This file provides guidance to Claude Code when working on the TagForge Obsidian plugin.

## Project Overview

**TagForge** is an Obsidian plugin for automatic, hierarchical tag management. It helps users maintain consistent tagging across their vault by automatically applying tags based on folder structure, with support for manual batch tagging and intelligent tag tracking.

**Target User:** Users building "external brain" systems who need reliable, automatic organization for graph view filtering and file discovery.

## Documentation

All project documentation lives in `./docs/`:

| Document | Purpose |
|----------|---------|
| `Handoff Log.md` | **START HERE** - Session history, current state, next steps |
| `Project Summary.md` | High-level context and feature overview |
| `ADR-001-Architecture.md` | Core architecture decisions |
| `ADR Priority List - TagForge.md` | Development roadmap and phase tracking |

**Always check the Handoff Log first** - it has the current state, what was done last session, and the prompt to continue.

## Tech Stack

- **Language:** TypeScript
- **Build:** esbuild
- **Platform:** Obsidian Plugin API
- **Target:** Desktop + Mobile compatible

## Naming Conventions

```typescript
// Classes: PascalCase
class TagForgePlugin extends Plugin { }
class TagForgeSettings { }
class TagForgeWatcher { }

// Files: kebab-case
main.ts
settings.ts
watcher.ts
tag-tracker.ts

// CSS Classes: bbab-tf- prefix
.bbab-tf-settings-container { }
.bbab-tf-tag-report { }
.bbab-tf-modal { }
```

## Key Architecture Decisions

1. **Tag Tracking:** Plugin maintains internal database of which tags it applied (stored in plugin data). This allows it to manage auto-tags without touching user's manual tags.

2. **Flat Tags:** Uses flat tag names (not Obsidian's nested `#parent/child` format) for better graph view filtering.

3. **Frontmatter Default:** Tags stored in YAML frontmatter by default, with option for inline tags.

4. **Hierarchical Inheritance:** Files inherit tags from ancestor folders based on configurable depth.

## Directory Structure

**Development Directory (source code):**
```
C:\Users\bwales\projects\obsidian-plugins\tagforge\
```

**Deploy Directory (Obsidian loads from here):**
```
G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\tagforge\
```

Only `main.js`, `manifest.json`, and `styles.css` need to exist in the deploy directory.

## Development Workflow

1. Make changes to TypeScript files in the development directory
2. Run `npm run dev` (watch mode) or `npm run build`
3. Build outputs `main.js` - copy to deploy directory (or configure build to output there)
4. Reload plugin in Obsidian: Ctrl+P → "Reload app without saving" OR toggle plugin off/on
5. Test the changes

**Build with auto-deploy:**
```bash
# In package.json, update esbuild outfile to deploy directly:
# outfile: "G:/My Drive/IT/Obsidian Vault/My Notebooks/.obsidian/plugins/tagforge/main.js"
```

## Test Vault

The Obsidian vault for testing is at:
```
G:\My Drive\IT\Obsidian Vault\My Notebooks\
```

The vault has ~300 files across nested directories (5-7 levels deep) - ideal for testing hierarchical tagging.

## When Working on This Project

1. **Read Handoff Log FIRST** - Contains current state, last session summary, and next session prompt
2. **Check ADR Priority List** for current phase and feature status
3. **Read relevant ADRs** before making architectural changes
4. **Test incrementally** - each phase should be functional before moving to next
5. **Update Handoff Log** at end of session with:
   - Session summary
   - Files created/modified
   - Technical notes
   - Testing results
   - Next session prompt
