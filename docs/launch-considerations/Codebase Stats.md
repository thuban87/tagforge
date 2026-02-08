# 🏷️ TagForge — Codebase Stats

**Generated:** 2026-02-08 | **Version:** v1.0.0

---

## Overall Size

| Metric | Value |
|--------|-------|
| **Source Files** | **1** (`main.ts`) |
| **Total Lines of Code** | **4,549** |
| **Total Characters** | **~144,000** |
| **Total File Size** | **150 KB** of TypeScript |
| **CSS** | **1 file**, **2,288 lines**, ~47K characters |
| **Grand Total (code + CSS)** | **~6,837 lines** |

---

## Architecture Shape

| Metric | Value |
|--------|-------|
| **Architecture Style** | **Monolith** — entire plugin in a single `main.ts` |
| **Separate Modules** | 0 (no services, utils, or models split out) |
| **Build System** | esbuild (single-file bundle) |
| **Dependencies** | 4 devDependencies (esbuild, typescript, obsidian, @types/node) |
| **Runtime Requires** | `fs`, `path` (Node.js via Electron) |

> [!IMPORTANT]
> The entire plugin lives in one file. This is typical for smaller Obsidian plugins but unusual at 4,549 lines — most plugins this size have been decomposed into modules.

---

## Breakdown by Logical Area

| Area | Lines | % of Code | Description |
|------|------:|----------:|-------------|
| **TagForgePlugin** (main class) | 1,846 | 40.6% | Core plugin logic, all 38 methods |
| **BulkPreviewModal** | 719 | 15.8% | Tag preview/edit modal with file tree |
| **RulesManagementModal** | 538 | 11.8% | Phase 10 folder rules editor |
| **TagForgeSettingTab** | 261 | 5.7% | Settings UI |
| **GroupedMoveConfirmationModal** | 197 | 4.3% | Batch move confirmation |
| **TagReportModal** | 190 | 4.2% | Tag usage dashboard |
| **ValidationResultsModal** | 144 | 3.2% | Tag validation results |
| **UndoHistoryModal** | 143 | 3.1% | Operation history viewer |
| **MoveConfirmationModal** | 127 | 2.8% | Single-file move confirmation |
| **DatePickerModal** | 101 | 2.2% | Date selection for revert-by-date |
| **FolderPickerModal** | 80 | 1.8% | Folder selection for bulk ops |
| **Interfaces + Constants** | ~203 | 4.5% | 11 interfaces, defaults, constants |

---

## Class Inventory

| # | Class | Lines | Extends | Role |
|---|-------|------:|---------|------|
| 1 | `TagForgePlugin` | 1,846 | `Plugin` | Core logic — all tagging, revert, bulk, rules, history |
| 2 | `BulkPreviewModal` | 719 | `Modal` | Tag preview with file tree, per-file editing |
| 3 | `RulesManagementModal` | 538 | `Modal` | Folder rules CRUD with tree browser |
| 4 | `TagForgeSettingTab` | 261 | `PluginSettingTab` | Settings page |
| 5 | `GroupedMoveConfirmationModal` | 197 | `Modal` | Multi-file move confirmation |
| 6 | `TagReportModal` | 190 | `Modal` | Tag report dashboard |
| 7 | `ValidationResultsModal` | 144 | `Modal` | Validation issue viewer & fixer |
| 8 | `UndoHistoryModal` | 143 | `Modal` | Undo/history viewer |
| 9 | `MoveConfirmationModal` | 127 | `Modal` | Single-file move confirmation |
| 10 | `DatePickerModal` | 101 | `Modal` | Multi-date picker |
| 11 | `FolderPickerModal` | 80 | `Modal` | Folder browser with search |

---

## Interface Inventory

| Interface | Fields | Purpose |
|-----------|-------:|---------|
| `TagForgeSettings` | 10 | All user-facing settings |
| `TagTrackingEntry` | 2 | Per-file auto-tag tracking |
| `FolderRule` | 7 | Phase 10 folder rule definition |
| `OperationFileState` | 4 | File state snapshot for undo |
| `TagOperation` | 5 | Recorded tag operation |
| `TagForgeData` | 4 | Top-level plugin data structure |
| `ValidationIssue` | 4 | Tag validation problem description |
| `EnhancedPreviewItem` | 4 | Bulk preview row data |
| `MoveConfirmationResult` | 2 | Single-file move modal result |
| `PendingMoveOperation` | 4 | Queued move operation |
| `GroupedMoveResult` | 3 | Batch move modal result |

