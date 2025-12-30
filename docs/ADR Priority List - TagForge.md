# ADR Priority List - TagForge

**Last Updated:** December 30, 2024

---

## Phase 1: Foundation (MVP)

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 1 | Plugin scaffold & build setup | **Done** | TypeScript, esbuild, manifest.json |
| 2 | Settings infrastructure | **Done** | Settings class, data persistence |
| 3 | Settings UI tab | **Done** | Basic configuration interface |
| 4 | Single file tagging | **Bug** | Command runs but tags not applied - TFile check issue |

**Phase 1 Goal:** Plugin loads, has settings, can manually add a tag to a file.

---

## Phase 2: Auto-Watch (Priority 1)

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 5 | File create watcher | Planned | `vault.on('create')` event |
| 6 | Basic folder rules | Planned | Folder path → tags mapping |
| 7 | Apply tags on file create | Planned | New files get tags based on location |
| 8 | File move detection | Planned | `vault.on('rename')` with path change |

**Phase 2 Goal:** New files automatically get tags based on folder. Moves detected.

---

## Phase 3: Bulk & Selective Push (Priority 2)

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 9 | Bulk apply command | Planned | Process all vault files |
| 10 | Selective folder push | Planned | Apply rules to specific subtree |
| 11 | Preview/dry-run mode | Planned | Show changes before applying |
| 12 | Tag tracking database | Planned | Record which tags plugin applied |

**Phase 3 Goal:** Can retroactively tag existing files with preview.

---

## Phase 4: One-Time Batch Tagger

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 13 | File selection UI | Planned | Modal to select multiple files |
| 14 | Batch tag input | Planned | Enter tags to apply |
| 15 | Apply batch tags | Planned | Tags applied, NOT tracked as auto-tags |

**Phase 4 Goal:** Can select files and apply arbitrary tags (separate from rules).

---

## Phase 5: Hierarchical Inheritance (Priority 3)

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 16 | Depth configuration | Planned | Setting for how many levels to inherit |
| 17 | Folder name → tag conversion | Planned | "Personal Projects" → "personal-projects" |
| 18 | Folder aliases | Planned | Custom folder-to-tag name mappings |
| 19 | Inheritance engine | Planned | Walk up folder tree, collect tags |

**Phase 5 Goal:** Files inherit tags from parent folders up to configured depth.

---

## Phase 6: Move Handling

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 20 | Move confirmation modal | Planned | Prompt on file path change |
| 21 | Update tags on confirm | Planned | Remove old auto-tags, apply new |
| 22 | Undo move option | Planned | Restore file and original tags |
| 23 | Protected tags | Planned | Tags plugin should never touch |

**Phase 6 Goal:** Graceful handling of file moves with user control.

---

## Phase 7: Advanced Rules

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 24 | Ignore patterns | Planned | Skip folders (Templates, .obsidian) |
| 25 | Filename pattern rules | Planned | Regex/glob on filenames |
| 26 | Content-based rules | Planned | Search content for patterns |
| 27 | Template integration | Planned | Tags based on template origin |

**Phase 7 Goal:** Sophisticated rule engine beyond folder-based tagging.

---

## Phase 8: Polish & UX

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 28 | Undo/history | Planned | Rollback last operation |
| 29 | Tag report dashboard | Planned | Visual overview of tag landscape |
| 30 | Validation warnings | Planned | Missing tags, orphaned tags |
| 31 | Inline tag option | Planned | Alternative to frontmatter |

**Phase 8 Goal:** Production-ready with great UX.

---

## Future Possibilities (Not Scheduled)

| Feature | Notes |
|---------|-------|
| Tag suggestions | AI-powered tag recommendations |
| Graph view integration | Custom graph filtering presets |
| Tag cleanup command | Remove orphaned/unused tags |
| Import/export rules | Share configurations |
| Multi-vault sync | Share rules across vaults |

---

## Technical Debt / Known Issues

| Item | Priority | Notes |
|------|----------|-------|
| TFile type check failing | High | `file.constructor.name !== 'TFile'` doesn't work in production. Use `instanceof TFile` instead. |

---

## Development Notes

- **Environment:** Windows 11
- **Source code:** `C:\Users\bwales\projects\obsidian-plugins\tagforge\`
- **Deploy target:** `G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\tagforge\`
- **Test vault:** ~300 files, 5-7 folder levels deep
- **Hot reload:** Use Obsidian Hot Reload plugin or manual reload
- **Build command:** `npm run dev` for watch mode (configure esbuild to output to deploy target)

---

## Reference Material

- **Inspiration:** [obsidian-automatic-tags](https://github.com/Jamalam360/obsidian-automatic-tags) (MIT)
- **Plugin template:** [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- **API docs:** https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
