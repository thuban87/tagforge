# Test Coverage Matrix

> **Last Updated:** 2026-02-08 | **Purpose:** At-a-glance view of automated test coverage for pre-launch assessment

---

## Coverage Overview

| Metric | Value |
|---|---|
| **Test Files** | 0 |
| **Testing Framework** | ❌ None installed |
| **Total Functions** | 38 (TagForgePlugin methods) |
| **Functions With Tests** | 0 (0%) |
| **Modals With Tests** | 0 |
| **Total Automated Assertions** | 0 |

> [!CAUTION]
> There is **no automated test infrastructure** at all. No test runner (vitest, jest, mocha) is configured in `package.json`, no test directory exists, and no test files exist anywhere in the project. The only testing documentation is a **manual** test checklist in `docs/Rule System Testing.md`.

---

## Function-Level Coverage

### ❌ No Automated Tests — Full Inventory

Sorted by **risk level** (how impactful a bug would be):

#### 🔴 Critical — Data Integrity Risk

| Function | Why Critical |
|---|---|
| **`applyFrontmatterTags`** | Writes to user's frontmatter — wrong behavior = corrupted notes |
| **`removeAutoTagsFromFile`** | Removes tags from frontmatter — could delete user's manual tags if tracking is wrong |
| **`removeTagsFromFile`** | Removes tags from frontmatter — broader removal than auto-only |
| **`executeBulkApply`** | Applies/removes tags across many files at once — blast radius is entire vault |
| **`applyMoveRetag`** | Removes old tags + applies new on move — wrong behavior = tag loss |
| **`revertAllAutoTags`** | Batch removes all auto-tags — wrong tracking = lost manual tags |
| **`revertAllTagsNuclear`** | Removes ALL tags from ALL files — no undo possible |
| **`getRulesForPath`** | Core tag resolution — wrong rules = wrong tags on every file |
| **`loadSettings`** | Data deserialization — corruption = all settings/tracking lost |
| **`saveSettings`** | Data serialization — corruption = all settings/tracking lost |

#### 🟠 High — Feature Correctness Risk

| Function | Why High Risk |
|---|---|
| **`handleFileRename`** | Complex rename vs. move detection, batch debouncing, undo path tracking |
| **`handleGroupedMoveResult`** | 218-line method handling cancel (file restore + folder cleanup with Windows system file handling) |
| **`handleMoveResult`** | Move result routing — continue/leave/cancel logic |
| **`revertFilesFromDates`** | Date-filtered tag removal with operation history recording |
| **`revertAutoTagsByFolder`** | Folder-scoped revert with recursive file collection |
| **`undoOperation`** | Restores previous tag state — wrong behavior = can't fix mistakes |
| **`getTagsForPath`** | Legacy tag path resolver (pre-Phase 10) |
| **`recordOperation`** | History tracking — lost history = can't undo |
| **`validateTags`** | Detects orphaned tracking, missing tags, ignored-path issues |
| **`fixValidationIssue`** | Auto-fixes validation problems — wrong fix = data corruption |

#### 🟡 Medium — UX / Logic Risk

| Function | Why Medium Risk |
|---|---|
| **`tagCurrentFile`** | Manual tag-current-file command |
| **`handleFileCreate`** | Auto-tag on file creation |
| **`bulkApplyToFolder`** | Folder selection + preview orchestration |
| **`generateEnhancedPreview`** | Computes preview data for bulk modal |
| **`getFolderTagsByLevel`** | Folder-to-tag-level mapping |
| **`getFileTags`** | Reads current frontmatter tags |
| **`hasRulesForPath`** | Simple rule existence check |
| **`folderNameToTag`** | Folder name → tag name conversion |
| **`revertAutoTagsByDate`** | Date picker + revert orchestration |

#### 🟢 Low — Simple / UI-Only

| Function | Why Low Risk |
|---|---|
| **`onload`** | Plugin initialization (command/event registration) |
| **`onunload`** | Timer cleanup |
| **`bulkApplyTags`** | Thin wrapper — calls generateEnhancedPreview + BulkPreviewModal |
| **`showBatchedMoveModal`** | Modal instantiation routing |
| **`applyTagsToFile`** | Thin wrapper around applyFrontmatterTags |
| **`getParentFolder`** | 5-line path utility |
| **`generateOperationId`** | 3-line UUID generator |
| **`showUndoHistory`** | Modal instantiation |
| **`showTagReport`** | Modal instantiation |

---

## Modal Test Coverage