---

## Plugin Commands & UI

| Type | Count | Details |
|------|------:|---------|
| **Commands** | 10 | TAG, REMOVE (×4), BULK ADD (×2), UNDO, REPORT, VALIDATE |
| **Ribbon Icons** | 2 | Undo (history), Bulk Add (tags) |
| **Event Handlers** | 2 | `vault.on('create')`, `vault.on('rename')` |
| **Modals** | 9 | All interactive dialogs |
| **Settings Sections** | ~6 | Core, mappings, aliases, ignore paths, protected tags, rules |

### Command List

| Command ID | Category | Description |
|-----------|----------|-------------|
| `tag-current-file` | TAG | Manually tag active file |
| `revert-all-auto-tags` | REMOVE | Undo all TagForge-applied tags |
| `revert-all-tags-nuclear` | REMOVE | Remove ALL tags (desktop only) |
| `revert-auto-tags-by-date` | REMOVE | Remove auto-tags by date |
| `revert-auto-tags-by-folder` | REMOVE | Remove auto-tags from folder |
| `bulk-apply-tags` | BULK ADD | Apply tags to entire vault |
| `bulk-apply-folder` | BULK ADD | Apply tags to specific folder |
| `undo-operation` | UNDO | Undo a recent operation |
| `tag-report` | REPORT | View tag report dashboard |
| `validate-tags` | VALIDATE | Check for tag issues |

---

## TagForgePlugin Methods (38 total)

| # | Method | Lines | Category |
|---|--------|------:|----------|
| 1 | `onload` | 151 | Lifecycle |
| 2 | `onunload` | 14 | Lifecycle |
| 3 | `loadSettings` | 8 | Settings |
| 4 | `saveSettings` | 9 | Settings |
| 5 | `tagCurrentFile` | 32 | Tagging |
| 6 | `handleFileCreate` | 35 | Auto-tagging |
| 7 | `handleFileRename` | 103 | File moves |
| 8 | `showBatchedMoveModal` | 34 | File moves |
| 9 | `handleGroupedMoveResult` | 218 | File moves |
| 10 | `handleMoveResult` | 38 | File moves |
| 11 | `applyMoveRetag` | 29 | File moves |
| 12 | `removeAutoTagsFromFile` | 20 | Tag removal |
| 13 | `removeTagsFromFile` | 31 | Tag removal |
| 14 | `getParentFolder` | 5 | Utility |
| 15 | `revertAllAutoTags` | 106 | Revert |
| 16 | `revertAllTagsNuclear` | 69 | Revert |
| 17 | `revertAutoTagsByDate` | 26 | Revert |
| 18 | `revertFilesFromDates` | 89 | Revert |
| 19 | `revertAutoTagsByFolder` | 117 | Revert |
| 20 | `bulkApplyTags` | 13 | Bulk ops |
| 21 | `bulkApplyToFolder` | 65 | Bulk ops |
| 22 | `generateEnhancedPreview` | 42 | Bulk ops |
| 23 | `getFolderTagsByLevel` | 31 | Bulk ops |
| 24 | `executeBulkApply` | 62 | Bulk ops |
| 25 | `getTagsForPath` | 50 | Tag resolution |
| 26 | `getRulesForPath` | 104 | Tag resolution |
| 27 | `hasRulesForPath` | 7 | Tag resolution |
| 28 | `folderNameToTag` | 8 | Tag resolution |
| 29 | `applyTagsToFile` | 21 | Tag application |
| 30 | `applyFrontmatterTags` | 27 | Tag application |
| 31 | `generateOperationId` | 3 | History |
| 32 | `getFileTags` | 12 | Tag reading |
| 33 | `recordOperation` | 23 | History |
| 34 | `showUndoHistory` | 10 | History |
| 35 | `undoOperation` | 50 | History |
| 36 | `showTagReport` | 3 | Reporting |
| 37 | `validateTags` | 63 | Validation |
| 38 | `fixValidationIssue` | 36 | Validation |

