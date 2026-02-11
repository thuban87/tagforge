// src/modals/UndoHistoryModal.ts
// History viewer for undo operations

import { App, Modal } from 'obsidian';
import { TagOperation, UNDO_FILE_DISPLAY_LIMIT } from '../types';

export class UndoHistoryModal extends Modal {
    operations: TagOperation[];
    onUndo: (operation: TagOperation) => void;

    constructor(
        app: App,
        operations: TagOperation[],
        onUndo: (operation: TagOperation) => void
    ) {
        super(app);
        this.operations = operations;
        this.onUndo = onUndo;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('bbab-tf-large-modal');
        contentEl.addClass('bbab-tf-undo-history-modal');

        contentEl.createEl('h2', { text: 'Undo History' });
        contentEl.createEl('p', {
            text: `${this.operations.length} operation(s) available to undo`,
            cls: 'bbab-tf-description',
        });

        const listEl = contentEl.createDiv({ cls: 'bbab-tf-undo-list' });

        for (const op of this.operations) {
            const itemEl = listEl.createDiv({ cls: 'bbab-tf-undo-item' });

            // Header row with expand toggle
            const headerEl = itemEl.createDiv({ cls: 'bbab-tf-undo-header' });

            const infoEl = headerEl.createDiv({ cls: 'bbab-tf-undo-info' });

            // Expand toggle
            const expandBtn = infoEl.createEl('button', {
                text: '▶',
                cls: 'bbab-tf-undo-expand-toggle',
            });

            // Operation type badge
            const typeBadge = infoEl.createSpan({ cls: `bbab-tf-undo-type bbab-tf-type-${op.type}` });
            typeBadge.textContent = this.getOperationLabel(op.type);

            // Description
            infoEl.createSpan({ text: op.description, cls: 'bbab-tf-undo-description' });

            // Undo button in header
            const undoBtn = headerEl.createEl('button', {
                text: 'Undo',
                cls: 'bbab-tf-undo-btn',
            });
            undoBtn.addEventListener('click', () => {
                this.close();
                this.onUndo(op);
            });

            // Details row
            const detailsEl = itemEl.createDiv({ cls: 'bbab-tf-undo-details' });
            const date = new Date(op.timestamp);
            detailsEl.createSpan({
                text: `${date.toLocaleDateString()} ${date.toLocaleTimeString()} • ${op.files.length} file(s)`,
                cls: 'bbab-tf-undo-meta',
            });

            // Expandable file list (hidden by default)
            const filesEl = itemEl.createDiv({ cls: 'bbab-tf-undo-files hidden' });

            // Get unique folders for bulk operations, or file names for single ops
            if (op.files.length > 10) {
                // For large operations, group by folder
                const folders = new Map<string, number>();
                for (const f of op.files) {
                    const folder = f.path.split('/').slice(0, -1).join('/') || '(root)';
                    folders.set(folder, (folders.get(folder) || 0) + 1);
                }
                const sortedFolders = Array.from(folders.entries()).sort((a, b) => b[1] - a[1]);
                const displayFolders = sortedFolders.slice(0, UNDO_FILE_DISPLAY_LIMIT);

                for (const [folder, count] of displayFolders) {
                    filesEl.createDiv({
                        text: `${folder}/ (${count} file${count > 1 ? 's' : ''})`,
                        cls: 'bbab-tf-undo-file',
                    });
                }

                if (sortedFolders.length > UNDO_FILE_DISPLAY_LIMIT) {
                    filesEl.createDiv({
                        text: `... and ${sortedFolders.length - UNDO_FILE_DISPLAY_LIMIT} more folders`,
                        cls: 'bbab-tf-undo-file bbab-tf-undo-more',
                    });
                }
            } else {
                // For small operations, show individual files
                for (const f of op.files.slice(0, UNDO_FILE_DISPLAY_LIMIT)) {
                    const fileName = f.path.split('/').pop() || f.path;
                    filesEl.createDiv({
                        text: fileName,
                        cls: 'bbab-tf-undo-file',
                    });
                }

                if (op.files.length > UNDO_FILE_DISPLAY_LIMIT) {
                    filesEl.createDiv({
                        text: `... and ${op.files.length - UNDO_FILE_DISPLAY_LIMIT} more files`,
                        cls: 'bbab-tf-undo-file bbab-tf-undo-more',
                    });
                }
            }

            // Toggle expand
            expandBtn.addEventListener('click', () => {
                filesEl.classList.toggle('hidden');
                expandBtn.textContent = filesEl.classList.contains('hidden') ? '▶' : '▼';
            });
        }

        // Cancel button
        const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-button-container' });
        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => {
            this.close();
        });
    }

    getOperationLabel(type: TagOperation['type']): string {
        switch (type) {
            case 'apply': return 'APPLY';
            case 'remove': return 'REMOVE';
            case 'bulk': return 'BULK ADD';
            case 'move': return 'MOVE';
            case 'revert': return 'REMOVE';  // Revert is a removal operation
            default: return type.toUpperCase();
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
