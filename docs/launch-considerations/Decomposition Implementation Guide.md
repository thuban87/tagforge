# main.ts Decomposition — Implementation Guide

> **Last Updated:** 2026-02-10 | **Purpose:** Step-by-step guide for breaking the 4,549-line `main.ts` monolith into a modular `src/` structure

> [!IMPORTANT]
> This guide is designed so any agent can pick it up at any phase and continue. Each phase lists exact source locations, target files, and verification steps. **Always `npm run build` after each phase to verify.**

---

## Pre-Decomposition State

**`main.ts`** contains everything:
- 11 classes (1 plugin + 1 settings tab + 9 modals)
- 11 interfaces + 2 constants
- 4,549 lines total

**`styles.css`** — 2,288 lines — **NOT being decomposed** (not large enough to justify, well-organized with section headers)

---

## Target State

```
tagforge/
├── main.ts                          # Thin entry point (~250 lines)
├── styles.css                       # Unchanged
├── src/
│   ├── types.ts                     # All interfaces + constants (~100 lines)
│   ├── settings.ts                  # TagForgeSettingTab class (~265 lines)
│   ├── services/
│   │   ├── TagResolver.ts           # Tag resolution logic (~170 lines)
│   │   ├── TagIO.ts                 # Frontmatter read/write (~115 lines)
│   │   ├── MoveHandler.ts           # File move orchestration (~425 lines)
│   │   ├── RevertService.ts         # Tag revert operations (~415 lines)
│   │   ├── BulkOperations.ts        # Bulk apply orchestration (~215 lines)
│   │   ├── HistoryService.ts        # Undo/redo tracking (~90 lines)
│   │   └── ValidationService.ts     # Tag integrity checking (~105 lines)
│   └── modals/
│       ├── BulkPreviewModal.ts      # Tag preview/edit (~725 lines)
│       ├── RulesManagementModal.ts   # Folder rules editor (~545 lines)
│       ├── MoveConfirmationModal.ts  # Single-file move (~130 lines)
│       ├── GroupedMoveConfirmationModal.ts  # Batch move (~200 lines)
│       ├── UndoHistoryModal.ts      # History viewer (~150 lines)
│       ├── TagReportModal.ts        # Report dashboard (~195 lines)
│       ├── ValidationResultsModal.ts # Validation results (~150 lines)
│       ├── DatePickerModal.ts       # Date selection (~105 lines)
│       └── FolderPickerModal.ts     # Folder selection (~85 lines)
```

---

## Phase Execution Order

| Phase | What | Lines Moved | main.ts After | Risk | Status |
|-------|------|------------:|:-------------:|------|--------|
| **0** | esbuild config update | 0 | 4,549 | 🟢 None | ✅ Done |
| **1** | Types + constants | ~205 | ~4,345 | 🟢 Low | ✅ Done |
| **2** | Modals | ~2,285 | ~2,060 | 🟢 Low | ✅ Done |
| **3** | Settings tab | ~265 | ~1,795 | 🟢 Low | |
| **4** | Services extraction | ~1,535 | ~260 | 🟠 Medium | |
| **5** | Final cleanup | — | ~250 | 🟢 Low | |

> [!TIP]
> **Do one phase per session.** Build-verify after each. This preserves the ability to git commit between phases for easy rollback.

---

## Phase 0: esbuild Configuration ✅

> **Completed:** 2026-02-10 | **Build Verified:** `main.js` byte-identical (133,994 bytes)

**Goal:** Update the build system to handle multi-file `src/` imports.

### Current esbuild config

The current `esbuild.config.mjs` bundles `main.ts` only. Since esbuild follows imports automatically, no `entryPoints` change is needed — but we need to verify `tsconfig.json` allows `src/` paths.

### Steps

1. **Verify `tsconfig.json`** includes the `src/` directory:
   ```jsonc
   {
     "compilerOptions": {
       // existing options...
       "rootDir": ".",           // Should be root, not just main.ts
       "baseUrl": "."            // Enables non-relative imports if desired
     },
     "include": ["main.ts", "src/**/*.ts"]   // ADD src/**/*.ts
   }
   ```

2. **Create empty `src/` directory structure:**
   ```
   mkdir src
   mkdir src/services
   mkdir src/modals
   ```

3. **Build test:** `npm run build` — should succeed with no changes (nothing imports from `src/` yet)

