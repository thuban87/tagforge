// src/modals/DatePickerModal.ts
// Date selection modal for revert-by-date operations

import { App, Modal, Notice } from 'obsidian';

export class DatePickerModal extends Modal {
    dates: string[];
    dateMap: Record<string, string[]>;
    onSubmit: (selectedDates: string[]) => void;
    selectedDates: Set<string> = new Set();

    constructor(
        app: App,
        dates: string[],
        dateMap: Record<string, string[]>,
        onSubmit: (selectedDates: string[]) => void
    ) {
        super(app);
        this.dates = dates;
        this.dateMap = dateMap;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('bbab-tf-large-modal');
        contentEl.addClass('bbab-tf-date-picker-modal');

        contentEl.createEl('h2', { text: 'Select dates to revert' });
        contentEl.createEl('p', {
            text: 'Choose which dates to remove auto-applied tags from:',
            cls: 'bbab-tf-description',
        });

        const listEl = contentEl.createDiv({ cls: 'bbab-tf-date-list' });

        for (const date of this.dates) {
            const fileCount = this.dateMap[date].length;
            const itemEl = listEl.createDiv({ cls: 'bbab-tf-date-item' });

            const checkbox = itemEl.createEl('input', {
                type: 'checkbox',
                attr: { id: `date-${date}` },
            });

            const label = itemEl.createEl('label', {
                text: `${date} (${fileCount} file${fileCount !== 1 ? 's' : ''})`,
                attr: { for: `date-${date}` },
            });

            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.selectedDates.add(date);
                } else {
                    this.selectedDates.delete(date);
                }
            });
        }

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-button-container' });

        const selectAllBtn = buttonContainer.createEl('button', { text: 'Select All' });
        selectAllBtn.addEventListener('click', () => {
            const checkboxes = listEl.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
            checkboxes.forEach(cb => {
                cb.checked = true;
                const date = cb.id.replace('date-', '');
                this.selectedDates.add(date);
            });
        });

        const selectNoneBtn = buttonContainer.createEl('button', { text: 'Select None' });
        selectNoneBtn.addEventListener('click', () => {
            const checkboxes = listEl.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
            checkboxes.forEach(cb => {
                cb.checked = false;
            });
            this.selectedDates.clear();
        });

        const revertBtn = buttonContainer.createEl('button', {
            text: 'Revert Selected',
            cls: 'mod-cta',
        });
        revertBtn.addEventListener('click', () => {
            if (this.selectedDates.size === 0) {
                new Notice('No dates selected');
                return;
            }
            this.close();
            this.onSubmit(Array.from(this.selectedDates));
        });

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
