# Codebase Audit & Review

**Date:** January 2, 2026
**Reviewer:** Gemini Agent

## Executive Summary
The `TagForge` plugin is well-structured and includes sophisticated features like operation history, undo capabilities, and batched processing. The architecture described in the ADRs is sound. However, there are **critical blocking issues** that will prevent the plugin from functioning on mobile devices and will cause rejection from the Obsidian Marketplace.

## Critical Issues (Must Fix)

### 1. Mobile Incompatibility & Marketplace Violation
*   **Location:** `main.ts` (Lines 9-11) and usage in `handleGroupedMoveResult` (approx line 530).
*   **Issue:** The plugin imports Node.js native modules:
    ```typescript
    const fs = require('fs') as typeof import('fs');
    const nodePath = require('path') as typeof import('path');
    ```
*   **Impact:**
    *   **Mobile:** The plugin will fail to load or crash on iOS and Android devices, as these environments do not provide Node.js APIs.
    *   **Marketplace:** Usage of `fs` and `path` is strictly prohibited for file manipulation in Obsidian plugins.
*   **Remediation:** Refactor all file system operations to use the Obsidian Adapter API (`this.app.vault.adapter`).
    *   Replace `fs.existsSync` with `await this.app.vault.adapter.exists()`.
    *   Replace `fs.readdirSync` with `await this.app.vault.adapter.list()`.
    *   Replace `fs.rmdirSync` and `fs.unlinkSync` with `await this.app.vault.adapter.rmdir()` and `remove()`.

### 2. Security Vulnerability (XSS)
*   **Location:** `main.ts` (Inside `BulkPreviewModal.renderList`, approx line 2300).
*   **Issue:** Usage of `innerHTML` to render tag elements:
    ```typescript
    tagSpan.innerHTML = tagsWithStatus.join(' ');
    ```
*   **Impact:** If a malicious tag name (e.g., containing `<script>` or `onerror` handlers) is introduced into the vault (via sync or import), it could execute arbitrary JavaScript in the context of the user's Obsidian session.
*   **Remediation:** Use standard DOM creation methods.
    ```typescript
    // Instead of innerHTML
    item.currentTags.forEach(t => {
        if (deletionsForFile.has(t)) {
            tagSpan.createEl('s', { text: '#' + t });
        } else {
            tagSpan.createSpan({ text: '#' + t });
        }
    });
    ```

## Logic & Consistency

### 3. Inconsistent Rule Application (Bug)
*   **Location:** `tagCurrentFile` method in `main.ts`.
*   **Issue:** The manual command triggers `this.getTagsForPath(activeFile.path)`.
*   **Context:** ADR-002 explicitly states the move from an implicit algorithm to an **Explicit Folder Rules System**. The `handleFileCreate` method correctly uses `getRulesForPath`, but `tagCurrentFile` still uses the legacy `getTagsForPath`.
*   **Impact:** Manual tagging will behave differently from auto-tagging, potentially adding tags that the user has not configured in their rules.
*   **Remediation:** Update `tagCurrentFile` to use `this.getRulesForPath(activeFile.path)`.

## Performance & Architecture

### 4. Race Condition Handling
*   **Observation:** The plugin uses `setTimeout` (100ms) in `handleFileCreate` and `handleFileRename` to wait for Obsidian's metadata cache to update.
*   **Feedback:** This is a known necessary evil in the Obsidian API context. The implementation using `pendingTimeouts` and `pendingFileOps` to debounce these events is robust and well-implemented.

### 5. UI Responsiveness
*   **Observation:** Large batch operations (like `revertAllAutoTags` and `executeBulkApply`) yield to the main thread every 50 items:
    ```typescript
    await new Promise(resolve => setTimeout(resolve, 10));
    ```
*   **Feedback:** Excellent practice. This prevents the "Application Not Responding" freeze during heavy operations on large vaults.

### 6. Settings & Data Scalability
*   **Observation:** `operationHistory` stores up to 50 operations.
*   **Feedback:** This is stored in `data.json`. As the history fills up, `data.json` could grow moderately large. Given the limit is 50, this is likely acceptable, but ensure that `OperationFileState` doesn't store excessive unnecessary data.

## Documentation & Standards

### 7. Code Comments & Readability
*   **Observation:** The code is well-commented, particularly the phase indicators (e.g., `// Phase 10: Explicit Folder Rules`).
*   **Feedback:** This makes the codebase easy to navigate and maintain.

### 8. ADR Adherence
*   **Observation:** The implementation closely follows the decisions recorded in `docs/ADR-001` and `docs/ADR-002`.
*   **Feedback:** Keeping architectural decisions in sync with code is a sign of a healthy project.

---
**Overall Verdict:** The plugin is feature-complete and architecturally sound, but **cannot be released** until the `fs`/`path` dependency is removed and the XSS vulnerability is patched.