### Verification
- `npm run build` succeeds
- Output `main.js` is identical to before (no functional change)

---

## Phase 1: Extract Types & Constants ✅

> **Completed:** 2026-02-10 | **Build Verified:** `main.js` 134,023 bytes (+29 from import overhead)

**Goal:** Move all interfaces, type aliases, and top-level constants to `src/types.ts`.

### What to Extract

| Item | Current Lines | Notes |
|------|:---:|-------|
| `interface TagForgeSettings` | L16–34 | 10 fields |
| `interface TagTrackingEntry` | L40–43 | 2 fields |
| `interface FolderRule` | L49–57 | 7 fields |
| `interface OperationFileState` | L63–68 | 4 fields |
| `interface TagOperation` | L70–76 | 5 fields |
| `const MAX_HISTORY_SIZE` | L78 | Used by HistoryService |
| `interface TagForgeData` | L80–85 | Top-level data structure |
| `const DEFAULT_SETTINGS` | L91–102 | Default values |
| `const DEFAULT_DATA` | L104–109 | Default data |
| `const WINDOWS_SYSTEM_FILES` | L4 | Used by MoveHandler |
| `interface ValidationIssue` | L1966–1971 | Between classes |
| `interface EnhancedPreviewItem` | L1977–1982 | Between classes |
| `interface MoveConfirmationResult` | L2899–2902 | Between classes |
| `interface PendingMoveOperation` | L2904–2909 | Between classes |
| `interface GroupedMoveResult` | L2911–2915 | Between classes |
| `const UNDO_FILE_DISPLAY_LIMIT` | L3517 | Used by UndoHistoryModal |

> [!IMPORTANT]
> **Every type, interface, and constant must be explicitly `export`-ed.** Even if a type isn't referenced by `main.ts` directly today, services, modals, and future tests will need them. `TagForgeData` in particular is essential for the `loadSettings`/`saveSettings` flow that stays in the main class.

### Creating `src/types.ts`

```typescript
// src/types.ts
// All shared types, interfaces, and constants for TagForge

import { TFile } from 'obsidian';

// ============================================================================
// Settings
// ============================================================================

export interface TagForgeSettings {
    // ... (copy L16–34 exactly)
}

// ... (all other interfaces — every one gets `export`)

// ============================================================================
// Constants
// ============================================================================

export const WINDOWS_SYSTEM_FILES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);
export const MAX_HISTORY_SIZE = 50;
export const UNDO_FILE_DISPLAY_LIMIT = 40;

export const DEFAULT_SETTINGS: TagForgeSettings = {
    // ... (copy L91–102 exactly)
};

export const DEFAULT_DATA: TagForgeData = {
    // ... (copy L104–109 exactly)
};
```

### Updating `main.ts`

Replace all the removed blocks with a single import:

```typescript
import {
    TagForgeSettings, TagTrackingEntry, FolderRule, OperationFileState,
    TagOperation, TagForgeData, ValidationIssue, EnhancedPreviewItem,
    MoveConfirmationResult, PendingMoveOperation, GroupedMoveResult,
    WINDOWS_SYSTEM_FILES, MAX_HISTORY_SIZE, UNDO_FILE_DISPLAY_LIMIT,
    DEFAULT_SETTINGS, DEFAULT_DATA,
} from './src/types';
```

### Verification
- `npm run build` succeeds
- All interfaces are accessible from `main.ts` via imports
- No runtime behavior change

---

## Phase 2: Extract Modals ✅

> **Completed:** 2026-02-10 | **Build Verified:** `main.js` 134,916 bytes | **main.ts:** 4,416 → 2,141 lines

### Important Pattern

Every modal needs to import `TagForgePlugin` from `main.ts`. However, that creates a circular dependency since `main.ts` imports modals. **Solution:** Use a type-only import for the plugin in modals.

```typescript
// In each modal file:
import type TagForgePlugin from '../../main';
```

Alternatively, define a `PluginInterface` in `types.ts` that modals depend on instead of the concrete class. Since the modals only access specific properties/methods, this is cleaner for testability. **However, this adds complexity — start with `import type` and refactor later if needed.**

### Extraction Order (simplest → most complex)

Extract in this order to minimize issues:

#### 2a. FolderPickerModal (80 lines, no plugin dependency)

**Source:** L2708–2787
**Target:** `src/modals/FolderPickerModal.ts`

