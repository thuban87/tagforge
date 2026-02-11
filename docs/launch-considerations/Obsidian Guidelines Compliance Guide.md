# Obsidian Plugin Guidelines — Compliance Remediation Guide

**Created:** 2026-02-10
**Purpose:** Fix all violations found during audit against Obsidian's [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) and [Submission Requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)
**Audit Result:** 11 findings (4 critical, 3 high, 4 medium)

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

### Decision Required

> **Question for Brad:** Which approach do you want to take?
>
> **Option A — Set `isDesktopOnly: true`**
> - Simplest fix: one line change in `manifest.json`
> - **Downside:** Loses mobile support entirely. All mobile optimization work (Phase 9) becomes unused.
>
> **Option B — Guard with `Platform.isDesktop` (Recommended)**
> - Keep `isDesktopOnly: false` (mobile stays supported)
> - Wrap `require()` calls so they only execute on desktop
> - Skip folder cleanup entirely on mobile (files still move back correctly, just empty folders might linger)
> - Mobile users can clean up empty folders manually or they'll be ignored
>
> **Option C — Replace with Vault Adapter API (Cleanest, More Work)**
> - Replace all `fs`/`path` usage with `vault.adapter.list()`, `vault.adapter.rmdir()`, `vault.adapter.stat()` etc.
> - These Obsidian APIs work cross-platform (desktop + mobile)
> - Eliminates the Node.js dependency entirely
> - More work to implement and test, and may not handle Windows system file cleanup as well

### Option B Implementation (if chosen)

```typescript
// Lines 11-15 — Replace top-level require with conditional loading
import { Platform } from 'obsidian';

let fs: typeof import('fs') | null = null;
let nodePath: typeof import('path') | null = null;

if (Platform.isDesktop) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    nodePath = require('path') as typeof import('path');
}
```

Then wrap the cleanup block (lines 314-395) with a desktop guard:

```typescript
// Clean up empty destination folders (desktop only — requires Node.js fs)
if (Platform.isDesktop && fs && nodePath) {
    setTimeout(async () => {
        // ... existing cleanup code unchanged ...
    }, 500);
}
```

**Note:** `Platform` is already imported in `main.ts` but needs to be added to the MoveHandler import line (line 5).

### Option C Implementation (if chosen)

Replace the cleanup block with Obsidian Adapter API calls:

```typescript
setTimeout(async () => {
    const adapter = this.plugin.app.vault.adapter;
    let totalDeleted = 0;
    let deletedThisRound = 0;
    let maxRounds = 10;

    do {
        deletedThisRound = 0;
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
- Removes the `(vault.adapter as any).basePath` access
- Works on both desktop and mobile
- Uses `adapter.list()` / `adapter.rmdir()` / `adapter.remove()` (all cross-platform)

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

### All Violations

| Line | Current Code | Issue |
|------|-------------|-------|
| 20 | `containerEl.createEl('h1', { text: 'TagForge Settings' });` | Top-level heading — should be removed entirely |
| 30 | `containerEl.createEl('h2', { text: 'Core Settings' });` | Should use `setHeading()` |
| 94 | `containerEl.createEl('h2', { text: 'Folder Rules' });` | Should use `setHeading()` |
| 115 | `containerEl.createEl('h2', { text: 'Ignore Paths' });` | Should use `setHeading()` |
| 139 | `containerEl.createEl('h2', { text: 'Protected Tags' });` | Should use `setHeading()` |
| 163 | `containerEl.createEl('h2', { text: 'Folder Aliases' });` | Should use `setHeading()` |
| 311 | `containerEl.createEl('h2', { text: 'Quick Start' });` | Should use `setHeading()` |

### Replacement Pattern

The Obsidian API pattern for settings headings is:

```typescript
new Setting(containerEl).setName('Section name').setHeading();
```

### Detailed Changes

**Line 20 — Remove the h1 entirely.**
The settings tab already displays the plugin name. The guideline says "General settings are at the top and don't have a heading."

```typescript
// REMOVE this line:
containerEl.createEl('h1', { text: 'TagForge Settings' });

// KEEP the description paragraph (line 21-24) — it's fine:
containerEl.createEl('p', {
    text: 'Automatic hierarchical tag management based on folder structure.',
    cls: 'bbab-tf-description',
});
```

**Line 30 — "Core Settings" heading.**

Since the guideline says "General settings are at the top and don't have a heading," consider whether the "Core Settings" section IS the general settings. If it is (enable auto-tagging, inheritance depth, move behavior are core/general settings), remove this heading entirely — those settings just live at the top with no heading.

> **Question for Brad:** Should "Core Settings" be treated as the general settings section (no heading, just settings at the top)? Or should it have a heading? If it gets a heading, it should NOT be called "Core settings" since it's effectively the general/default section. The guideline specifically says general settings don't get a heading.

If it keeps a heading (for a non-general section), use:
```typescript
new Setting(containerEl).setName('Core settings').setHeading();
```

**Lines 94, 115, 139, 163, 311 — All other h2 headings.**

Replace each `createEl('h2', ...)` with:

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

Currently, description paragraphs are created with `containerEl.createEl('p', ...)` after each heading. With the `setHeading()` pattern, you have two options:

1. **Keep the `createEl('p')` descriptions as-is** — They still work fine visually after a `setHeading()` call.
2. **Use `setDesc()` on the heading Setting** — Cleaner but the description appears tighter to the heading:

```typescript
new Setting(containerEl)
    .setName('Folder rules')
    .setDesc('Set up rules to automatically tag new files based on their folder location.')
    .setHeading();
