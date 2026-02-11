// src/modals/MoveConfirmationModal.ts
// Single-file move confirmation modal

import { App, Modal, TFile } from 'obsidian';
import type TagForgePlugin from '../../main';
import { MoveConfirmationResult } from '../types';

export class MoveConfirmationModal extends Modal {
    plugin: TagForgePlugin;
    file: TFile;
    oldPath: string;
    oldFolder: string;
    newFolder: string;
    onResult: (result: MoveConfirmationResult) => void;
    rememberChoice: boolean = false;

    constructor(
        app: App,
        plugin: TagForgePlugin,
        file: TFile,
        oldPath: string,
        oldFolder: string,
        newFolder: string,
        onResult: (result: MoveConfirmationResult) => void
    ) {
        super(app);
        this.plugin = plugin;
        this.file = file;
        this.oldPath = oldPath;
        this.oldFolder = oldFolder || '(vault root)';
        this.newFolder = newFolder || '(vault root)';
        this.onResult = onResult;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('bbab-tf-large-modal');
        contentEl.addClass('bbab-tf-move-modal');

        contentEl.createEl('h2', { text: 'File Moved' });

        // File info
        const infoEl = contentEl.createDiv({ cls: 'bbab-tf-move-info' });
        infoEl.createEl('p', { text: `"${this.file.name}" was moved.` });

        const pathInfo = infoEl.createDiv({ cls: 'bbab-tf-move-paths' });
        pathInfo.createEl('div', { text: `From: ${this.oldFolder}`, cls: 'bbab-tf-move-path' });
        pathInfo.createEl('div', { text: `To: ${this.newFolder}`, cls: 'bbab-tf-move-path' });

        // Check what tags will change
        const newTags = this.plugin.tagResolver.getRulesForPath(this.file.path);
        const oldTracking = this.plugin.tagTracking[this.oldPath];
        const oldTags = oldTracking?.autoTags || [];

        // Show tag change summary
        const tagSummaryEl = contentEl.createDiv({ cls: 'bbab-tf-move-tag-summary' });

        if (oldTags.length > 0) {
            tagSummaryEl.createDiv({
                text: `Current auto-tags: ${oldTags.map(t => '#' + t).join(', ')}`,
                cls: 'bbab-tf-move-old-tags'
            });
        }

        if (oldTags.length > 0 && newTags.length === 0) {
            tagSummaryEl.createDiv({
                text: `⚠️ No folder rules on destination — auto-tags will be removed but not replaced`,
                cls: 'bbab-tf-move-warning'
            });
        } else if (oldTags.length === 0 && newTags.length === 0) {
            tagSummaryEl.createDiv({
                text: `ℹ️ No auto-tags to change (no rules on source or destination)`,
                cls: 'bbab-tf-move-info'
            });
        } else if (newTags.length > 0) {
            tagSummaryEl.createDiv({
                text: `New tags from destination rules: ${newTags.map(t => '#' + t).join(', ')}`,
                cls: 'bbab-tf-move-new-tags'
            });
        }

        // Explanation with button descriptions
        const descEl = contentEl.createDiv({ cls: 'bbab-tf-move-description' });
        descEl.createEl('p', { text: 'Choose how to handle tags:' });
        const optionsList = descEl.createEl('ul', { cls: 'bbab-tf-move-options' });
        optionsList.createEl('li', { text: 'Continue — Remove old folder tags, apply new folder tags' });
        optionsList.createEl('li', { text: 'Leave Tags — Keep current tags, don\'t add new ones' });
        optionsList.createEl('li', { text: 'Cancel — Move file back to original folder' });

        // Remember choice checkbox
        const rememberLabel = contentEl.createEl('label', { cls: 'bbab-tf-remember-choice' });
        const rememberCb = rememberLabel.createEl('input', { type: 'checkbox' });
        rememberLabel.createSpan({ text: ' Remember my choice' });
        rememberCb.addEventListener('change', () => {
            this.rememberChoice = rememberCb.checked;
        });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-move-buttons' });

        const continueBtn = buttonContainer.createEl('button', {
            text: 'Continue',
            cls: 'mod-cta',
        });
        continueBtn.addEventListener('click', () => {
            this.close();
            this.onResult({ action: 'continue', remember: this.rememberChoice });
        });

        const leaveBtn = buttonContainer.createEl('button', {
            text: 'Leave Tags',
        });
        leaveBtn.addEventListener('click', () => {
            this.close();
            this.onResult({ action: 'leave', remember: this.rememberChoice });
        });

        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'mod-warning',
        });
        cancelBtn.addEventListener('click', () => {
            this.close();
            // Cancel doesn't respect "remember" - you wouldn't want to auto-cancel moves
            this.onResult({ action: 'cancel', remember: false });
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