This modal doesn't depend on `TagForgePlugin` at all — it receives `folders` and `onSelect` callback.

```typescript
// src/modals/FolderPickerModal.ts
import { App, Modal } from 'obsidian';

export class FolderPickerModal extends Modal {
    // ... (copy L2708–2787 from main.ts)
}
```

**Update main.ts:** Replace class with `import { FolderPickerModal } from './src/modals/FolderPickerModal';`

#### 2b. DatePickerModal (101 lines, no plugin dependency)

**Source:** L2793–2893
**Target:** `src/modals/DatePickerModal.ts`

```typescript
// src/modals/DatePickerModal.ts
import { App, Modal } from 'obsidian';

export class DatePickerModal extends Modal {
    // ... (copy L2793–2893 from main.ts)
}
```

#### 2c. UndoHistoryModal (143 lines, no plugin dependency)

**Source:** L3519–3661 (includes `UNDO_FILE_DISPLAY_LIMIT` usage)
**Target:** `src/modals/UndoHistoryModal.ts`

```typescript
// src/modals/UndoHistoryModal.ts
import { App, Modal } from 'obsidian';
import { TagOperation, UNDO_FILE_DISPLAY_LIMIT } from '../types';

export class UndoHistoryModal extends Modal {
    // ... (copy L3519–3661 from main.ts)
}
```

#### 2d. MoveConfirmationModal (127 lines, uses plugin)

**Source:** L2917–3043
**Target:** `src/modals/MoveConfirmationModal.ts`

```typescript
// src/modals/MoveConfirmationModal.ts
import { App, Modal, TFile } from 'obsidian';
import type TagForgePlugin from '../../main';
import { MoveConfirmationResult } from '../types';

export class MoveConfirmationModal extends Modal {
    // ... (copy L2917–3043 from main.ts)
}
```

#### 2e. GroupedMoveConfirmationModal (197 lines, uses plugin)

**Source:** L3049–3245
**Target:** `src/modals/GroupedMoveConfirmationModal.ts`

```typescript
import { App, Modal, Notice } from 'obsidian';
import type TagForgePlugin from '../../main';
import { PendingMoveOperation, GroupedMoveResult } from '../types';

export class GroupedMoveConfirmationModal extends Modal {
    // ... (copy L3049–3245 from main.ts)
}
```

#### 2f. ValidationResultsModal (144 lines, uses plugin)

**Source:** L3862–4005
**Target:** `src/modals/ValidationResultsModal.ts`

```typescript
import { App, Modal, Notice } from 'obsidian';
import type TagForgePlugin from '../../main';
import { ValidationIssue } from '../types';

export class ValidationResultsModal extends Modal {
    // ... (copy L3862–4005 from main.ts)
}
```

#### 2g. TagReportModal (190 lines, uses plugin)

**Source:** L3667–3856
**Target:** `src/modals/TagReportModal.ts`

```typescript
import { App, Modal } from 'obsidian';
import type TagForgePlugin from '../../main';

export class TagReportModal extends Modal {
    // ... (copy L3667–3856 from main.ts)
}
```

#### 2h. BulkPreviewModal (719 lines, uses plugin heavily)

**Source:** L1984–2702 (includes `EnhancedPreviewItem` usage)
**Target:** `src/modals/BulkPreviewModal.ts`

```typescript
import { App, Modal, Notice, TFile } from 'obsidian';
import type TagForgePlugin from '../../main';
import { EnhancedPreviewItem, FolderRule } from '../types';

export class BulkPreviewModal extends Modal {
    // ... (copy L1984–2702 from main.ts)
}
```

> [!NOTE]
> This modal accesses `plugin.settings`, `plugin.folderRules`, `plugin.getRulesForPath()`, `plugin.getTagsForPath()`, and `plugin.saveSettings()`. All of these remain on `TagForgePlugin` after extraction, so `import type` works.

#### 2i. RulesManagementModal (538 lines, uses plugin heavily)

**Source:** L4011–4548
**Target:** `src/modals/RulesManagementModal.ts`

```typescript
import { App, Modal, Notice, TFile, TFolder, Setting } from 'obsidian';
import type TagForgePlugin from '../../main';
import { FolderRule } from '../types';

export class RulesManagementModal extends Modal {
    // ... (copy L4011–4548 from main.ts)
}
```

### Updating `main.ts` After All Modal Extractions

Add imports at the top:

```typescript
import { FolderPickerModal } from './src/modals/FolderPickerModal';
import { DatePickerModal } from './src/modals/DatePickerModal';
import { UndoHistoryModal } from './src/modals/UndoHistoryModal';
import { MoveConfirmationModal } from './src/modals/MoveConfirmationModal';
import { GroupedMoveConfirmationModal } from './src/modals/GroupedMoveConfirmationModal';
import { ValidationResultsModal } from './src/modals/ValidationResultsModal';
import { TagReportModal } from './src/modals/TagReportModal';
import { BulkPreviewModal } from './src/modals/BulkPreviewModal';
import { RulesManagementModal } from './src/modals/RulesManagementModal';
```

Remove all the class blocks and their preceding section-comment headers from main.ts.

### Verification
- `npm run build` succeeds
- All 10 commands still work (each one instantiates a modal)
- No circular dependency warnings

---

## Phase 3: Extract Settings Tab ✅

**Status:** Complete (2026-02-10)

**Goal:** Move `TagForgeSettingTab` to `src/settings.ts`.

**Source:** L1880–2141 (post-Phase 2 line numbers)
**Target:** `src/settings.ts`

```typescript
// src/settings.ts
import { App, PluginSettingTab, Setting, Notice, TFolder } from 'obsidian';
import type TagForgePlugin from '../main';
import { TagForgeSettings } from './types';
import { RulesManagementModal } from './modals/RulesManagementModal';

export class TagForgeSettingTab extends PluginSettingTab {
    plugin: TagForgePlugin;

    constructor(app: App, plugin: TagForgePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        // ... (copy L1888–2140)
    }
}
```

> **Note:** Guide originally didn't list `RulesManagementModal` as a needed import, but the settings tab instantiates it. `TFolder` was added for folder alias autocomplete.

### Update main.ts

```typescript
import { TagForgeSettingTab } from './src/settings';
```

Also remove `PluginSettingTab` and `Setting` from the Obsidian import (no longer used in main.ts).

### Verification
- `npm run build` succeeds
- Settings tab opens and all settings render correctly
- Changing settings persists properly
- Folder alias autocomplete shows vault folders

---

## Phase 4: Extract Services

**Goal:** Move business logic methods out of `TagForgePlugin` into service classes.

> [!WARNING]
> This is the most complex phase. Services need access to plugin state (`this.settings`, `this.tagTracking`, `this.folderRules`, `this.operationHistory`). The pattern is to pass the plugin instance to each service.

### Service Pattern

Each service receives the plugin instance:

```typescript
// src/services/ExampleService.ts
import type TagForgePlugin from '../../main';

export class ExampleService {
    constructor(private plugin: TagForgePlugin) {}

    // Methods access plugin state via this.plugin.settings, etc.
}
```

In `main.ts`, services are initialized in `onload()`:

```typescript
// In TagForgePlugin.onload():
this.tagResolver = new TagResolver(this);
this.tagIO = new TagIO(this);
// ...
```

### 4a. TagResolver (pure logic, safest to start with)

**Source Methods:**
| Method | Lines | Notes |
|--------|:---:|-------|
| `getRulesForPath` | L1569–1672 | Core rule resolution, calls `folderNameToTag` |
| `getTagsForPath` | L1514–1563 | Legacy path-based resolution, calls `folderNameToTag` |
| `hasRulesForPath` | L1674–1680 | Simple existence check |
| `folderNameToTag` | L1682–1689 | Name conversion utility |

**Target:** `src/services/TagResolver.ts` (~170 lines)

**Reads from plugin:** `this.plugin.settings` (ignorePaths, inheritDepth, folderAliases, folderMappings), `this.plugin.folderRules`

```typescript
// src/services/TagResolver.ts
import type TagForgePlugin from '../../main';

export class TagResolver {
    constructor(private plugin: TagForgePlugin) {}

    getRulesForPath(filePath: string): string[] {
        // ... (move L1569–1672, replace this.settings → this.plugin.settings,
        //      this.folderRules → this.plugin.folderRules,
        //      this.folderNameToTag → this.folderNameToTag)
    }

    getTagsForPath(filePath: string): string[] {
        // ... (move L1514–1563)
    }

    hasRulesForPath(filePath: string): boolean {
        // ... (move L1674–1680)
    }

    folderNameToTag(folderName: string): string {
        // ... (move L1682–1689)
    }
}
```