```

Either approach is acceptable per the guidelines. Option 1 is less work (just replace the `createEl('h2')` lines and leave the `createEl('p')` lines alone).

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
| Core Settings | Core settings |
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
// doesn't apply. But the h3 is used as a section header within a modal,
// which is an acceptable use of createEl for non-settings UI.
// However, if you want consistency, sentence case it:
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
/* Suggestion list visibility */
.bbab-tf-folder-suggestions.is-visible {
    display: block;
}
```

Make sure the base `.bbab-tf-folder-suggestions` class already has `display: none` (check styles.css — if not, add it).

Then replace in `settings.ts`:

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
// Line 234 — initial state
if (this.saveAsRule) {
    ruleOptionsContainer.addClass('is-visible');
}

// Line 248 — on checkbox change
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

**Line:** 142

```typescript
itemEl.style.paddingLeft = `${depth * 1.25}em`;
```

This is trickier because the value is dynamic (varies by tree depth). Options:

**Option 1 — CSS custom property (Recommended):**

```typescript
itemEl.style.setProperty('--tree-depth', String(depth));
```

Then in `styles.css`:
```css
.bbab-tf-tree-item {
    padding-left: calc(var(--tree-depth, 0) * 1.25em);
}
```

**Option 2 — Depth-based CSS classes (up to a reasonable max):**

```css
.bbab-tf-tree-depth-0 { padding-left: 0; }
.bbab-tf-tree-depth-1 { padding-left: 1.25em; }
.bbab-tf-tree-depth-2 { padding-left: 2.5em; }
.bbab-tf-tree-depth-3 { padding-left: 3.75em; }
.bbab-tf-tree-depth-4 { padding-left: 5em; }
.bbab-tf-tree-depth-5 { padding-left: 6.25em; }
.bbab-tf-tree-depth-6 { padding-left: 7.5em; }
.bbab-tf-tree-depth-7 { padding-left: 8.75em; }
/* etc. — cap at a reasonable depth */
```

```typescript
itemEl.addClass(`bbab-tf-tree-depth-${Math.min(depth, 7)}`);
```

> **Question for Brad:** Preference between CSS custom property (Option 1 — cleaner but uses a minor inline style via `setProperty`) vs. depth classes (Option 2 — no inline styles at all but adds multiple CSS rules)? Option 1 is technically still setting a style property, but CSS custom properties are generally considered acceptable since the actual styling rule lives in CSS. Option 2 is the strictest interpretation of "no inline styles."

### Verification

After fixing, search for remaining inline style usage:
```
grep -rn "\.style\." src/ main.ts
```
Should return zero results (or only acceptable usage if any).

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

**Note:** Also apply sentence case to the command name (`'TagForge menu'` not `'TagForge Menu'`). Since "TagForge" is a brand name / proper noun, it keeps its capitalization, but "Menu" becomes lowercase.

### Impact on Existing Users

> **Question for Brad:** Changing this command ID means anyone who already has a hotkey bound to the old `tagforge:tagforge-menu` ID will lose that binding. Since this is pre-BRAT-release, this should be fine (no existing users), but confirm there are no hotkey bindings in your test or production vaults that reference the old ID. If there are, they'd need to be re-bound after the change.

### Review ALL Command Names for Sentence Case

While we're here, review the command names for the style guideline "use sentence case." Current names use a prefix pattern (`TAG:`, `REMOVE:`, `BULK ADD:`, `UNDO:`, `REPORT:`, `VALIDATE:`). These prefixes are a stylistic choice for organizing the command palette, and they're fine to keep. But check that the text after the colon uses sentence case:

| Line | Current Name | Assessment |
|------|-------------|-----------|
| 73 | `TagForge Menu` | Change to `TagForge menu` |
| 79 | `TAG: Manually tag current file` | OK (sentence case after colon) |
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

Store the handler reference and clean it up. The simplest approach is to use a class property and remove it at the start of `display()`:

