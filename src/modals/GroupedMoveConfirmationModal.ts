// src/modals/GroupedMoveConfirmationModal.ts
// Batch move confirmation modal for multiple files

import { App, Modal, Notice } from 'obsidian';
import type TagForgePlugin from '../../main';
import { PendingMoveOperation, GroupedMoveResult } from '../types';

export class GroupedMoveConfirmationModal extends Modal {
    plugin: TagForgePlugin;
    moves: PendingMoveOperation[];
    onResult: (result: GroupedMoveResult) => void;
    excludedPaths: Set<string> = new Set();
    rememberChoice: boolean = false;
    resultSent: boolean = false; // Track if user clicked a button

    constructor(
        app: App,
        plugin: TagForgePlugin,
        moves: PendingMoveOperation[],
        onResult: (result: GroupedMoveResult) => void
    ) {
        super(app);
        this.plugin = plugin;
        this.moves = moves;
        this.onResult = onResult;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('bbab-tf-large-modal');
        contentEl.addClass('bbab-tf-grouped-move-modal');

        contentEl.createEl('h2', { text: 'Multiple Files Moved' });

        // Summary
        const summaryEl = contentEl.createDiv({ cls: 'bbab-tf-move-summary' });
        summaryEl.createEl('p', {
            text: `${this.moves.length} files are being moved. Choose how to handle their tags:`,
        });

        // Group moves by destination folder for cleaner display
        const folderGroups = new Map<string, PendingMoveOperation[]>();
        for (const move of this.moves) {
            const destFolder = move.newFolder || '(vault root)';
            if (!folderGroups.has(destFolder)) {
                folderGroups.set(destFolder, []);
            }
            folderGroups.get(destFolder)!.push(move);
        }

        // File list with checkboxes
        const listContainer = contentEl.createDiv({ cls: 'bbab-tf-grouped-move-list' });

        for (const [destFolder, groupMoves] of folderGroups) {
            // Folder group header - show destination folder and rule status
            const groupEl = listContainer.createDiv({ cls: 'bbab-tf-move-group' });
            const groupHeader = groupEl.createDiv({ cls: 'bbab-tf-move-group-header' });

            groupHeader.createSpan({ text: destFolder, cls: 'bbab-tf-move-folder-name' });
            groupHeader.createSpan({ text: ` — ${groupMoves.length} file${groupMoves.length > 1 ? 's' : ''}`, cls: 'bbab-tf-move-count' });

            // Check what tags apply to this destination
            const sampleFile = groupMoves[0];
            const newTags = this.plugin.getRulesForPath(sampleFile.file.path);
            const oldTracking = this.plugin.tagTracking[sampleFile.oldPath];
            const oldTags = oldTracking?.autoTags || [];

            // Show tag change info
            const tagInfoEl = groupEl.createDiv({ cls: 'bbab-tf-move-tag-info' });
            if (oldTags.length > 0 && newTags.length === 0) {
                tagInfoEl.createSpan({
                    text: `⚠️ No rules on destination — tags will be removed but not replaced`,
                    cls: 'bbab-tf-move-warning'
                });
            } else if (oldTags.length === 0 && newTags.length === 0) {
                tagInfoEl.createSpan({
                    text: `ℹ️ No auto-tags to change`,
                    cls: 'bbab-tf-move-info'
                });
            } else if (newTags.length > 0) {
                tagInfoEl.createSpan({
                    text: `→ New tags: ${newTags.map(t => '#' + t).join(', ')}`,
                    cls: 'bbab-tf-move-new-tags'
                });
            }

            // Files in this group
            const filesEl = groupEl.createDiv({ cls: 'bbab-tf-move-group-files' });
            for (const move of groupMoves) {
                const fileEl = filesEl.createDiv({ cls: 'bbab-tf-move-file-item' });
                const checkbox = fileEl.createEl('input', { type: 'checkbox' });
                checkbox.checked = true;
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) {
                        this.excludedPaths.delete(move.file.path);
                    } else {
                        this.excludedPaths.add(move.file.path);
                    }
                    this.updateButtonText();
                });
                fileEl.createSpan({ text: move.file.name, cls: 'bbab-tf-move-filename' });
            }
        }

        // Explanation
        const descEl = contentEl.createDiv({ cls: 'bbab-tf-move-description' });
        descEl.createEl('p', { text: 'Choose an action for checked files:' });
        const optionsList = descEl.createEl('ul', { cls: 'bbab-tf-move-options' });
        optionsList.createEl('li', { text: 'Continue — Remove old folder tags, apply new folder tags' });
        optionsList.createEl('li', { text: 'Leave Tags — Keep current tags as-is' });
        optionsList.createEl('li', { text: 'Cancel — Move files back to original folders' });
        descEl.createEl('p', {
            text: 'Unchecked files: kept their current tags, no changes made.',
            cls: 'bbab-tf-hint',
        });

        // Remember choice checkbox
        const rememberLabel = contentEl.createEl('label', { cls: 'bbab-tf-remember-choice' });
        const rememberCb = rememberLabel.createEl('input', { type: 'checkbox' });
        rememberLabel.createSpan({ text: ' Remember my choice for future moves' });
        rememberCb.addEventListener('change', () => {
            this.rememberChoice = rememberCb.checked;
        });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-move-buttons' });

        const continueBtn = buttonContainer.createEl('button', {
            cls: 'mod-cta bbab-tf-grouped-continue-btn',
        });
        continueBtn.textContent = `Continue (${this.moves.length} files)`;
        continueBtn.addEventListener('click', () => {
            this.resultSent = true;
            this.close();
            this.onResult({
                action: 'continue',
                excludedPaths: new Set(this.excludedPaths),
                remember: this.rememberChoice,
            });
        });

        const leaveBtn = buttonContainer.createEl('button', {
            cls: 'bbab-tf-grouped-leave-btn',
        });
        leaveBtn.textContent = `Leave Tags (${this.moves.length} files)`;
        leaveBtn.addEventListener('click', () => {
            this.resultSent = true;
            this.close();
            this.onResult({
                action: 'leave',
                excludedPaths: new Set(this.excludedPaths),
                remember: this.rememberChoice,
            });
        });

        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Cancel (Undo Moves)',
            cls: 'mod-warning bbab-tf-grouped-cancel-btn',
        });
        cancelBtn.addEventListener('click', () => {
            this.resultSent = true;
            this.close();
            this.onResult({
                action: 'cancel',
                excludedPaths: new Set(this.excludedPaths),
                remember: false,
            });
        });
    }

    updateButtonText() {
        const activeCount = this.moves.length - this.excludedPaths.size;
        const continueBtn = this.contentEl.querySelector('.bbab-tf-grouped-continue-btn');
        const leaveBtn = this.contentEl.querySelector('.bbab-tf-grouped-leave-btn');
        if (continueBtn) {
            continueBtn.textContent = `Continue (${activeCount} files)`;
        }
        if (leaveBtn) {
            leaveBtn.textContent = `Leave Tags (${activeCount} files)`;
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();

        // If closed without clicking a button (X or Escape), default to Cancel (undo moves)
        // Use setTimeout to defer callback until after modal is fully closed
        // Capture values before timeout to ensure they're not affected by modal cleanup
        if (!this.resultSent) {
            const capturedExcludedPaths = new Set(this.excludedPaths);
            const capturedOnResult = this.onResult;

            setTimeout(() => {
                capturedOnResult({
                    action: 'cancel',
                    excludedPaths: capturedExcludedPaths,
                    remember: false,
                });
            }, 50); // 50ms delay to ensure modal is fully closed
        }
    }
}