**Update main.ts:**
- Add `tagResolver: TagResolver;` field
- Initialize in `onload()`: `this.tagResolver = new TagResolver(this);`
- Replace all `this.getRulesForPath(...)` → `this.tagResolver.getRulesForPath(...)`
- Replace all `this.getTagsForPath(...)` → `this.tagResolver.getTagsForPath(...)`
- Same for `hasRulesForPath` and `folderNameToTag`

> [!IMPORTANT]
> **No proxy methods.** Modals that call `plugin.getRulesForPath()` or `plugin.getTagsForPath()` (BulkPreviewModal, RulesManagementModal, MoveConfirmationModal, GroupedMoveConfirmationModal) must be updated to call through the service directly:
> - `plugin.getRulesForPath(...)` → `plugin.tagResolver.getRulesForPath(...)`
> - `plugin.getTagsForPath(...)` → `plugin.tagResolver.getTagsForPath(...)`
>
> This is ~6-8 call sites across 4 modal files. Update them during this phase rather than adding proxy methods — proxies defeat the purpose of slimming down `main.ts`.

### 4b. TagIO (Obsidian API interaction)

**Source Methods:**
| Method | Lines |
|--------|:---:|
| `applyTagsToFile` | L1691–1711 |
| `applyFrontmatterTags` | L1713–1739 |
| `removeAutoTagsFromFile` | L821–840 |
| `removeTagsFromFile` | L842–872 |
| `getFileTags` | L1749–1760 |

**Target:** `src/services/TagIO.ts` (~115 lines)

**Needs from plugin:** `this.plugin.app` (for `fileManager.processFrontMatter`, `metadataCache`), `this.plugin.settings` (for `protectedTags`), `this.plugin.tagTracking`

```typescript
// src/services/TagIO.ts
import { TFile } from 'obsidian';
import type TagForgePlugin from '../../main';

export class TagIO {
    constructor(private plugin: TagForgePlugin) {}

    async applyTagsToFile(filePath: string, tags: string[]) { /* ... */ }
    async applyFrontmatterTags(filePath: string, tags: string[]) { /* ... */ }
    async removeAutoTagsFromFile(file: TFile, tagsToRemove: string[]) { /* ... */ }
    async removeTagsFromFile(file: TFile, tagsToRemove: string[]) { /* ... */ }
    async getFileTags(file: TFile): Promise<string[]> { /* ... */ }
}
```

**Update main.ts:** Replace `this.applyTagsToFile(...)` → `this.tagIO.applyTagsToFile(...)` etc.

### 4c. HistoryService

**Source Methods:**
| Method | Lines |
|--------|:---:|
| `generateOperationId` | L1745–1747 |
| `recordOperation` | L1762–1784 |
| `undoOperation` | L1797–1846 |

**Target:** `src/services/HistoryService.ts` (~90 lines)

**Needs from plugin:** `this.plugin.operationHistory`, `this.plugin.tagIO` (for `getFileTags`, `removeTagsFromFile`, `applyTagsToFile`), `this.plugin.app`

```typescript
// src/services/HistoryService.ts
import { TFile, Notice } from 'obsidian';
import type TagForgePlugin from '../../main';
import { TagOperation, OperationFileState, MAX_HISTORY_SIZE } from '../types';

export class HistoryService {
    constructor(private plugin: TagForgePlugin) {}

    generateOperationId(): string { /* ... */ }
    async recordOperation(type: TagOperation['type'], description: string, files: OperationFileState[]) { /* ... */ }
    async undoOperation(operation: TagOperation) { /* ... */ }
}
```

### 4d. ValidationService

**Source Methods:**
| Method | Lines |
|--------|:---:|
| `validateTags` | L1860–1922 |
| `fixValidationIssue` | L1924–1959 |

**Target:** `src/services/ValidationService.ts` (~105 lines)

**Needs from plugin:** `this.plugin.tagTracking`, `this.plugin.settings`, `this.plugin.app`, `this.plugin.tagIO`

### 4e. BulkOperations

**Source Methods:**
| Method | Lines |
|--------|:---:|
| `bulkApplyTags` | L1296–1308 |
| `bulkApplyToFolder` | L1310–1374 |
| `generateEnhancedPreview` | L1376–1417 |
| `getFolderTagsByLevel` | L1419–1449 |
| `executeBulkApply` | L1451–1512 |

