// src/modals/ValidationResultsModal.ts
// Validation results display with fix/dismiss actions

import { App, Modal, Notice } from 'obsidian';
import type TagForgePlugin from '../../main';
import { ValidationIssue } from '../types';

export class ValidationResultsModal extends Modal {
    issues: ValidationIssue[];
    plugin: TagForgePlugin;

    constructor(app: App, issues: ValidationIssue[], plugin: TagForgePlugin) {
        super(app);
        this.issues = issues;
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('bbab-tf-large-modal');
        contentEl.addClass('bbab-tf-validation-modal');

        contentEl.createEl('h2', { text: 'Validation Results' });
        contentEl.createEl('p', {
            text: `Found ${this.issues.length} issue(s)`,
            cls: 'bbab-tf-description',
        });

        const listEl = contentEl.createDiv({ cls: 'bbab-tf-validation-list' });

        for (const issue of this.issues) {
            const itemEl = listEl.createDiv({ cls: 'bbab-tf-validation-item' });

            // Issue type badge
            const typeBadge = itemEl.createSpan({ cls: `bbab-tf-issue-type bbab-tf-issue-${issue.type}` });
            typeBadge.textContent = this.getIssueTypeLabel(issue.type);

            // File path
            itemEl.createSpan({ text: issue.filePath, cls: 'bbab-tf-validation-path' });

            // Description
            itemEl.createDiv({ text: issue.description, cls: 'bbab-tf-validation-desc' });

            // Button container for this item
            const btnContainer = itemEl.createDiv({ cls: 'bbab-tf-validation-btns' });

            // Fix button
            const fixBtn = btnContainer.createEl('button', {
                text: this.getFixButtonLabel(issue.type),
                cls: 'bbab-tf-fix-btn',
            });
            fixBtn.addEventListener('click', async () => {
                await this.plugin.validationService.fixValidationIssue(issue);
                this.removeIssueAndRefresh(issue);
            });

            // For missing-tags, also show a Dismiss button (removes tracking instead of re-applying)
            if (issue.type === 'missing-tags') {
                const dismissBtn = btnContainer.createEl('button', {
                    text: 'Dismiss',
                    cls: 'bbab-tf-dismiss-btn',
                });
                dismissBtn.addEventListener('click', async () => {
                    // Remove tracking for this file (intentional removal)
                    delete this.plugin.tagTracking[issue.filePath];
                    await this.plugin.saveSettings();
                    new Notice(`Dismissed tracking for: ${issue.filePath}`);
                    this.removeIssueAndRefresh(issue);
                });
            }
        }

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-button-container' });

        // Count missing issues for the dismiss button
        const missingIssues = this.issues.filter(i => i.type === 'missing-tags');

        const fixAllBtn = buttonContainer.createEl('button', {
            text: 'Fix All',
            cls: 'mod-warning',
        });
        fixAllBtn.addEventListener('click', async () => {
            for (const issue of this.issues) {
                await this.plugin.validationService.fixValidationIssue(issue);
            }
            this.close();
            new Notice('All issues fixed!');
        });

        // Add "Dismiss All Missing" button if there are missing-tags issues
        if (missingIssues.length > 0) {
            const dismissAllBtn = buttonContainer.createEl('button', {
                text: `Dismiss All Missing (${missingIssues.length})`,
            });
            dismissAllBtn.addEventListener('click', async () => {
                for (const issue of missingIssues) {
                    delete this.plugin.tagTracking[issue.filePath];
                }
                await this.plugin.saveSettings();
                this.issues = this.issues.filter(i => i.type !== 'missing-tags');
                if (this.issues.length === 0) {
                    this.close();
                    new Notice(`Dismissed ${missingIssues.length} missing tag entries`);
                } else {
                    new Notice(`Dismissed ${missingIssues.length} missing tag entries`);
                    this.onOpen(); // Re-render with remaining issues
                }
            });
        }

        const closeBtn = buttonContainer.createEl('button', { text: 'Close' });
        closeBtn.addEventListener('click', () => {
            this.close();
        });
    }

    removeIssueAndRefresh(issue: ValidationIssue) {
        this.issues = this.issues.filter(i => i !== issue);
        if (this.issues.length === 0) {
            this.close();
            new Notice('All issues resolved!');
        } else {
            this.onOpen(); // Re-render
        }
    }

    getIssueTypeLabel(type: ValidationIssue['type']): string {
        switch (type) {
            case 'orphaned-tracking': return 'Orphaned';
            case 'missing-tags': return 'Missing';
            case 'ignored-path-tracked': return 'Ignored';
            default: return 'Unknown';
        }
    }

    getFixButtonLabel(type: ValidationIssue['type']): string {
        switch (type) {
            case 'orphaned-tracking': return 'Remove tracking';
            case 'missing-tags': return 'Re-apply tags';
            case 'ignored-path-tracked': return 'Remove tracking';
            default: return 'Fix';
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