| Modal | Lines | Tested | Risk | Notes |
|---|---|---|---|---|
| **BulkPreviewModal** | 719 | ❌ | 🟠 High | Complex UI with per-file tag editing, rule saving |
| **RulesManagementModal** | 538 | ❌ | 🟠 High | Folder tree rendering, rule CRUD, rule application |
| **TagForgeSettingTab** | 261 | ❌ | 🟡 Medium | Settings display and modification |
| **GroupedMoveConfirmationModal** | 197 | ❌ | 🟡 Medium | Multi-file move with per-file exclusion |
| **TagReportModal** | 190 | ❌ | 🟡 Medium | Tag stats aggregation and display |
| **ValidationResultsModal** | 144 | ❌ | 🟡 Medium | Issue display with fix buttons |
| **UndoHistoryModal** | 143 | ❌ | 🟢 Low | Display-only with undo callback |
| **MoveConfirmationModal** | 127 | ❌ | 🟢 Low | Simple confirmation dialog |
| **DatePickerModal** | 101 | ❌ | 🟢 Low | Date selection UI |
| **FolderPickerModal** | 80 | ❌ | 🟢 Low | Folder list with search filter |

---

## Coverage by Feature Area

| Feature Area | Functions | Tested | Coverage |
|---|---|---|---|
| **Tag Resolution** | getRulesForPath, getTagsForPath, hasRulesForPath, folderNameToTag | 0/4 | ⬜⬜⬜⬜ 0% |
| **Tag Application** | applyTagsToFile, applyFrontmatterTags, executeBulkApply | 0/3 | ⬜⬜⬜ 0% |
| **Tag Removal** | removeAutoTagsFromFile, removeTagsFromFile | 0/2 | ⬜⬜ 0% |
| **File Move Handling** | handleFileRename, handleMoveResult, handleGroupedMoveResult, applyMoveRetag, showBatchedMoveModal | 0/5 | ⬜⬜⬜⬜⬜ 0% |
| **Revert Operations** | revertAllAutoTags, revertAllTagsNuclear, revertAutoTagsByDate, revertFilesFromDates, revertAutoTagsByFolder | 0/5 | ⬜⬜⬜⬜⬜ 0% |
| **Bulk Operations** | bulkApplyTags, bulkApplyToFolder, generateEnhancedPreview, getFolderTagsByLevel | 0/4 | ⬜⬜⬜⬜ 0% |
| **History / Undo** | recordOperation, undoOperation, showUndoHistory, generateOperationId | 0/4 | ⬜⬜⬜⬜ 0% |
| **Validation** | validateTags, fixValidationIssue | 0/2 | ⬜⬜ 0% |
| **Reporting** | showTagReport, getFileTags | 0/2 | ⬜⬜ 0% |
| **Settings / Lifecycle** | loadSettings, saveSettings, onload, onunload | 0/4 | ⬜⬜⬜⬜ 0% |
| **Auto-tagging** | tagCurrentFile, handleFileCreate | 0/2 | ⬜⬜ 0% |
| **Modals** (9 total) | — | 0/9 | ⬜⬜⬜⬜⬜⬜⬜⬜⬜ 0% |

---

## Recommended Test Priorities

### Tier 1 — Critical Data Integrity (must-have before BRAT)

| Target | Why | Effort |
|---|---|---|
| **`getRulesForPath`** | Core rule resolution — every tag decision flows through this. 104 lines of complex path traversal and rule inheritance logic. Pure function, very testable. | Low |
| **`applyFrontmatterTags`** | Writes to frontmatter — a bug here corrupts user notes. Needs Obsidian API mock. | Medium |
| **`removeAutoTagsFromFile`** | Removes specific tags — must not touch user's manual tags. | Medium |
| **`folderNameToTag`** | Tag name derivation — simple, fast to test. | Low |

### Tier 2 — High Impact, Moderate Effort

| Target | Why | Effort |
|---|---|---|
| **`handleFileRename`** | Complex branching: rename vs. move detection, ignored paths, remembered actions, batch debouncing | Medium |
| **`revertAllAutoTags`** | Vault-wide operation — a bug affects every file | Medium |
| **`undoOperation`** | Undo correctness — wrong restore = can't fix mistakes | Medium |
| **`getTagsForPath` / `getFolderTagsByLevel`** | Tag computation logic — pure functions, easy to test | Low |

### Tier 3 — Nice to Have

| Target | Why | Effort |
|---|---|---|
| **`executeBulkApply`** | Orchestrator for bulk ops | Medium |
| **`validateTags`** | Validation logic | Medium |
| **`recordOperation`** | History correctness | Low |
| **`loadSettings` / `saveSettings`** | Data serialization round-trip | Low |

---

## Infrastructure Needed

To add tests, the following would need to be set up:

1. **Install vitest** — `npm install -D vitest`
2. **Add test script** — `"test": "vitest run"` in package.json
3. **Create test directory** — `test/` or `__tests__/`
4. **Mock Obsidian API** — `App`, `Plugin`, `TFile`, `Notice`, `Modal`, `processFrontMatter`
5. **Extract testable functions** — Many TagForgePlugin methods are pure-logic or near-pure-logic and could be extracted into standalone functions for easier testing

> [!TIP]
> The monolithic architecture makes testing harder. The most impactful structural change would be extracting pure-logic functions (like `getRulesForPath`, `getTagsForPath`, `folderNameToTag`, `getParentFolder`) out of the class so they can be imported and tested directly without instantiating the plugin.