**Target:** `src/services/BulkOperations.ts` (~215 lines)

**Needs from plugin:** `this.plugin.app`, `this.plugin.tagResolver`, `this.plugin.tagIO`, `this.plugin.historyService`, `this.plugin.settings`, `this.plugin.tagTracking`

### 4f. RevertService

**Source Methods:**
| Method | Lines |
|--------|:---:|
| `revertAllAutoTags` | L880–985 |
| `revertAllTagsNuclear` | L987–1055 |
| `revertAutoTagsByDate` | L1057–1082 |
| `revertFilesFromDates` | L1084–1172 |
| `revertAutoTagsByFolder` | L1174–1290 |

**Target:** `src/services/RevertService.ts` (~415 lines)

**Needs from plugin:** `this.plugin.app`, `this.plugin.tagIO`, `this.plugin.historyService`, `this.plugin.tagTracking`, `this.plugin.settings`

> [!NOTE]
> `revertAutoTagsByDate` opens a `DatePickerModal`, and `revertAutoTagsByFolder` opens a `FolderPickerModal`. These modal imports need to come from `../modals/`.

### 4g. MoveHandler (most complex, do last)

**Source Methods:**
| Method | Lines |
|--------|:---:|
| `handleFileRename` | L394–496 |
| `showBatchedMoveModal` | L498–531 |
| `handleGroupedMoveResult` | L533–750 |
| `handleMoveResult` | L752–789 |
| `applyMoveRetag` | L791–819 |

**Target:** `src/services/MoveHandler.ts` (~425 lines)

**Needs from plugin:** Almost everything — `this.plugin.app`, `this.plugin.settings`, `this.plugin.tagTracking`, `this.plugin.tagResolver`, `this.plugin.tagIO`, `this.plugin.historyService`, plus plugin state fields (`pendingUndoPath`, `pendingUndoPaths`, `pendingMoves`, `pendingMoveTimeout`, `pendingFileOps`)

> [!WARNING]
> **MoveHandler accesses mutable state fields** on the plugin: `pendingUndoPath`, `pendingUndoPaths`, `pendingMoves`, `pendingMoveTimeout`. These could either:
> 1. **Stay on the plugin** (MoveHandler reads/writes them via `this.plugin.pendingUndoPath`)
> 2. **Move to MoveHandler** as local state (cleaner, but `onunload()` cleanup logic needs updating)
>
> **Recommended:** Move the pending state fields into `MoveHandler` and expose a `cleanup()` method that `onunload()` calls.

### Service Initialization Order

Add to `main.ts`:

```typescript
// Fields
tagResolver: TagResolver;
tagIO: TagIO;
historyService: HistoryService;
validationService: ValidationService;
bulkOperations: BulkOperations;
revertService: RevertService;
moveHandler: MoveHandler;

// In onload(), after loadSettings():
this.tagResolver = new TagResolver(this);
this.tagIO = new TagIO(this);
this.historyService = new HistoryService(this);
this.validationService = new ValidationService(this);
this.bulkOperations = new BulkOperations(this);
this.revertService = new RevertService(this);
this.moveHandler = new MoveHandler(this);
```

### Verification for Phase 4
- `npm run build` succeeds
- Test each command (all 10) manually in Obsidian
- Verify move handling: move a file, check modal appears, test Continue/Leave/Cancel
- Verify bulk apply: select a folder, preview renders correctly
- Verify undo: perform an operation, undo it
- Verify validation: run validate command

---

## Phase 5: Final Cleanup

**Goal:** Clean up `main.ts` to be a thin entry point.

### What Remains in main.ts (~250 lines)

