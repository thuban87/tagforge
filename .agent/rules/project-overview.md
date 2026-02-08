---
trigger: always_on
---

# TagForge — Development Guidelines

Instructions for AI assistants working on this project.

**Version:** 1.0.0  
**Last Updated:** 2026-02-08

---

## Project Context

**Developer:** Brad Wales (ADHD, visual learner, prefers vibe coding)  
**Purpose:** Automatic hierarchical tag management for Obsidian vaults  
**Target User:** Users building "external brain" systems who need reliable, automatic organization for graph view filtering and file discovery  
**Tech Stack:** TypeScript, Obsidian Plugin API, esbuild  
**Target:** Desktop + Mobile compatible

**Environments:**
- **Dev:** `C:\Users\bwales\projects\obsidian-plugins\tagforge`
- **Test:** `C:\Quest-Board-Test-Vault\.obsidian\plugins\tagforge`
- **Production:** `G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\tagforge`

Only `main.js`, `manifest.json`, and `styles.css` need to exist in the production directory.

---

## Git Workflow (CRITICAL)

**Brad handles ALL git commands.** AI assistants should:
- ✅ Read: `git status`, `git log`, `git diff`
- ❌ **NEVER run:** `git add`, `git commit`, `git push`, `git pull`, `git merge`, `git rebase`
- ✅ Provide commit messages at session wrap-up for Brad to copy/paste

---

## Development Session Workflow

1. **Review & Discuss** — Check Handoff Log and ADR Priority List first
2. **Clarify** — Requirements, scope, and feature status
3. **Do the Work** — Write code in dev environment only
4. **Test** — `npm run build`, fix errors, rebuild until clean
5. **Deploy** - `npm run deploy:test`, deploy to test vault for testing
6. **Wait for Confirmation** — Brad tests in Obsidian vault
7. **Wrap Up** — Update Handoff Log, docs, provide commit message

---

## Architecture (Non-Negotiable!)

**Principles:**
- **Separation of Concerns:** Services, Modals, Utils should be distinct layers
- **Single Responsibility:** Each class/function does ONE thing
- **No Monolithic Files:** Split if exceeding ~200-300 lines
- **JSDoc Public Methods:** All public and important methods get documentation

### Current File Structure

```
tagforge/
├── main.ts                     # ⚠️ MONOLITH — 4,549 lines (decomposition planned)
├── styles.css                  # All plugin styles, 2,288 lines
├── manifest.json               # Plugin manifest, v1.0.0
├── package.json                # Build config, 4 devDependencies
├── esbuild.config.mjs          # esbuild bundler config
├── tsconfig.json               # TypeScript config
├── CLAUDE.md                   # This file
├── README.md                   # Plugin readme
├── LICENSE                     # MIT
└── docs/
    ├── Handoff Log.md              # START HERE — session history
    ├── Project Summary.md          # High-level context
    ├── ADR-001-Architecture.md     # Core architecture decisions
    ├── ADR-002-FolderRulesSystem.md # Folder rules design
    ├── ADR Priority List - TagForge.md # Development roadmap
    ├── Rule System Testing.md      # Manual test checklist
    ├── Idea List.md                # Future ideas
    ├── Feature Proposal - Folder Tag Preview.md
    └── launch-considerations/      # Pre-launch analysis
        ├── Codebase Stats.md
        ├── Test Coverage Matrix.md
        └── System Dependency Matrix.md
```

### Layer Responsibilities

| Layer | Should | Should NOT |
|-------|--------|------------|
| **main.ts** (future: thin entry) | Register commands, initialize services, handle lifecycle | Contain business logic, UI rendering |
| **Services** (future) | Business logic, tag resolution, file I/O, data coordination | Render UI, manipulate DOM |
| **Modals** | User interaction, display data, collect input | Contain business logic, directly modify data |
| **Utils** (future) | Pure functions, data transformations, path helpers | Manage state, make assumptions about context |

---

## Key Architecture Decisions

1. **Tag Tracking:** Plugin maintains an internal database of which tags it applied (stored in plugin data via `loadData()`/`saveData()`). This allows it to manage auto-tags without touching user's manual tags.

