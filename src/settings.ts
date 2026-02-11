import { App, PluginSettingTab, Setting, Notice, TFolder } from 'obsidian';
import type TagForgePlugin from '../main';
import { TagForgeSettings } from './types';
import { RulesManagementModal } from './modals/RulesManagementModal';

export class TagForgeSettingTab extends PluginSettingTab {
    plugin: TagForgePlugin;

    constructor(app: App, plugin: TagForgePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('bbab-tf-settings-container');

        // Header
        containerEl.createEl('h1', { text: 'TagForge Settings' });
        containerEl.createEl('p', {
            text: 'Automatic hierarchical tag management based on folder structure.',
            cls: 'bbab-tf-description',
        });

        // -------------------------------------------------------------------------
        // Core Settings
        // -------------------------------------------------------------------------

        containerEl.createEl('h2', { text: 'Core Settings' });

        new Setting(containerEl)
            .setName('Enable auto-tagging')
            .setDesc('Automatically tag new files based on their folder location')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoTagEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.autoTagEnabled = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Inheritance depth')
            .setDesc('How many folder levels to inherit tags from (e.g., 3 = top 3 folders)')
            .addText(text => text
                .setPlaceholder('3')
                .setValue(String(this.plugin.settings.inheritDepth))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num >= 1) {
                        this.plugin.settings.inheritDepth = num;
                        await this.plugin.saveSettings();
                    }
                }));

        // Determine current move behavior for dropdown
        let currentMoveBehavior: string;
        if (!this.plugin.settings.showMoveConfirmation) {
            currentMoveBehavior = 'always-retag';
        } else if (this.plugin.settings.rememberedMoveAction === 'continue') {
            currentMoveBehavior = 'always-retag';
        } else if (this.plugin.settings.rememberedMoveAction === 'leave') {
            currentMoveBehavior = 'always-keep';
        } else {
            currentMoveBehavior = 'ask';
        }

        new Setting(containerEl)
            .setName('When files are moved')
            .setDesc('Choose how to handle tags when files move between folders')
            .addDropdown(dropdown => dropdown
                .addOption('ask', 'Ask every time')
                .addOption('always-retag', 'Always retag (remove old, add new)')
                .addOption('always-keep', 'Always keep current tags')
                .setValue(currentMoveBehavior)
                .onChange(async (value) => {
                    if (value === 'ask') {
                        this.plugin.settings.showMoveConfirmation = true;
                        this.plugin.settings.rememberedMoveAction = null;
                    } else if (value === 'always-retag') {
                        this.plugin.settings.showMoveConfirmation = false;
                        this.plugin.settings.rememberedMoveAction = null;
                    } else if (value === 'always-keep') {
                        this.plugin.settings.showMoveConfirmation = true;
                        this.plugin.settings.rememberedMoveAction = 'leave';
                    }
                    await this.plugin.saveSettings();
                }));

        // -------------------------------------------------------------------------
        // Folder Rules (Phase 10)
        // -------------------------------------------------------------------------

        containerEl.createEl('h2', { text: 'Folder Rules' });
        containerEl.createEl('p', {
            text: 'Set up rules to automatically tag new files based on their folder location.',
            cls: 'bbab-tf-description',
        });

        const ruleCount = Object.keys(this.plugin.folderRules).length;
        new Setting(containerEl)
            .setName('Manage folder rules')
            .setDesc(`${ruleCount} rule${ruleCount !== 1 ? 's' : ''} configured. Click to view, create, or edit rules.`)
            .addButton(button => button
                .setButtonText('Open Rules Manager')
                .setCta()
                .onClick(() => {
                    new RulesManagementModal(this.app, this.plugin).open();
                }));

        // -------------------------------------------------------------------------
        // Ignore Paths
        // -------------------------------------------------------------------------

        containerEl.createEl('h2', { text: 'Ignore Paths' });
        containerEl.createEl('p', {
            text: 'Folders to skip when auto-tagging (one per line)',
            cls: 'bbab-tf-description',
        });

        new Setting(containerEl)
            .setName('Ignored folders')
            .setDesc('Files in these folders will not be auto-tagged')
            .addTextArea(text => text
                .setPlaceholder('Templates\n.obsidian\nArchive')
                .setValue(this.plugin.settings.ignorePaths.join('\n'))
                .onChange(async (value) => {
                    this.plugin.settings.ignorePaths = value
                        .split('\n')
                        .map(p => p.trim())
                        .filter(p => p.length > 0);
                    await this.plugin.saveSettings();
                }));

        // -------------------------------------------------------------------------
        // Protected Tags
        // -------------------------------------------------------------------------

        containerEl.createEl('h2', { text: 'Protected Tags' });
        containerEl.createEl('p', {
            text: 'Tags that TagForge removal commands will never delete. Protected tags can still be applied by rules. (One per line, without #)',
            cls: 'bbab-tf-description',
        });

        new Setting(containerEl)
            .setName('Protected tags')
            .setDesc('These tags will never be removed by TagForge removal commands. They can still be added.')
            .addTextArea(text => text
                .setPlaceholder('important\nfavorite\npinned')
                .setValue(this.plugin.settings.protectedTags.join('\n'))
                .onChange(async (value) => {
                    this.plugin.settings.protectedTags = value
                        .split('\n')
                        .map(t => t.trim().replace(/^#/, '').toLowerCase())
                        .filter(t => t.length > 0);
                    await this.plugin.saveSettings();
                }));

        // -------------------------------------------------------------------------
        // Folder Aliases
        // -------------------------------------------------------------------------

        containerEl.createEl('h2', { text: 'Folder Aliases' });
        containerEl.createEl('p', {
            text: 'Override auto-generated tag names for specific folders. Useful when folder names don\'t match desired tags.',
            cls: 'bbab-tf-description',
        });

        const aliasContainer = containerEl.createDiv({ cls: 'bbab-tf-alias-container' });

        const renderAliases = () => {
            aliasContainer.empty();

            const aliases = Object.entries(this.plugin.settings.folderAliases);

            if (aliases.length === 0) {
                aliasContainer.createEl('p', {
                    text: 'No aliases configured. Add one below.',
                    cls: 'bbab-tf-no-aliases',
                });
            } else {
                for (const [folderPath, tagNames] of aliases) {
                    const aliasRow = aliasContainer.createDiv({ cls: 'bbab-tf-alias-row' });

                    aliasRow.createSpan({ text: folderPath, cls: 'bbab-tf-alias-folder' });
                    aliasRow.createSpan({ text: ' → ', cls: 'bbab-tf-alias-arrow' });

                    // Handle both old format (string) and new format (string[])
                    const tagsArray = Array.isArray(tagNames) ? tagNames : [tagNames];
                    aliasRow.createSpan({
                        text: tagsArray.map(t => '#' + t).join(', '),
                        cls: 'bbab-tf-alias-tag',
                    });

                    const removeBtn = aliasRow.createEl('button', { text: '×', cls: 'bbab-tf-alias-remove' });
                    removeBtn.addEventListener('click', async () => {
                        delete this.plugin.settings.folderAliases[folderPath];
                        await this.plugin.saveSettings();
                        renderAliases();
                    });
                }
            }

            // Add new alias form
            const addForm = aliasContainer.createDiv({ cls: 'bbab-tf-alias-add-form' });

            // Folder input with autocomplete
            const folderInputWrapper = addForm.createDiv({ cls: 'bbab-tf-alias-input-wrapper' });
            const folderInput = folderInputWrapper.createEl('input', {
                type: 'text',
                placeholder: 'Folder path (e.g., Personal/Projects)',
                cls: 'bbab-tf-alias-input',
            });
            const suggestionList = folderInputWrapper.createDiv({ cls: 'bbab-tf-folder-suggestions' });

            // Get all vault folders for autocomplete
            const getAllFolders = (): string[] => {
                const folders: string[] = [];
                const rootFolder = this.app.vault.getRoot();
                const collectFolders = (folder: TFolder) => {
                    for (const child of folder.children) {
                        if (child instanceof TFolder) {
                            folders.push(child.path);
                            collectFolders(child);
                        }
                    }
                };
                collectFolders(rootFolder);
                return folders.sort();
            };

            const updateSuggestions = () => {
                const query = folderInput.value.trim().toLowerCase();
                suggestionList.empty();

                if (query.length === 0) {
                    suggestionList.style.display = 'none';
                    return;
                }

                const folders = getAllFolders().filter(f => f.toLowerCase().includes(query));

                if (folders.length === 0) {
                    suggestionList.style.display = 'none';
                    return;
                }

                // Show max 8 suggestions
                const shown = folders.slice(0, 8);
                for (const folder of shown) {
                    const item = suggestionList.createDiv({ cls: 'bbab-tf-folder-suggestion-item' });
                    item.textContent = folder;
                    item.addEventListener('click', () => {
                        folderInput.value = folder;
                        suggestionList.style.display = 'none';
                        folderInput.focus();
                    });
                }

                if (folders.length > 8) {
                    const more = suggestionList.createDiv({ cls: 'bbab-tf-folder-suggestion-more' });
                    more.textContent = `... and ${folders.length - 8} more`;
                }

                suggestionList.style.display = 'block';
            };

            folderInput.addEventListener('input', updateSuggestions);
            folderInput.addEventListener('focus', updateSuggestions);

            // Hide suggestions when clicking outside
            document.addEventListener('click', (e) => {
                if (!folderInputWrapper.contains(e.target as Node)) {
                    suggestionList.style.display = 'none';
                }
            });

            const tagInput = addForm.createEl('input', {
                type: 'text',
                placeholder: 'Tags (comma-separated, e.g., dating, relationships)',
                cls: 'bbab-tf-alias-input',
            });

            const addBtn = addForm.createEl('button', { text: 'Add Alias' });
            addBtn.addEventListener('click', async () => {
                const folder = folderInput.value.trim();
                const tagsRaw = tagInput.value;

                // Parse comma-separated tags
                const tags = tagsRaw
                    .split(',')
                    .map(t => t.trim().replace(/^#/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, ''))
                    .filter(t => t.length > 0);

                if (folder && tags.length > 0) {
                    this.plugin.settings.folderAliases[folder] = tags;
                    await this.plugin.saveSettings();
                    folderInput.value = '';
                    tagInput.value = '';
                    renderAliases();
                }
            });
        };

        renderAliases();

        // -------------------------------------------------------------------------
        // Info Section
        // -------------------------------------------------------------------------

        containerEl.createEl('h2', { text: 'Quick Start' });

        const infoDiv = containerEl.createDiv({ cls: 'bbab-tf-info' });
        infoDiv.createEl('p', {
            text: 'TagForge automatically converts folder names to tags:',
        });

        const exampleDiv = infoDiv.createDiv({ cls: 'bbab-tf-example' });
        exampleDiv.createEl('code', {
            text: 'Health/Therapy/Notes/session.md',
        });
        exampleDiv.createEl('span', { text: ' → ' });
        exampleDiv.createEl('code', {
            text: '#health #therapy #notes',
        });

        infoDiv.createEl('p', {
            text: 'Use the command palette (Ctrl+P) and search for "TagForge" to manually tag files.',
        });
    }
}
