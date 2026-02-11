// src/modals/RulesManagementModal.ts
// Folder rules management modal with tree browser and rule editor

import { App, Modal, Notice, TFolder, Setting } from 'obsidian';
import type TagForgePlugin from '../../main';
import { FolderRule } from '../types';

export class RulesManagementModal extends Modal {
    plugin: TagForgePlugin;
    selectedFolder: string | null = null;
    expandedFolders: Set<string> = new Set();

    // UI references
    treeEl: HTMLElement | null = null;
    editorEl: HTMLElement | null = null;

    constructor(app: App, plugin: TagForgePlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('bbab-tf-large-modal');
        contentEl.addClass('bbab-tf-rules-modal');

        // Header
        const header = contentEl.createDiv({ cls: 'bbab-tf-modal-header' });
        header.createEl('h2', { text: 'Manage Folder Rules' });
        header.createEl('p', {
            text: 'Set up rules to automatically tag new files based on their folder location.',
            cls: 'bbab-tf-description',
        });

        // Stats bar
        const ruleCount = Object.keys(this.plugin.folderRules).length;
        const statsBar = header.createDiv({ cls: 'bbab-tf-rules-stats' });
        statsBar.createSpan({ text: `${ruleCount} rule${ruleCount !== 1 ? 's' : ''} configured` });

        // Two-column layout
        const columnsContainer = contentEl.createDiv({ cls: 'bbab-tf-columns' });

        // LEFT COLUMN - Folder Tree
        const leftColumn = columnsContainer.createDiv({ cls: 'bbab-tf-column-left' });

        // Folders header with expand/collapse buttons
        const foldersHeader = leftColumn.createDiv({ cls: 'bbab-tf-files-header' });
        foldersHeader.createEl('h3', { text: 'Folders' });

        const treeBtns = foldersHeader.createDiv({ cls: 'bbab-tf-selection-btns' });
        const expandAllBtn = treeBtns.createEl('button', { text: 'Expand All' });
        expandAllBtn.addEventListener('click', () => {
            const allFiles = this.app.vault.getAllLoadedFiles();
            for (const file of allFiles) {
                if (file instanceof TFolder && file.path !== '/') {
                    this.expandedFolders.add(file.path);
                }
            }
            this.renderTree();
        });

        const collapseAllBtn = treeBtns.createEl('button', { text: 'Collapse All' });
        collapseAllBtn.addEventListener('click', () => {
            this.expandedFolders.clear();
            this.renderTree();
        });

        this.treeEl = leftColumn.createDiv({ cls: 'bbab-tf-folder-tree' });
        this.renderTree();

        // RIGHT COLUMN - Rule Editor
        const rightColumn = columnsContainer.createDiv({ cls: 'bbab-tf-column-right' });
        this.editorEl = rightColumn;
        this.renderEditor();

        // Close button
        const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-button-container' });
        const closeBtn = buttonContainer.createEl('button', { text: 'Close' });
        closeBtn.addEventListener('click', () => this.close());
    }

    renderTree() {
        if (!this.treeEl) return;
        this.treeEl.empty();

        // Get all folders in vault
        const folders: string[] = [];
        this.app.vault.getAllLoadedFiles().forEach(file => {
            if (file instanceof TFolder && file.path !== '/') {
                folders.push(file.path);
            }
        });
        folders.sort();

        // Build tree structure
        const tree = this.buildFolderTree(folders);
        this.renderTreeNode(this.treeEl, tree, '');
    }

    buildFolderTree(folders: string[]): Map<string, string[]> {
        // Map parent path -> child folder names
        const tree = new Map<string, string[]>();
        tree.set('', []); // Root

        for (const folder of folders) {
            const parts = folder.split('/');
            let currentPath = '';

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                const parentPath = currentPath;
                currentPath = currentPath ? `${currentPath}/${part}` : part;

                if (!tree.has(parentPath)) {
                    tree.set(parentPath, []);
                }

                const children = tree.get(parentPath)!;
                if (!children.includes(part)) {
                    children.push(part);
                }
            }
        }

