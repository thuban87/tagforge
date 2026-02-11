# Obsidian Plugin Guidelines — Compliance Remediation Guide

**Created:** 2026-02-10
**Updated:** 2026-02-10 (all decisions finalized, peer review incorporated)
**Purpose:** Fix all violations found during audit against Obsidian's [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) and [Submission Requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)
**Audit Result:** 12 findings (4 critical, 3 high, 5 medium) — all decisions finalized

---

## Table of Contents

1. [CRITICAL-1: innerHTML Security Violation](#critical-1-innerhtml-security-violation)
2. [CRITICAL-2: Node.js require() Without Mobile Guard](#critical-2-nodejs-require-without-mobile-guard)
3. [CRITICAL-3: Settings Headings Use createEl Instead of setHeading()](#critical-3-settings-headings-use-createel-instead-of-setheading)
4. [CRITICAL-4: Settings Headings Use Title Case Instead of Sentence Case](#critical-4-settings-headings-use-title-case-instead-of-sentence-case)
5. [HIGH-1: Inline Styles Instead of CSS Classes](#high-1-inline-styles-instead-of-css-classes)
6. [HIGH-2: Hardcoded Colors in CSS](#high-2-hardcoded-colors-in-css)
7. [HIGH-3: Command ID Redundantly Includes Plugin ID](#high-3-command-id-redundantly-includes-plugin-id)
8. [MEDIUM-1: document.addEventListener Leak in Settings](#medium-1-documentaddeventlistener-leak-in-settings)
9. [MEDIUM-2: Internal API Access via vault.adapter](#medium-2-internal-api-access-via-vaultadapter)
10. [MEDIUM-3: minAppVersion Set to 1.0.0](#medium-3-minappversion-set-to-100)
11. [MEDIUM-4: Manifest Description Missing Period](#medium-4-manifest-description-missing-period)
12. [MEDIUM-5: Unregistered Timers in MoveHandler and GroupedMoveConfirmationModal](#medium-5-unregistered-timers-in-movehandler-and-groupedmoveconfirmationmodal)

---

## Decisions Summary

All questions have been answered. Here are the finalized decisions:

| Item | Decision |
|------|----------|
| CRITICAL-2 (Node.js require) | **Option C** — Replace with Vault Adapter API (cross-platform, cleanest) |
| CRITICAL-3 (Core Settings heading) | **Remove it** — Treat as general settings section, no heading |
| HIGH-1 (tree depth indentation) | **Option 1** — CSS custom property (`--tree-depth`) |
| HIGH-3 (command ID change) | **Confirmed safe** — No existing hotkey bindings to break |
| MEDIUM-3 (minAppVersion) | **Set to `1.7.0`** — Covers recent major API updates |

---

## CRITICAL-1: innerHTML Security Violation

**Guideline:** "Never use `innerHTML`, `outerHTML`, or `insertAdjacentHTML` with user input. Instead, use DOM APIs like `createEl()` to prevent code injection attacks."

**File:** `src/modals/BulkPreviewModal.ts`
**Line:** 477

### Current Code (Unsafe)

```typescript
// Lines 469-477
// Normal mode: show tags as text, with strikethrough for deletions
const tagsWithStatus = item.currentTags.map(t => {
    if (deletionsForFile.has(t)) {
        return `<s>#${t}</s>`;
    }
    return '#' + t;
});
const tagSpan = tagsEl.createSpan({ cls: 'bbab-tf-tag-current' });
tagSpan.innerHTML = tagsWithStatus.join(' ');
```

### Why It's a Problem

`currentTags` comes from user file frontmatter (read from `metadataCache.getFileCache(file)`). If someone manually edits their YAML frontmatter to include HTML like `<img src=x onerror="alert('xss')">` as a tag name, that HTML would execute when rendered in the Bulk Preview Modal.

### Replacement Code

Replace lines 469-477 with:

```typescript
// Normal mode: show tags as text, with strikethrough for deletions
const tagSpan = tagsEl.createSpan({ cls: 'bbab-tf-tag-current' });
for (let i = 0; i < item.currentTags.length; i++) {
    const t = item.currentTags[i];
    if (deletionsForFile.has(t)) {
        const strikeEl = tagSpan.createEl('s');
        strikeEl.textContent = '#' + t;
    } else {
        tagSpan.createSpan({ text: '#' + t });
    }
    // Add space between tags
    if (i < item.currentTags.length - 1) {
        tagSpan.appendText(' ');
    }
}
```

### Verification

After fixing, search entire codebase for any remaining `innerHTML`, `outerHTML`, or `insertAdjacentHTML` usage:
```
grep -r "innerHTML\|outerHTML\|insertAdjacentHTML" src/ main.ts
```
Should return zero results.

---

## CRITICAL-2: Node.js require() Without Mobile Guard

**Guideline:** "If your plugin uses any of these APIs, set `isDesktopOnly` to `true` in `manifest.json`: `fs`, `crypto`, `path`, `os`... Many Node.js features have Web API alternatives."

**File:** `src/services/MoveHandler.ts`
**Lines:** 11-15 (declarations), 317-395 (usage)

**Decision: Option C — Replace with Vault Adapter API**

### Current Code (Crashes on Mobile)

```typescript
// Lines 11-15 — Top-level require, executes on ALL platforms
const fs = require('fs') as typeof import('fs');
const nodePath = require('path') as typeof import('path');
```

These are used in the cancel-move folder cleanup logic (lines 315-395) for:
- `nodePath.join()` — constructing filesystem paths
- `fs.existsSync()` — checking if folders exist
- `fs.readdirSync()` — listing folder contents
- `fs.unlinkSync()` — deleting Windows system files (`desktop.ini`, `Thumbs.db`)
- `fs.rmdirSync()` — removing empty folders

Also problematic: **Line 317** accesses an undocumented internal API:
```typescript
const vaultBasePath = (this.plugin.app.vault.adapter as any).basePath as string;
```

### Implementation

**Step 1 — Remove the Node.js imports entirely (lines 11-15):**

Delete these lines:
```typescript
// Node.js modules (loaded at runtime in Electron)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodePath = require('path') as typeof import('path');
```

**Step 2 — Replace the entire cleanup block (lines 314-395) with Vault Adapter API calls:**

```typescript
// Clean up empty destination folders after a delay (let filesystem sync)
setTimeout(async () => {
    const adapter = this.plugin.app.vault.adapter;
    let totalDeleted = 0;
    let deletedThisRound = 0;
    let maxRounds = 10;

    do {
        deletedThisRound = 0;
        // Sort by path length (deepest first) to delete children before parents
        const sortedFolders = Array.from(destFoldersToCleanup).sort((a, b) => b.length - a.length);

        for (const folderPath of sortedFolders) {
            try {
                const listing = await adapter.list(folderPath);
                // Filter out Windows system files
                const realFiles = listing.files.filter(f => {
                    const name = f.split('/').pop()?.toLowerCase() || '';
                    return !WINDOWS_SYSTEM_FILES.has(name);
                });
                const realFolders = listing.folders;

                if (realFiles.length === 0 && realFolders.length === 0) {
                    // Delete system files first
                    for (const sysFile of listing.files) {
                        try { await adapter.remove(sysFile); } catch { /* ignore */ }
                    }
                    await adapter.rmdir(folderPath, false);
                    destFoldersToCleanup.delete(folderPath);
                    deletedThisRound++;
                    totalDeleted++;
                }
            } catch {
                // Folder may not exist or other error — skip
            }
        }
        maxRounds--;
    } while (deletedThisRound > 0 && maxRounds > 0);

    if (totalDeleted > 0) {
        new Notice(`Cleaned up ${totalDeleted} empty folder${totalDeleted > 1 ? 's' : ''}`);
    }
}, 500);
```

This approach:
- Removes ALL `require('fs')` and `require('path')` imports
- Removes the `(vault.adapter as any).basePath` access (resolves MEDIUM-2 automatically)
- Works on both desktop and mobile
- Uses `adapter.list()` / `adapter.rmdir()` / `adapter.remove()` (all cross-platform Obsidian APIs)
- Keeps the same retry/deepest-first deletion logic

### Verification

After fixing, search for any remaining Node.js requires:
```
grep -r "require(" src/ main.ts
```
Should return zero results (or only Obsidian-safe requires).

---

## CRITICAL-3: Settings Headings Use createEl Instead of setHeading()

**Guideline:** "Use `setHeading()` instead of HTML heading elements in the settings tab."
**Also:** "General settings are at the top and don't have a heading."

**File:** `src/settings.ts`

**Decision: Remove the "Core Settings" heading entirely (treat as general settings).**

### All Violations

| Line | Current Code | Action |
|------|-------------|--------|
| 20 | `containerEl.createEl('h1', { text: 'TagForge Settings' });` | **Remove entirely** — settings tab already shows plugin name |
| 30 | `containerEl.createEl('h2', { text: 'Core Settings' });` | **Remove entirely** — general settings don't get a heading |
| 94 | `containerEl.createEl('h2', { text: 'Folder Rules' });` | Replace with `setHeading()` |
| 115 | `containerEl.createEl('h2', { text: 'Ignore Paths' });` | Replace with `setHeading()` |
| 139 | `containerEl.createEl('h2', { text: 'Protected Tags' });` | Replace with `setHeading()` |
| 163 | `containerEl.createEl('h2', { text: 'Folder Aliases' });` | Replace with `setHeading()` |
| 311 | `containerEl.createEl('h2', { text: 'Quick Start' });` | Replace with `setHeading()` |

### Detailed Changes

**Line 20 — Remove the h1 entirely.**

```typescript
// DELETE this line:
containerEl.createEl('h1', { text: 'TagForge Settings' });

// KEEP the description paragraph (lines 21-24) — it provides context at the top:
containerEl.createEl('p', {
    text: 'Automatic hierarchical tag management based on folder structure.',
    cls: 'bbab-tf-description',
});
```

**Line 30 — Remove the "Core Settings" heading entirely.**

```typescript
// DELETE this line:
containerEl.createEl('h2', { text: 'Core Settings' });

// The settings that follow (auto-tagging toggle, inheritance depth, move behavior)
// are the "general" settings and should appear at the top with no heading.
```

**Lines 94, 115, 139, 163, 311 — Replace each `createEl('h2', ...)` with `setHeading()`.**

```typescript
// Line 94 — was: containerEl.createEl('h2', { text: 'Folder Rules' });
new Setting(containerEl).setName('Folder rules').setHeading();

// Line 115 — was: containerEl.createEl('h2', { text: 'Ignore Paths' });
new Setting(containerEl).setName('Ignore paths').setHeading();

// Line 139 — was: containerEl.createEl('h2', { text: 'Protected Tags' });
new Setting(containerEl).setName('Protected tags').setHeading();

// Line 163 — was: containerEl.createEl('h2', { text: 'Folder Aliases' });
new Setting(containerEl).setName('Folder aliases').setHeading();

// Line 311 — was: containerEl.createEl('h2', { text: 'Quick Start' });
new Setting(containerEl).setName('Quick start').setHeading();
```

### Section Descriptions

The description paragraphs after each heading (created with `containerEl.createEl('p', ...)`) can stay as-is. They still work fine visually after a `setHeading()` call.

Alternatively, you can fold them into the heading Setting with `setDesc()`:
```typescript
new Setting(containerEl)
    .setName('Folder rules')
    .setDesc('Set up rules to automatically tag new files based on their folder location.')
    .setHeading();
```
Either approach is acceptable. Keeping the `createEl('p')` lines is less work.

### Verification

After fixing, search for any remaining raw heading elements:
```
grep -n "createEl('h[1-6]'" src/settings.ts
```
Should return zero results.

---

## CRITICAL-4: Settings Headings Use Title Case Instead of Sentence Case

**Guideline:** "Use sentence case for headings (e.g., 'Template folder location' not 'Template Folder Location')."

This is resolved as part of CRITICAL-3 above. All the replacement strings already use sentence case. For reference:

| Current (Title Case) | Corrected (Sentence Case) |
|---------------------|--------------------------|
| Core Settings | *(removed — general section)* |
| Folder Rules | Folder rules |
| Ignore Paths | Ignore paths |
| Protected Tags | Protected tags |
| Folder Aliases | Folder aliases |
| Quick Start | Quick start |

**Also check the "Folder Rule" h3 in BulkPreviewModal.ts:**

**File:** `src/modals/BulkPreviewModal.ts`
**Line:** 220

```typescript
// Current:
ruleSection.createEl('h3', { text: 'Folder Rule' });

// This is inside a modal, not settings, so the setHeading() guideline
// doesn't apply. But for consistency, sentence case it:
ruleSection.createEl('h3', { text: 'Folder rule' });
```

---

## HIGH-1: Inline Styles Instead of CSS Classes

**Guideline:** "Avoid hardcoded inline styles. Use CSS classes with Obsidian's CSS variables for theme compatibility."

### All Inline Style Violations

#### A. `settings.ts` — Suggestion list show/hide (5 instances)

**Lines:** 237, 244, 255, 265, 274

All instances toggle `suggestionList.style.display` between `'none'` and `'block'`.

**Fix:** Use a CSS class to control visibility.

Add to `styles.css`:
```css
/* Suggestion list visibility — base rule hides by default, class shows */
.bbab-tf-folder-suggestions {
    /* ... existing properties ... */
    display: none;  /* Ensure this is in the base rule */
}

.bbab-tf-folder-suggestions.is-visible {
    display: block;
}
```

Then replace all 5 instances in `settings.ts`:

```typescript
// Line 237 — was: suggestionList.style.display = 'none';
suggestionList.removeClass('is-visible');

// Line 244 — was: suggestionList.style.display = 'none';
suggestionList.removeClass('is-visible');

// Line 255 — was: suggestionList.style.display = 'none';
suggestionList.removeClass('is-visible');

// Line 265 — was: suggestionList.style.display = 'block';
suggestionList.addClass('is-visible');

// Line 274 — was: suggestionList.style.display = 'none';
suggestionList.removeClass('is-visible');
```

#### B. `BulkPreviewModal.ts` — Rule options show/hide (2 instances)

**Lines:** 234, 248

Both toggle `ruleOptionsContainer.style.display`.

**Fix:** Same pattern — CSS class toggle.

Add to `styles.css`:
```css
/* Rule options visibility */
.bbab-tf-rule-options {
    display: none;
}

.bbab-tf-rule-options.is-visible {
    display: block;
}
```

Then replace in `BulkPreviewModal.ts`:

```typescript
// Line 234 — initial state. Was:
//   ruleOptionsContainer.style.display = this.saveAsRule ? 'block' : 'none';
// Replace with:
if (this.saveAsRule) {
    ruleOptionsContainer.addClass('is-visible');
}

// Line 248 — on checkbox change. Was:
//   ruleOptionsContainer.style.display = this.saveAsRule ? 'block' : 'none';
// Replace with:
ruleCb.addEventListener('change', () => {
    this.saveAsRule = ruleCb.checked;
    if (this.saveAsRule) {
        ruleOptionsContainer.addClass('is-visible');
    } else {
        ruleOptionsContainer.removeClass('is-visible');
    }
});
```

#### C. `RulesManagementModal.ts` — Dynamic padding-left (1 instance)

**Decision: CSS custom property (Option 1)**

**Line:** 142

```typescript
// Current:
itemEl.style.paddingLeft = `${depth * 1.25}em`;
```

**Fix:** Use a CSS custom property to pass the depth value to CSS.

In `RulesManagementModal.ts` (line 142), replace with:
```typescript
itemEl.style.setProperty('--tree-depth', String(depth));
```

In `styles.css`, add to the existing `.bbab-tf-tree-item` rule (or create it):
```css
.bbab-tf-tree-item {
    padding-left: calc(var(--tree-depth, 0) * 1.25em);
}
```

**Why this approach:** The CSS custom property pattern keeps the *data* (depth number) in JS but the *styling logic* (how to translate depth to padding) in CSS. This is the modern standard for dynamic values and would not be flagged by reviewers. It's functionally different from setting a visual property like `paddingLeft` directly — the CSS file controls how the variable is used.

### Verification

After fixing, search for remaining inline style usage:
```
grep -rn "\.style\." src/ main.ts
```
The only remaining hit should be the CSS custom property setter (`style.setProperty('--tree-depth', ...)`), which is acceptable.

---

## HIGH-2: Hardcoded Colors in CSS

**Guideline:** "Use CSS classes with Obsidian's CSS variables for theme compatibility." Hardcoded colors don't adapt to light/dark themes or custom themes.

### Violation 1 — `styles.css:904`

```css
/* Current: */
.bbab-tf-tag-current {
    color: #808080 !important;
    opacity: 0.8;
}

/* Replacement: */
.bbab-tf-tag-current {
    color: var(--text-muted) !important;
    opacity: 0.8;
}
```

`var(--text-muted)` is Obsidian's built-in variable for de-emphasized text and adapts to all themes.

### Violation 2 — `styles.css:1158`

```css
/* Current: */
.bbab-tf-folder-suggestions {
    /* ... */
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* Replacement — use Obsidian's shadow variable: */
.bbab-tf-folder-suggestions {
    /* ... */
    box-shadow: var(--shadow-s);
}
```

`var(--shadow-s)` is Obsidian's small shadow variable. If a slightly larger shadow is desired, `var(--shadow-l)` is also available.

### Verification

After fixing, search for hardcoded colors:
```
grep -n "#[0-9a-fA-F]\{3,8\}\|rgba\?\s*(" styles.css
```
Should return zero results.

---

## HIGH-3: Command ID Redundantly Includes Plugin ID

**Guideline:** "Don't include the plugin ID in the ID of a command. Obsidian automatically prefixes command IDs with the plugin ID."

**File:** `main.ts`
**Line:** 72

**Confirmed safe to change** — no existing hotkey bindings reference this command ID.

### Current Code

```typescript
this.addCommand({
    id: 'tagforge-menu',
    name: 'TagForge Menu',
    callback: () => new TagForgeMenuModal(this.app, this).open(),
});
```

The plugin ID is `tagforge` (from `manifest.json`). Obsidian auto-prefixes command IDs, so this command's full runtime ID becomes `tagforge:tagforge-menu` — redundant.

### Fix

```typescript
this.addCommand({
    id: 'menu',
    name: 'TagForge menu',
    callback: () => new TagForgeMenuModal(this.app, this).open(),
});
```

The runtime ID will be `tagforge:menu`, which is clean.

**Note:** Also applies sentence case to the command name (`'TagForge menu'` not `'TagForge Menu'`). "TagForge" keeps its capitalization as a brand name, but "Menu" becomes lowercase.

### Review of ALL Command Names for Sentence Case

All other command names already use correct sentence case after their prefix:

| Line | Current Name | Assessment |
|------|-------------|-----------|
| 73 | `TagForge Menu` | **Change to `TagForge menu`** |
| 79 | `TAG: Manually tag current file` | OK |
| 85 | `REMOVE: Undo all TagForge-applied tags (keeps manual)` | OK |
| 93 | `REMOVE: Remove ALL tags from vault (nuclear option)` | OK |
| 106 | `REMOVE: Remove auto-tags by date` | OK |
| 112 | `REMOVE: Remove auto-tags from specific folder` | OK |
| 118 | `BULK ADD: Apply tags to entire vault (with preview)` | OK |
| 124 | `BULK ADD: Apply tags to specific folder (with preview)` | OK |
| 130 | `UNDO: Undo a recent tag operation` | OK |
| 136 | `REPORT: View tag report dashboard` | OK |
| 142 | `VALIDATE: Check for tag issues` | OK |

Only line 73 needs updating.

### Ribbon Icon Tooltips — Sentence Case

The same sentence case guideline applies to ribbon icon tooltips. Two ribbon icons are registered at `main.ts:149` and `main.ts:153`:

```typescript
// Current:
this.addRibbonIcon('history', 'TagForge: Undo', () => { ... });
this.addRibbonIcon('tags', 'TagForge: Bulk Add to folder', () => { ... });

// Fix — use sentence case and descriptive tooltips:
this.addRibbonIcon('history', 'Undo recent tag operation', () => { ... });
this.addRibbonIcon('tags', 'Apply tags to folder', () => { ... });
```

The current tooltips have inconsistent casing ("Undo" vs "Bulk Add to folder") and include the plugin name redundantly (the icon is already in the plugin's ribbon area). Descriptive, sentence-case tooltips are cleaner.

---

## MEDIUM-1: document.addEventListener Leak in Settings

**Guideline:** "Clean up event listeners when plugins unload."

**File:** `src/settings.ts`
**Line:** 272

### Current Code

```typescript
// Hide suggestions when clicking outside
document.addEventListener('click', (e) => {
    if (!folderInputWrapper.contains(e.target as Node)) {
        suggestionList.style.display = 'none';
    }
});
```

### Problem

This attaches a click listener to the global `document` object. Every time the settings tab is opened (the `display()` method is called), a **new** listener is added without removing the old one. These listeners accumulate and are never cleaned up because:
- `containerEl.empty()` at line 16 destroys child elements but doesn't remove `document`-level listeners
- There's no stored reference to the handler, so it can't be removed

### Fix

Store the handler reference and clean it up. Add a class property and manage the lifecycle:

**Step 1 — Add class property:**

```typescript
export class TagForgeSettingTab extends PluginSettingTab {
    plugin: TagForgePlugin;
    private documentClickHandler: ((e: MouseEvent) => void) | null = null;

    constructor(app: App, plugin: TagForgePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
```

**Step 2 — Clean up at the start of `display()`:**

```typescript
    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Clean up previous document-level listener if it exists
        if (this.documentClickHandler) {
            document.removeEventListener('click', this.documentClickHandler);
            this.documentClickHandler = null;
        }

        // ... rest of display() ...
```

**Step 3 — Store the handler when creating it (around line 272):**

```typescript
        // Hide suggestions when clicking outside
        this.documentClickHandler = (e: MouseEvent) => {
            if (!folderInputWrapper.contains(e.target as Node)) {
                suggestionList.removeClass('is-visible');
            }
        };
        document.addEventListener('click', this.documentClickHandler);
```

**Step 4 — Add `hide()` method for cleanup when navigating away:**

```typescript
    hide(): void {
        if (this.documentClickHandler) {
            document.removeEventListener('click', this.documentClickHandler);
            this.documentClickHandler = null;
        }
    }
```

**Note:** `hide()` is called by Obsidian when the user navigates away from the settings tab. This is the proper place to clean up settings-tab-specific resources.

---

## MEDIUM-2: Internal API Access via vault.adapter

**Guideline:** "Prefer the Vault API over the Adapter API."

**File:** `src/services/MoveHandler.ts`
**Line:** 317

```typescript
const vaultBasePath = (this.plugin.app.vault.adapter as any).basePath as string;
```

### Resolution

**This is automatically resolved by CRITICAL-2 (Option C).** The Vault Adapter API methods (`adapter.list()`, `adapter.rmdir()`, `adapter.remove()`) work with vault-relative paths, eliminating the need for `basePath` entirely. When the Node.js `require('fs')`/`require('path')` code is replaced, this line is also removed.

**No separate action needed.**

---

## MEDIUM-3: minAppVersion Set to 1.0.0

**Guideline:** "Set `minAppVersion` in your `manifest.json` to the minimum version of Obsidian that your plugin requires. If you're not sure, set it to the current version of Obsidian."

**File:** `manifest.json`
**Line:** 5

**Decision: Set to `1.7.0`**

### Current

```json
"minAppVersion": "1.0.0"
```

### Fix

```json
"minAppVersion": "1.7.0"
```

This version covers the recent major API updates the plugin leverages. Brad is currently running Obsidian 1.11.5, and 1.7.0 provides a reasonable floor for compatibility without being overly restrictive.

---

## MEDIUM-4: Manifest Description Missing Period

**Guideline:** Descriptions should "end with a period."

**File:** `manifest.json`
**Line:** 6

### Current

```json
"description": "Automatic hierarchical tag management based on folder structure"
```

### Fix

```json
"description": "Automatic hierarchical tag management based on folder structure."
```

One character. Other description checks:
- Starts with action/descriptive statement (not "This is a plugin that..."): **PASS**
- Under 250 characters (62 chars with period): **PASS**
- No emoji: **PASS**
- Properly capitalized brand names: **PASS** (none needed)

---

## MEDIUM-5: Unregistered Timers in MoveHandler and GroupedMoveConfirmationModal

**(New finding from peer review)**

**Guideline:** "Clean up resources when plugins unload." If the user disables the plugin while a timer is pending, the callback will attempt to run on non-existent objects.

### Violation 1 — `MoveHandler.ts` lines 314 and 398

Two `setTimeout` calls in the cancel-move cleanup logic that are not tracked or cleared on plugin unload:

```typescript
// Line 314-395: Folder cleanup timer (500ms delay)
setTimeout(async () => {
    // ... folder cleanup code using adapter ...
}, 500);

// Line 398-400: Pending undo paths clear timer (1000ms delay)
setTimeout(() => {
    this.pendingUndoPaths.clear();
}, 1000);
```

The `MoveHandler.cleanup()` method (line 29) already clears `pendingMoveTimeout`, but these two timers are not tracked.

**Fix — Store and clear both timers:**

**Step 1 — Add properties to track the timers (after line 22):**

```typescript
export class MoveHandler {
    // Pending state fields
    pendingUndoPath: string | null = null;
    pendingUndoPaths: Set<string> = new Set();
    pendingMoves: Map<string, PendingMoveOperation> = new Map();
    pendingMoveTimeout: number | null = null;
    private cleanupTimeout: number | null = null;
    private undoPathsClearTimeout: number | null = null;
```

**Step 2 — Update `cleanup()` to clear them (around line 29):**

```typescript
    cleanup() {
        if (this.pendingMoveTimeout) {
            window.clearTimeout(this.pendingMoveTimeout);
            this.pendingMoveTimeout = null;
        }
        if (this.cleanupTimeout) {
            window.clearTimeout(this.cleanupTimeout);
            this.cleanupTimeout = null;
        }
        if (this.undoPathsClearTimeout) {
            window.clearTimeout(this.undoPathsClearTimeout);
            this.undoPathsClearTimeout = null;
        }
        this.pendingMoves.clear();
        this.pendingUndoPath = null;
        this.pendingUndoPaths.clear();
    }
```

**Step 3 — Store the timer IDs when creating them (lines 314 and 398):**

```typescript
// Line 314 — folder cleanup timer
this.cleanupTimeout = window.setTimeout(async () => {
    this.cleanupTimeout = null;
    // ... folder cleanup code ...
}, 500);

// Line 398 — undo paths clear timer
this.undoPathsClearTimeout = window.setTimeout(() => {
    this.undoPathsClearTimeout = null;
    this.pendingUndoPaths.clear();
}, 1000);
```

### Violation 2 — `GroupedMoveConfirmationModal.ts` line 195

```typescript
onClose() {
    const { contentEl } = this;
    contentEl.empty();

    if (!this.resultSent) {
        const capturedExcludedPaths = new Set(this.excludedPaths);
        const capturedOnResult = this.onResult;

        setTimeout(() => {
            capturedOnResult({
                action: 'cancel',
                excludedPaths: capturedExcludedPaths,
                remember: false,
            });
        }, 50);
    }
}
```

This 50ms timer fires after the modal closes to invoke the callback. Since the callback references are captured in local variables (not `this`), and the timer is very short (50ms), this is lower risk. However, for correctness:

**Fix — Store and clear the timer:**

**Step 1 — Add a property:**

```typescript
export class GroupedMoveConfirmationModal extends Modal {
    // ... existing properties ...
    private closeTimeout: number | null = null;
```

**Step 2 — Store the timer in `onClose()`:**

```typescript
    if (!this.resultSent) {
        const capturedExcludedPaths = new Set(this.excludedPaths);
        const capturedOnResult = this.onResult;

        this.closeTimeout = window.setTimeout(() => {
            this.closeTimeout = null;
            capturedOnResult({
                action: 'cancel',
                excludedPaths: capturedExcludedPaths,
                remember: false,
            });
        }, 50);
    }
```

**Note:** Since `onClose()` is the cleanup itself and fires once, the risk here is minimal. But storing the reference ensures it can be cleared if needed and follows best practices.

---

## Implementation Order

Recommended order to tackle these fixes (all decisions are finalized):

| Step | Item | Complexity | Files Changed |
|------|------|-----------|---------------|
| 1 | NEW: Create `versions.json` for BRAT compatibility | Trivial | `versions.json` (new) |
| 2 | MEDIUM-4: Add period to description | Trivial | `manifest.json` |
| 3 | MEDIUM-3: Set minAppVersion to 1.7.0 | Trivial | `manifest.json` |
| 4 | HIGH-3: Fix command ID + sentence case | Simple | `main.ts` |
| 5 | CRITICAL-3 + CRITICAL-4: Fix all settings headings | Moderate | `src/settings.ts` |
| 6 | CRITICAL-1: Replace innerHTML | Moderate | `src/modals/BulkPreviewModal.ts` |
| 7 | HIGH-2: Fix hardcoded colors | Simple | `styles.css` |
| 8 | HIGH-1: Replace inline styles with CSS classes | Moderate | `src/settings.ts`, `src/modals/BulkPreviewModal.ts`, `src/modals/RulesManagementModal.ts`, `styles.css` |
| 9 | MEDIUM-1: Fix document listener leak | Moderate | `src/settings.ts` |
| 10 | MEDIUM-5: Register untracked timers | Moderate | `src/services/MoveHandler.ts`, `src/modals/GroupedMoveConfirmationModal.ts` |
| 11 | CRITICAL-2 + MEDIUM-2: Replace Node.js require with Vault Adapter API | Complex | `src/services/MoveHandler.ts` |

Steps 1-4 can be done in minutes. Steps 5-9 are straightforward replacements. Steps 10-11 require careful testing of the move/cancel-move flow.

---

## Passed Checks (No Action Needed)

For completeness, here's everything that passed the audit:

- No global `app` object usage (correctly uses `this.app`)
- Minimal console logging (8 `console.error` calls in error handlers — appropriate)
- No placeholder/template class names
- No `var` declarations (all `const`/`let`)
- No default hotkeys on commands
- Correct command callback types
- No `workspace.activeLeaf` usage
- Uses `processFrontMatter()` for all YAML modifications (12 usages across 5 files)
- Uses `getAbstractFileByPath()` consistently (12 usages, no file iteration anti-pattern)
- No lookbehind regex patterns (mobile safe)
- No `vault.modify()` usage
- No leaf detaching in `onunload()`
- Timeouts cleaned up on plugin unload (for `pendingMoveTimeout` — others added in MEDIUM-5)
- No unnecessary `fundingUrl` in manifest
- No sample/template code remaining
- No `eval()` or `Function()` constructor usage
