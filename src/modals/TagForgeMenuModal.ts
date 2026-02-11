// src/modals/TagForgeMenuModal.ts
// Quick-access menu modal with all TagForge commands grouped by function

import { App, Modal, Platform } from 'obsidian';
import type TagForgePlugin from '../../main';

/** Command definition for the menu. */
interface MenuCommand {
    label: string;
    icon: string;
    callback: () => void;
}

/** Group of related commands. */
interface MenuGroup {
    title: string;
    commands: MenuCommand[];
}

/**
 * Modal that shows all TagForge commands grouped by function
 * for quick access without memorizing command palette names.
 */
export class TagForgeMenuModal extends Modal {
    plugin: TagForgePlugin;

    constructor(app: App, plugin: TagForgePlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('bbab-tf-menu-modal');

        contentEl.createEl('h2', { text: '🏷️ TagForge' });

        const groups = this.getCommandGroups();

        for (const group of groups) {
            const groupEl = contentEl.createDiv({ cls: 'bbab-tf-menu-group' });
            groupEl.createEl('h3', { text: group.title, cls: 'bbab-tf-menu-group-title' });

            for (const cmd of group.commands) {
                const btnEl = groupEl.createEl('button', {
                    cls: 'bbab-tf-menu-item',
                });
                btnEl.createSpan({ text: cmd.icon, cls: 'bbab-tf-menu-icon' });
                btnEl.createSpan({ text: cmd.label, cls: 'bbab-tf-menu-label' });
                btnEl.addEventListener('click', () => {
                    this.close();
                    cmd.callback();
                });
            }
        }
    }

    /** Build the grouped command list. */
    private getCommandGroups(): MenuGroup[] {
        const groups: MenuGroup[] = [
            {
                title: '➕ Add Tags',
                commands: [
                    {
                        label: 'Tag current file',
                        icon: '📄',
                        callback: () => this.plugin.tagCurrentFile(),
                    },
                    {
                        label: 'Bulk add to specific folder',
                        icon: '📁',
                        callback: () => this.plugin.bulkOperations.bulkApplyToFolder(),
                    },
                    {
                        label: 'Bulk add to entire vault',
                        icon: '📦',
                        callback: () => this.plugin.bulkOperations.bulkApplyTags(),
                    },
                ],
            },
            {
                title: '🗑️ Remove Tags',
                commands: [
                    {
                        label: 'Remove from specific folder',
                        icon: '📂',
                        callback: () => this.plugin.revertService.revertAutoTagsByFolder(),
                    },
                    {
                        label: 'Remove by date',
                        icon: '📅',
                        callback: () => this.plugin.revertService.revertAutoTagsByDate(),
                    },
                    {
                        label: 'Undo all auto-applied tags',
                        icon: '↩️',
                        callback: () => this.plugin.revertService.revertAllAutoTags(),
                    },
                ],
            },
            {
                title: '⚙️ System',
                commands: [
                    {
                        label: 'Undo a recent operation',
                        icon: '⏪',
                        callback: () => this.plugin.showUndoHistory(),
                    },
                    {
                        label: 'View tag report',
                        icon: '📊',
                        callback: () => this.plugin.showTagReport(),
                    },
                    {
                        label: 'Check for tag issues',
                        icon: '🔍',
                        callback: () => this.plugin.validationService.validateTags(),
                    },
                ],
            },
        ];

        // Only show nuclear option on desktop
        if (!Platform.isMobile) {
            groups[1].commands.push({
                label: 'Nuclear: Remove ALL tags from vault',
                icon: '☢️',
                callback: () => this.plugin.revertService.revertAllTagsNuclear(),
            });
        }

        return groups;
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