```typescript
import { Plugin, TFile, Notice, Platform } from 'obsidian';
import { TagForgeSettings, TagTrackingEntry, FolderRule, TagOperation,
         TagForgeData, DEFAULT_SETTINGS, DEFAULT_DATA, PendingMoveOperation } from './src/types';
import { TagForgeSettingTab } from './src/settings';
import { TagResolver } from './src/services/TagResolver';
import { TagIO } from './src/services/TagIO';
import { HistoryService } from './src/services/HistoryService';
import { ValidationService } from './src/services/ValidationService';
import { BulkOperations } from './src/services/BulkOperations';
import { RevertService } from './src/services/RevertService';
import { MoveHandler } from './src/services/MoveHandler';
import { UndoHistoryModal } from './src/modals/UndoHistoryModal';
import { TagReportModal } from './src/modals/TagReportModal';

export default class TagForgePlugin extends Plugin {
    // Data
    settings: TagForgeSettings;
    tagTracking: Record<string, TagTrackingEntry>;
    operationHistory: TagOperation[];
    folderRules: Record<string, FolderRule>;

    // Services
    tagResolver: TagResolver;
    tagIO: TagIO;
    historyService: HistoryService;
    validationService: ValidationService;
    bulkOperations: BulkOperations;
    revertService: RevertService;
    moveHandler: MoveHandler;

    async onload() {
        await this.loadSettings();
        this.initializeServices();
        this.addSettingTab(new TagForgeSettingTab(this.app, this));
        this.registerCommands();
        this.registerRibbonIcons();
        this.registerEventHandlers();
    }

    onunload() {
        this.moveHandler.cleanup();
    }

    // Settings management (loadSettings, saveSettings)
    // Command registration (10 commands)
    // Ribbon icons (2)
    // Event handlers (create, rename)
    // Simple entry points: tagCurrentFile, handleFileCreate, showTagReport, showUndoHistory
    // Utility: getParentFolder
}
```

### Cleanup Steps

1. **Group command registration** into a private `registerCommands()` method
2. **Group ribbon icons** into a private `registerRibbonIcons()` method
3. **Group event handlers** into a private `registerEventHandlers()` method
4. **Update `CLAUDE.md`** with the new file tree
5. **Update `Codebase Stats.md`** with new file counts and line distribution

### Verification
- `npm run build` succeeds
- Complete manual test of all 10 commands
- Deploy to production vault, test for 24 hours
- Verify file create auto-tagging
- Verify file move modal appears

---

## Cross-Cutting Concerns

### Circular Dependency Prevention

The `import type` pattern avoids circular dependencies:
- `main.ts` → `import { ModalClass } from './src/modals/...'` (value import)
- `src/modals/*.ts` → `import type TagForgePlugin from '../../main'` (type-only import, erased at runtime)
- `src/services/*.ts` → `import type TagForgePlugin from '../../main'` (type-only import)

esbuild handles this correctly — `import type` is removed during compilation.

### Service Cross-Dependencies

Some services call other services (e.g., `RevertService` needs `TagIO` and `HistoryService`). Since all services are accessed through `this.plugin`, this works naturally:

```typescript
// In RevertService:
await this.plugin.tagIO.removeAutoTagsFromFile(file, tags);
await this.plugin.historyService.recordOperation('revert', desc, files);
```

### `this` → `this.plugin` Refactoring

When moving methods from TagForgePlugin to a service, every `this.xyz` reference needs to become `this.plugin.xyz`:

| Before (in plugin) | After (in service) |
|---|---|
| `this.settings` | `this.plugin.settings` |
| `this.tagTracking` | `this.plugin.tagTracking` |
| `this.folderRules` | `this.plugin.folderRules` |
| `this.operationHistory` | `this.plugin.operationHistory` |
| `this.app` | `this.plugin.app` |
| `this.saveSettings()` | `this.plugin.saveSettings()` |
| `this.otherMethod()` | `this.methodOnThisService()` or `this.plugin.otherService.method()` |

### Node.js Requires

The `fs` and `path` `require()` statements at the top of `main.ts` (L7–L10) are only used by `MoveHandler.handleGroupedMoveResult()` for folder cleanup. Move these requires into `MoveHandler.ts`:

```typescript
// src/services/MoveHandler.ts
const fs = require('fs') as typeof import('fs');
const nodePath = require('path') as typeof import('path');
```

---

## Rollback Strategy

If any phase breaks, revert to the last working state:

1. `git diff` to see what changed
2. `git checkout -- main.ts` to restore main.ts
3. Delete any new `src/` files created during the failed phase
4. `npm run build` to verify clean state

> [!IMPORTANT]
> **Commit after each successful phase.** This gives clean rollback points. Suggested commit messages:
> - Phase 0: `refactor: configure build system for multi-file architecture`
> - Phase 1: `refactor: extract types and constants to src/types.ts`
> - Phase 2: `refactor: extract 9 modal classes to src/modals/`
> - Phase 3: `refactor: extract settings tab to src/settings.ts`
> - Phase 4: `refactor: extract 7 service classes from TagForgePlugin`
> - Phase 5: `refactor: clean up main.ts as thin entry point`