```typescript
export class TagForgeSettingTab extends PluginSettingTab {
    plugin: TagForgePlugin;
    private documentClickHandler: ((e: MouseEvent) => void) | null = null;

    constructor(app: App, plugin: TagForgePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Clean up previous document-level listener if it exists
        if (this.documentClickHandler) {
            document.removeEventListener('click', this.documentClickHandler);
            this.documentClickHandler = null;
        }

        // ... rest of display() ...

        // Later, where the listener is created (around line 272):
        this.documentClickHandler = (e: MouseEvent) => {
            if (!folderInputWrapper.contains(e.target as Node)) {
                suggestionList.removeClass('is-visible');
            }
        };
        document.addEventListener('click', this.documentClickHandler);
    }
}
```

Also add cleanup in the plugin's `onunload()` or override `hide()` in the setting tab:

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

### Assessment

This is resolved automatically if you implement **Option C** from CRITICAL-2 (replacing `fs`/`path` with Vault Adapter API calls). The Vault Adapter API methods like `adapter.list()`, `adapter.rmdir()`, `adapter.remove()` work with vault-relative paths, eliminating the need for `basePath` entirely.

If you implement **Option B** instead (Platform guard), this line stays but is guarded behind `Platform.isDesktop`, which is acceptable since `basePath` is Electron-specific and will only execute on desktop.

**No separate action needed** — this is resolved by whichever approach is chosen for CRITICAL-2.

---

## MEDIUM-3: minAppVersion Set to 1.0.0

**Guideline:** "Set `minAppVersion` in your `manifest.json` to the minimum version of Obsidian that your plugin requires. If you're not sure, set it to the current version of Obsidian."

**File:** `manifest.json`
**Line:** 5

### Current

```json
"minAppVersion": "1.0.0"
```

### Problem

The plugin uses APIs that were introduced after Obsidian 1.0.0. For example, `processFrontMatter()` has been available since early versions but some APIs may have changed. More importantly, claiming compatibility with 1.0.0 means Obsidian won't prevent installation on very old versions where the plugin may not function correctly.

### Fix

Set this to the Obsidian version you've been developing and testing against. Check your current Obsidian version:
- Open Obsidian → Settings → About → Current version

```json
"minAppVersion": "1.7.7"
```

> **Question for Brad:** What version of Obsidian are you running? Use that version (or close to it) as `minAppVersion`. If you want broader compatibility, the latest stable at time of initial development is usually safe.

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

One character. Also confirm the description follows the other rules:
- Starts with action/descriptive statement (not "This is a plugin that..."): **PASS**
- Under 250 characters (61 chars + period = 62): **PASS**
- No emoji: **PASS**
- Properly capitalized brand names: **PASS** (none needed)

---

## Implementation Order

Recommended order to tackle these fixes:

| Step | Item | Est. Complexity | Files Changed |
|------|------|----------------|---------------|
| 1 | MEDIUM-4: Add period to description | Trivial | `manifest.json` |
| 2 | MEDIUM-3: Update minAppVersion | Trivial | `manifest.json` |
| 3 | HIGH-3: Fix command ID | Simple | `main.ts` |
| 4 | CRITICAL-4 + CRITICAL-3: Fix all settings headings | Moderate | `src/settings.ts` |
| 5 | CRITICAL-1: Replace innerHTML | Moderate | `src/modals/BulkPreviewModal.ts` |
| 6 | HIGH-2: Fix hardcoded colors | Simple | `styles.css` |
| 7 | HIGH-1: Replace inline styles with CSS classes | Moderate | `src/settings.ts`, `src/modals/BulkPreviewModal.ts`, `src/modals/RulesManagementModal.ts`, `styles.css` |
| 8 | MEDIUM-1: Fix document listener leak | Moderate | `src/settings.ts` |
| 9 | CRITICAL-2: Fix Node.js require (after Brad's decision) | Complex | `src/services/MoveHandler.ts`, possibly `manifest.json` |

Steps 1-3 can be done in minutes. Steps 4-8 are straightforward replacements. Step 9 requires Brad's input on the approach.

---

## Questions Requiring Brad's Answers

1. **CRITICAL-2:** Which approach for the Node.js `require('fs')`/`require('path')` issue?
   - **Option A:** Set `isDesktopOnly: true` (loses mobile)
   - **Option B:** Guard with `Platform.isDesktop` (mobile skips folder cleanup)
   - **Option C:** Replace with Vault Adapter API (cleanest, most work)

2. **CRITICAL-3:** Should "Core Settings" be treated as the general settings section (no heading, settings just appear at the top), or should it keep a heading?

3. **HIGH-1 (tree depth):** CSS custom property (`--tree-depth`) vs. depth classes (`bbab-tf-tree-depth-N`) for the tree indentation?

4. **HIGH-3:** Confirm no existing hotkey bindings reference `tagforge:tagforge-menu` in test or production vaults.

5. **MEDIUM-3:** What Obsidian version are you running? (For `minAppVersion` value.)

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
- Timeouts cleaned up on plugin unload
- No unnecessary `fundingUrl` in manifest
- No sample/template code remaining
- No `eval()` or `Function()` constructor usage
