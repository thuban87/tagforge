// src/modals/FolderPickerModal.ts
// Folder selection modal for folder-scoped operations

import { App, Modal } from 'obsidian';

export class FolderPickerModal extends Modal {
    folders: string[];
    onSelect: (folder: string, includeSubdirs: boolean) => void;
    filteredFolders: string[];
    includeSubdirs: boolean = true;

    constructor(app: App, folders: string[], onSelect: (folder: string, includeSubdirs: boolean) => void) {
        super(app);
        this.folders = folders;
        this.filteredFolders = folders;
        this.onSelect = onSelect;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('bbab-tf-large-modal');
        contentEl.addClass('bbab-tf-folder-picker-modal');

        contentEl.createEl('h2', { text: 'Select folder to tag' });

        // Include subdirectories option
        const optionsDiv = contentEl.createDiv({ cls: 'bbab-tf-folder-options' });
        const subdirsLabel = optionsDiv.createEl('label', { cls: 'bbab-tf-subdirs-option' });
        const subdirsCheckbox = subdirsLabel.createEl('input', { type: 'checkbox' });
        subdirsCheckbox.checked = this.includeSubdirs;
        subdirsLabel.createSpan({ text: ' Include subdirectories' });
        subdirsCheckbox.addEventListener('change', () => {
            this.includeSubdirs = subdirsCheckbox.checked;
        });

        // Search input
        const searchInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: 'Type to filter folders...',
            cls: 'bbab-tf-folder-search',
        });

        const listEl = contentEl.createDiv({ cls: 'bbab-tf-folder-list' });

        const renderList = () => {
            listEl.empty();
            for (const folder of this.filteredFolders) {
                const itemEl = listEl.createDiv({
                    cls: 'bbab-tf-folder-item',
                    text: folder,
                });
                itemEl.addEventListener('click', () => {
                    this.close();
                    this.onSelect(folder, this.includeSubdirs);
                });
            }
        };

        searchInput.addEventListener('input', () => {
            const query = searchInput.value.toLowerCase();
            this.filteredFolders = this.folders.filter(f =>
                f.toLowerCase().includes(query)
            );
            renderList();
        });

        renderList();

        // Focus search input
        searchInput.focus();

        // Cancel button
        const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-button-container' });
        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => {
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