        return tree;
    }

    renderTreeNode(container: HTMLElement, tree: Map<string, string[]>, parentPath: string, depth: number = 0) {
        const children = tree.get(parentPath) || [];

        for (const childName of children.sort()) {
            const childPath = parentPath ? `${parentPath}/${childName}` : childName;
            const hasRule = this.plugin.folderRules[childPath] !== undefined;
            const hasChildren = (tree.get(childPath) || []).length > 0;
            const isExpanded = this.expandedFolders.has(childPath);
            const isSelected = this.selectedFolder === childPath;

            const itemEl = container.createDiv({
                cls: `bbab-tf-tree-item ${isSelected ? 'bbab-tf-tree-item-selected' : ''}`,
            });
            itemEl.style.paddingLeft = `${depth * 1.25}em`;

            // Expand/collapse toggle
            if (hasChildren) {
                const toggleEl = itemEl.createSpan({
                    cls: 'bbab-tf-tree-toggle',
                    text: isExpanded ? '▼' : '▶',
                });
                toggleEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isExpanded) {
                        this.expandedFolders.delete(childPath);
                    } else {
                        this.expandedFolders.add(childPath);
                    }
                    this.renderTree();
                });
            } else {
                itemEl.createSpan({ cls: 'bbab-tf-tree-toggle', text: ' ' });
            }

            // Folder name
            const nameEl = itemEl.createSpan({
                cls: 'bbab-tf-tree-name',
                text: childName,
            });

            // Rule indicator
            if (hasRule) {
                itemEl.createSpan({
                    cls: 'bbab-tf-tree-rule-indicator',
                    text: '●',
                    attr: { title: 'Has rule' },
                });
            } else {
                // Check if this folder inherits from a parent rule
                const inheritedRules = this.getParentRulesAffecting(childPath);
                if (inheritedRules.length > 0) {
                    itemEl.createSpan({
                        cls: 'bbab-tf-tree-rule-indicator-inherited',
                        text: '○',
                        attr: { title: `Inherits from: ${inheritedRules.map(r => r.path).join(', ')}` },
                    });
                }
            }

            // Click to select
            itemEl.addEventListener('click', () => {
                this.selectedFolder = childPath;
                this.renderTree();
                this.renderEditor();
            });

            // Render children if expanded
            if (hasChildren && isExpanded) {
                this.renderTreeNode(container, tree, childPath, depth + 1);
            }
        }
    }

    renderEditor() {
        if (!this.editorEl) return;
        this.editorEl.empty();

        this.editorEl.createEl('h3', { text: 'Rule Editor' });

        if (!this.selectedFolder) {
            this.editorEl.createEl('p', {
                text: 'Select a folder to view or create a rule.',
                cls: 'bbab-tf-description',
            });
            return;
        }

        const existingRule = this.plugin.folderRules[this.selectedFolder];

        // Folder path display
        const pathDisplay = this.editorEl.createDiv({ cls: 'bbab-tf-rule-path' });
        pathDisplay.createEl('strong', { text: 'Folder: ' });
        pathDisplay.createSpan({ text: this.selectedFolder });

        // Check for parent rules that affect this folder
        const parentRules = this.getParentRulesAffecting(this.selectedFolder);
        if (parentRules.length > 0) {
            const warningEl = this.editorEl.createDiv({ cls: 'bbab-tf-parent-rules-warning' });
            warningEl.createEl('strong', { text: '⚠ Parent rules also apply:' });
            const parentList = warningEl.createEl('ul');
            for (const pr of parentRules) {
                parentList.createEl('li', {
                    text: `${pr.path}: ${pr.rule.tags.join(', ')}`,
                });
            }
        }

        // Rule summary (only show if rule exists)
        if (existingRule) {
            const summaryEl = this.editorEl.createDiv({ cls: 'bbab-tf-rule-summary' });
            summaryEl.createEl('strong', { text: 'Current Rule Summary:' });
            const summaryLines: string[] = [];

            if (existingRule.tags.length > 0) {
                summaryLines.push(`Static tags: ${existingRule.tags.join(', ')}`);
            }
            if (existingRule.folderTagLevels.length > 0) {
                summaryLines.push(`Folder levels: ${existingRule.folderTagLevels.join(', ')}`);
            }
            const scope = existingRule.applyDownLevels === 'all' ? 'this folder + subfolders' : 'this folder only';
            summaryLines.push(`Scope: ${scope}`);
            summaryLines.push(`Inherits from parents: ${existingRule.inheritFromAncestors ? 'yes' : 'no'}`);
            summaryLines.push(`Auto-apply to new files: ${existingRule.applyToNewFiles ? 'yes' : 'no'}`);

            const summaryText = summaryEl.createEl('div', { cls: 'bbab-tf-rule-summary-text' });
            summaryText.textContent = summaryLines.join('\n');
        }

        // Form section
        const formEl = this.editorEl.createDiv({ cls: 'bbab-tf-rule-form' });

        // Folder-based tags section (dynamic levels based on folder structure)
        const levelSection = formEl.createDiv({ cls: 'bbab-tf-form-section' });
        levelSection.createEl('label', { text: 'Folder-based tags (dynamic)' });
        levelSection.createEl('p', {
            text: 'Check folder levels to derive tags from. These compute dynamically based on each file\'s path:',
            cls: 'bbab-tf-description',
        });

        const levelContainer = levelSection.createDiv({ cls: 'bbab-tf-level-checkboxes' });

        // Calculate the maximum depth available for this folder
        const currentFolderDepth = this.selectedFolder.split('/').length;
        const maxSubfolderDepth = this.getMaxSubfolderDepth(this.selectedFolder);
        const maxAvailableLevels = currentFolderDepth + maxSubfolderDepth;

        // Get existing folderTagLevels from rule
        const existingFolderLevels = existingRule?.folderTagLevels || [];

        for (let i = 1; i <= maxAvailableLevels; i++) {
            const levelLabel = levelContainer.createEl('label', { cls: 'bbab-tf-level-checkbox' });
            const levelCb = levelLabel.createEl('input', { type: 'checkbox' });
            levelCb.checked = existingFolderLevels.includes(i);
            levelCb.dataset.level = String(i);
            levelLabel.createSpan({ text: ` Level ${i}` });
        }

        // Additional/custom tags input (static tags)
        const tagsSection = formEl.createDiv({ cls: 'bbab-tf-form-section' });
        tagsSection.createEl('label', { text: 'Static tags (comma-separated)' });
        tagsSection.createEl('p', {
            text: 'Add fixed tags that always apply (e.g., project-type, status):',
            cls: 'bbab-tf-description',
        });
        const tagsInput = tagsSection.createEl('input', {
            type: 'text',
            cls: 'bbab-tf-rule-tags-input',
            placeholder: 'project, active, important',
        });
        // Show existing static tags
        if (existingRule) {
            tagsInput.value = existingRule.tags.join(', ');
        }

        // Apply to selector
        const applySection = formEl.createDiv({ cls: 'bbab-tf-form-section' });
        applySection.createEl('label', { text: 'Apply to' });

        const applyContainer = applySection.createDiv({ cls: 'bbab-tf-apply-options' });

        const folderOnlyLabel = applyContainer.createEl('label');
        const folderOnlyRadio = folderOnlyLabel.createEl('input', {
            type: 'radio',
            attr: { name: 'applyTo' },
        });
        folderOnlyLabel.createSpan({ text: ' This folder only' });

        const subfoldersLabel = applyContainer.createEl('label');
        const subfoldersRadio = subfoldersLabel.createEl('input', {
            type: 'radio',
            attr: { name: 'applyTo' },
        });
        subfoldersLabel.createSpan({ text: ' This folder + all subfolders' });

        // Set current value
        if (existingRule) {
            if (existingRule.applyDownLevels === 'all') {
                subfoldersRadio.checked = true;
            } else {
                folderOnlyRadio.checked = true;
            }
        } else {
            subfoldersRadio.checked = true; // Default
        }

        // Inherit from ancestors toggle
        const inheritSection = formEl.createDiv({ cls: 'bbab-tf-form-section' });
        const inheritLabel = inheritSection.createEl('label', { cls: 'bbab-tf-checkbox-label' });
        const inheritCb = inheritLabel.createEl('input', { type: 'checkbox' });
        inheritCb.checked = existingRule ? existingRule.inheritFromAncestors : true;  // Default to true (inherit)
        inheritLabel.createSpan({ text: ' Accept tags from parent folder rules' });
        inheritSection.createEl('small', {
            text: 'Uncheck to block parent rules from applying to this folder',
            cls: 'bbab-tf-form-hint'
        });

        // Apply to new files toggle
        const newFilesSection = formEl.createDiv({ cls: 'bbab-tf-form-section' });
        const newFilesLabel = newFilesSection.createEl('label', { cls: 'bbab-tf-checkbox-label' });
        const newFilesCb = newFilesLabel.createEl('input', { type: 'checkbox' });
        newFilesCb.checked = existingRule ? existingRule.applyToNewFiles : true;
        newFilesLabel.createSpan({ text: ' Apply to new files automatically' });

        // Buttons
        const buttonsEl = formEl.createDiv({ cls: 'bbab-tf-rule-buttons' });

        const saveBtn = buttonsEl.createEl('button', {
            text: existingRule ? 'Update Rule' : 'Create Rule',
            cls: 'mod-cta',
        });
        saveBtn.addEventListener('click', async () => {
            // Collect selected folder levels
            const folderTagLevels: number[] = [];
            const levelCheckboxes = formEl.querySelectorAll('.bbab-tf-level-checkbox input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
            levelCheckboxes.forEach(cb => {
                if (cb.checked && cb.dataset.level) {
                    folderTagLevels.push(parseInt(cb.dataset.level, 10));
                }
            });
            folderTagLevels.sort((a, b) => a - b);

            // Collect static tags from input
            const tags = tagsInput.value
                .split(',')
                .map(t => t.trim().replace(/^#/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, ''))
                .filter(t => t.length > 0);

            // Allow saving if: has tags, has folder levels, OR is a "barrier" rule (blocks parent inheritance)
            const isBarrierRule = !inheritCb.checked;
            if (folderTagLevels.length === 0 && tags.length === 0 && !isBarrierRule) {
                new Notice('Please select at least one folder level, enter a static tag, or uncheck "Accept tags from parent folder rules" to create a barrier');
                return;
            }

            const applyDownLevels: 'all' | number[] = subfoldersRadio.checked ? 'all' : [0];

            const rule: FolderRule = {
                tags,
                folderTagLevels,
                applyDownLevels,
                inheritFromAncestors: inheritCb.checked,
                applyToNewFiles: newFilesCb.checked,
                createdAt: existingRule?.createdAt || new Date().toISOString(),
                lastModified: new Date().toISOString(),
            };

            this.plugin.folderRules[this.selectedFolder!] = rule;
            await this.plugin.saveSettings();

            new Notice(`Rule ${existingRule ? 'updated' : 'created'} for ${this.selectedFolder}`);
            this.renderTree();
            this.renderEditor();
        });

        if (existingRule) {
            const deleteBtn = buttonsEl.createEl('button', {
                text: 'Delete Rule',
                cls: 'mod-warning',
            });
            deleteBtn.addEventListener('click', async () => {
                if (confirm(`Delete rule for ${this.selectedFolder}?`)) {
                    delete this.plugin.folderRules[this.selectedFolder!];
                    await this.plugin.saveSettings();
                    new Notice(`Rule deleted for ${this.selectedFolder}`);
                    this.renderTree();
                    this.renderEditor();
                }
            });

            // Apply to existing files button
            const applyNowBtn = buttonsEl.createEl('button', {
                text: 'Apply to Existing Files',
            });
            applyNowBtn.addEventListener('click', async () => {
                await this.applyRuleToExistingFiles();
            });
        }

        // Show rule metadata if exists
        if (existingRule) {
            const metaEl = this.editorEl.createDiv({ cls: 'bbab-tf-rule-meta' });
            metaEl.createEl('small', {
                text: `Created: ${new Date(existingRule.createdAt).toLocaleDateString()}`,
            });
            metaEl.createEl('small', {
                text: ` • Modified: ${new Date(existingRule.lastModified).toLocaleDateString()}`,
            });
        }
    }

    getParentRulesAffecting(folderPath: string): Array<{ path: string; rule: FolderRule }> {
        const result: Array<{ path: string; rule: FolderRule }> = [];
        const parts = folderPath.split('/');

        // Check each ancestor
        for (let i = 1; i < parts.length; i++) {
            const ancestorPath = parts.slice(0, i).join('/');
            const rule = this.plugin.folderRules[ancestorPath];

            if (rule) {
                // Check if this rule's applyDownLevels reaches our folder
                const levelsDown = parts.length - i;

                if (rule.applyDownLevels === 'all') {
                    result.push({ path: ancestorPath, rule });
                } else if (Array.isArray(rule.applyDownLevels) && rule.applyDownLevels.includes(levelsDown)) {
                    result.push({ path: ancestorPath, rule });
                }
            }
        }

        return result;
    }

    getMaxSubfolderDepth(folderPath: string): number {
        // Find the maximum depth of any subfolder under this folder
        let maxDepth = 0;
        const baseParts = folderPath.split('/').length;

        this.app.vault.getAllLoadedFiles().forEach(file => {
            if (file instanceof TFolder && file.path.startsWith(folderPath + '/')) {
                const depth = file.path.split('/').length - baseParts;
                if (depth > maxDepth) {
                    maxDepth = depth;
                }
            }
        });

        return maxDepth;
    }

    async applyRuleToExistingFiles() {
        if (!this.selectedFolder) return;

        const rule = this.plugin.folderRules[this.selectedFolder];
        if (!rule) return;

        // Get files in this folder (and subfolders if applicable)
        const files = this.app.vault.getMarkdownFiles().filter(file => {
            if (rule.applyDownLevels === 'all') {
                return file.path.startsWith(this.selectedFolder + '/');
            } else {
                // Only direct folder
                const fileFolder = file.path.substring(0, file.path.lastIndexOf('/'));
                return fileFolder === this.selectedFolder;
            }
        });

        if (files.length === 0) {
            new Notice('No files found to apply rule to');
            return;
        }

        let applied = 0;
        for (const file of files) {
            // Compute tags for this specific file using folderTagLevels
            const tagsToApply: string[] = [...rule.tags]; // Start with static tags

            // Add dynamic folder-based tags from folderTagLevels
            if (rule.folderTagLevels && rule.folderTagLevels.length > 0) {
                const fileParts = file.path.split('/');
                fileParts.pop(); // Remove filename to get folder parts

                for (const level of rule.folderTagLevels) {
                    const folderIndex = level - 1;
                    if (folderIndex >= 0 && folderIndex < fileParts.length) {
                        const folderName = fileParts[folderIndex];
                        const tag = this.plugin.folderNameToTag(folderName);
                        if (tag.length > 1 && /[a-z0-9]/.test(tag)) {
                            tagsToApply.push(tag);
                        }
                    }
                }
            }

            // Deduplicate
            const uniqueTags = [...new Set(tagsToApply)];

            if (uniqueTags.length === 0) continue;

            const existingTags = await this.plugin.getFileTags(file);
            const newTags = uniqueTags.filter(t => !existingTags.map(e => e.toLowerCase()).includes(t.toLowerCase()));

            if (newTags.length > 0) {
                await this.plugin.applyTagsToFile(file.path, newTags);
                applied++;
            }
        }

        new Notice(`Applied rule to ${applied} files`);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