---

## CSS Stats

| Metric | Value |
|--------|-------|
| **Total Lines** | 2,288 |
| **Total Size** | ~51 KB |
| **Prefix Convention** | `bbab-tf-` |
| **Major Sections** | 14 |
| **Mobile Breakpoint** | 600px (targets phones + small tablets) |
| **Responsive Coverage** | Full — all modals, settings, buttons, inputs |

### CSS Sections

| Section | Approx Lines | Purpose |
|---------|------------:|---------|
| Settings Container | ~50 | Plugin settings page styles |
| Info/Example | ~60 | Info boxes and example displays |
| Large Modal | ~100 | Modal sizing and layout |
| Columns Layout | ~70 | Two-column modal layout |
| Move Confirmation | ~70 | Move modal styles |
| Bulk Preview | ~300 | Main preview modal (largest) |
| Folder Rules (Phase 10) | ~130 | Rules editor tree + controls |
| File Tree | ~80 | Tree view for file lists |
| Tag Chips | ~80 | Tag display/edit chips |
| Folder/Date Pickers | ~100 | Picker modal styles |
| Undo History | ~150 | History modal styles |
| Tag Report | ~140 | Report dashboard styles |
| Validation | ~60 | Validation results styles |
| Mobile (Phase 9) | ~500 | Full responsive overrides |

---

## Testing

| Metric | Value |
|--------|-------|
| **Test files** | 0 |
| **Testing framework** | None installed |
| **Test-to-source ratio** | 0:1 |

> [!CAUTION]
> There is **zero automated test coverage**. No testing framework (vitest, jest, etc.) is configured in `package.json`. The only testing documentation is a manual test checklist in `docs/Rule System Testing.md`.

---

## Exported Symbols

| Metric | Value |
|--------|-------|
| **Total exports** | **1** (`export default class TagForgePlugin`) |

> [!NOTE]
> Only one symbol is exported — the plugin class itself. All other classes and interfaces are file-scoped. This is standard for Obsidian plugins (Obsidian only imports the default export).

---

## Feature Count (by architectural component)

| Feature Area | Count |
|-------------|------:|
| Plugin Class Methods | 38 |
| Modal Dialogs | 9 |
| Data Interfaces | 11 |
| Commands | 10 |
| Ribbon Icons | 2 |
| Event Handlers | 2 |
| CSS Style Sections | 14 |

---

## Obsidian API Usage

| API | Call Count | Used By |
|-----|----------:|---------|
| `new Notice()` | 56 | Throughout plugin — user feedback |
| `processFrontMatter()` | ~8 | Tag read/write operations |
| `getAbstractFileByPath()` | ~6 | File/folder existence checks |
| `vault.rename()` | ~2 | Move cancellation (restore file) |
| `vault.createFolder()` | ~2 | Folder recreation on cancel |
| `vault.on()` | 2 | create + rename event handlers |
| Node.js `fs` | ~10 | Windows system file cleanup, folder deletion |
| Node.js `path` | ~4 | Path joining for filesystem ops |

> [!WARNING]
> Direct `fs` and `path` usage (via `require()`) means the plugin **cannot work on mobile Obsidian** for the move-cancel folder cleanup feature. The nuclear revert command is already gated behind `Platform.isMobile`, but the folder cleanup in `handleGroupedMoveResult` is not.

---

## Summary

**4,549 lines of TypeScript** + **2,288 lines of CSS** = **~6,837 total lines** in **2 source files**. The entire plugin is a single monolithic `main.ts` with 11 classes (1 plugin + 1 settings tab + 9 modals) and 11 interfaces. The plugin class alone is **1,846 lines** (40% of all code) with **38 methods**. The heaviest modals are `BulkPreviewModal` (719 lines) and `RulesManagementModal` (538 lines). There is **zero automated test coverage** — no testing framework is installed. For context, ~6.8K lines is a mid-sized Obsidian plugin, but having it all in one file makes maintenance increasingly difficult.