2. **Flat Tags:** Uses flat tag names (not Obsidian's nested `#parent/child` format) for better graph view filtering.

3. **Frontmatter Default:** Tags stored in YAML frontmatter by default, with option for inline tags.

4. **Hierarchical Inheritance:** Files inherit tags from ancestor folders based on configurable depth.

5. **Explicit Rules (Phase 10):** The current system uses explicit folder rules rather than implicit folder-name-based tagging. Tags are only applied when a user-defined rule exists for the folder path.

---

## Naming Conventions

```typescript
// Classes: PascalCase
class TagForgePlugin extends Plugin { }
class TagForgeSettingTab extends PluginSettingTab { }
class BulkPreviewModal extends Modal { }

// Files: kebab-case (when decomposed)
// main.ts, tag-resolver.ts, bulk-preview-modal.ts

// CSS Classes: bbab-tf- prefix
.bbab-tf-settings-container { }
.bbab-tf-tag-report { }
.bbab-tf-modal { }
```

---

## Current Feature Status

### Completed ✅ (Phases 1-10)

**Core Tagging:**
- Auto-tag on file creation (when rules exist)
- Manual tag current file command
- Bulk apply to vault or specific folder
- Enhanced preview modal with per-file tag editing
- Folder-to-tag name derivation with aliases

**Tag Removal & Revert:**
- Revert all auto-tags (keeps manual tags)
- Nuclear remove ALL tags (desktop only)
- Revert by date (date picker)
- Revert by folder (folder picker)

**File Move Handling (Phase 6):**
- Auto-detect file moves vs renames
- Move confirmation modal (single + grouped/batch)
- Per-file exclusion in batch moves
- Cancel move (restore to original location with folder cleanup)
- Remember choice option

**Folder Rules (Phase 10):**
- Explicit rule definitions per folder
- Folder tag level selection
- Apply-down levels control ('all' or specific levels)
- Ancestor inheritance toggle
- Rules management modal with folder tree browser

**History & Validation (Phase 8):**
- Operation recording with undo (50 operations max)
- Tag report dashboard
- Tag validation (orphaned tracking, missing tags, ignored paths)
- Auto-fix for validation issues

**Settings & UX:**
- Settings tab with all configuration options
- Folder aliases (custom tag names for folders)
- Ignore paths and protected tags
- Content rules and filename rules (Phase 7)
- Mobile optimization (Phase 9)
- Touch-friendly 44px+ targets, responsive modals

### Future / Planned 🔮

See `docs/ADR Priority List - TagForge.md` and `docs/Idea List.md` for planned features.

---

## Data Storage

| Data Type | Storage Method | Why |
|-----------|---------------|-----|
| **Settings** (autoTag, depth, mappings, etc.) | `loadData()`/`saveData()` in `data.json` | Plugin-managed, persists with plugin |
| **Tag Tracking** (which auto-tags were applied per file) | `loadData()`/`saveData()` in `data.json` | Needs to survive across sessions |
| **Operation History** (undo stack) | `loadData()`/`saveData()` in `data.json` | Max 50 entries, capped for performance |
| **Folder Rules** (Phase 10 rule definitions) | `loadData()`/`saveData()` in `data.json` | User-defined rules |
| **Tags themselves** | YAML frontmatter in user's `.md` files | User-visible, portable, standard Obsidian |

---

## Common Pitfalls

### Don't:
- ❌ Put all code in main.ts (decompose!)
- ❌ Use synchronous file I/O
- ❌ Remove tags without checking `protectedTags`
- ❌ Modify frontmatter without `processFrontMatter()`
- ❌ Run git commands (Brad handles all git)
- ❌ Skip build verification before deployment
- ❌ Use Node.js `fs`/`path` without `Platform.isMobile` guard

### Do:
- ✅ Keep files under 300 lines (target)
- ✅ Use TypeScript strict mode
- ✅ Comment public methods with JSDoc
- ✅ Test build before deploying
- ✅ Follow session workflow (check Handoff Log first!)
- ✅ Record operations for undo capability
- ✅ Check `ignorePaths` before processing files
- ✅ Use debouncing for file event handlers (100ms for create/rename)

---

## Key Documentation

| Document | Purpose |
|----------|---------|
| **Handoff Log.md** | **START HERE** — Session history, current state, next steps |
| **Project Summary.md** | High-level context and feature overview |
| **ADR-001-Architecture.md** | Core architecture decisions |
| **ADR-002-FolderRulesSystem.md** | Folder rules system design |
| **ADR Priority List - TagForge.md** | Development roadmap and phase tracking |
| **Rule System Testing.md** | Manual test checklist for rules |
| **Codebase Stats.md** | Lines of code, class inventory, method counts |
| **Test Coverage Matrix.md** | Test coverage (currently 0%) with priorities |
| **System Dependency Matrix.md** | Internal dependency graph and blast radius |

---

## Development Notes

- **Obsidian API:** `processFrontMatter()` is the only safe way to modify frontmatter — it handles YAML parsing, conflict resolution, and file locking
- **Event Debouncing:** `vault.on('create')` and `vault.on('rename')` handlers use 100ms debounce to avoid metadata cache race conditions
- **Move Batching:** Multiple file moves within 300ms are batched and shown in a single grouped modal
- **Windows System Files:** `desktop.ini`, `Thumbs.db`, `.DS_Store` are cleaned up during move cancellation folder cleanup
- **56 Notice calls** across the codebase — the plugin is fairly chatty with user feedback
