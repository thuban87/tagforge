// src/modals/BulkPreviewModal.ts
// Enhanced bulk preview modal with per-file tag editing, folder tree view, and rule saving

import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import type TagForgePlugin from '../../main';
import { EnhancedPreviewItem, FolderRule } from '../types';

export class BulkPreviewModal extends Modal {
    plugin: TagForgePlugin;
    items: EnhancedPreviewItem[];
    targetDescription: string;
    targetFolder: string | null;  // null for entire vault, folder path otherwise
    onConfirm: (results: Array<{ file: TFile; tagsToAdd: string[]; tagsToRemove: string[] }>) => void;
    inheritDepth: number;

    // State
    selectedFiles: Set<string> = new Set();
    enabledLevels: Set<number> = new Set();
    skipAllFolderTags: boolean = false;
    additionalTags: string[] = [];
    additionalTagsToSelectedOnly: boolean = false;
    maxLevel: number = 0;
    expandedFolders: Set<string> = new Set(); // Track which folder groups are expanded

    // Edit mode state
    isEditMode: boolean = false;
    allowManualTagEditing: boolean = false;
    tagsToDelete: Map<string, Set<string>> = new Map(); // filePath → tags marked for deletion

    // Phase 10: Save as rule state
    saveAsRule: boolean = false;
    ruleApplyTo: 'folder' | 'subfolders' = 'subfolders';

    // UI references for updates
    listEl: HTMLElement | null = null;
    applyBtn: HTMLButtonElement | null = null;
    statsEl: HTMLElement | null = null;
    editButtonsContainer: HTMLElement | null = null;
    rightColumn: HTMLElement | null = null;

    constructor(
        app: App,
        plugin: TagForgePlugin,
        items: EnhancedPreviewItem[],
        targetDescription: string,
        targetFolder: string | null,
        inheritDepth: number,
        onConfirm: (results: Array<{ file: TFile; tagsToAdd: string[]; tagsToRemove: string[] }>) => void
    ) {
        super(app);
        this.plugin = plugin;
        this.items = items;
        this.targetDescription = targetDescription;
        this.targetFolder = targetFolder;
        this.inheritDepth = inheritDepth;
        this.onConfirm = onConfirm;

        // Initialize: all files selected, levels enabled up to inheritDepth
        for (const item of items) {
            this.selectedFiles.add(item.file.path);
            const levels = item.folderTagsByLevel.length;
            if (levels > this.maxLevel) this.maxLevel = levels;
        }
        // Only enable levels up to the inheritance depth setting
        const levelsToEnable = Math.min(this.maxLevel, this.inheritDepth);
        for (let i = 1; i <= levelsToEnable; i++) {
            this.enabledLevels.add(i);
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('bbab-tf-large-modal');
        contentEl.addClass('bbab-tf-bulk-preview-modal');

        // Header
        const header = contentEl.createDiv({ cls: 'bbab-tf-modal-header' });
        header.createEl('h2', { text: 'Preview: Bulk Tag Application' });
        header.createEl('p', {
            text: `Configuring tags for ${this.items.length} files in ${this.targetDescription}`,
            cls: 'bbab-tf-description',
        });

        // Two-column layout container
        const columnsContainer = contentEl.createDiv({ cls: 'bbab-tf-columns' });

        // LEFT COLUMN - File Tree
        const leftColumn = columnsContainer.createDiv({ cls: 'bbab-tf-column-left' });

        // Files header with stats and selection buttons
        const filesHeader = leftColumn.createDiv({ cls: 'bbab-tf-files-header' });
        this.statsEl = filesHeader.createEl('h3', { text: 'Files' });

        const selectionBtns = filesHeader.createDiv({ cls: 'bbab-tf-selection-btns' });
        const selectAllBtn = selectionBtns.createEl('button', { text: 'Select All' });
        selectAllBtn.addEventListener('click', () => {
            this.items.forEach(item => this.selectedFiles.add(item.file.path));
            this.renderList();
        });

        const selectNoneBtn = selectionBtns.createEl('button', { text: 'Select None' });
        selectNoneBtn.addEventListener('click', () => {
            this.selectedFiles.clear();
            this.renderList();
        });

        const expandAllBtn = selectionBtns.createEl('button', { text: 'Expand All' });
        expandAllBtn.addEventListener('click', () => {
            // Get all folder paths from items
            for (const item of this.items) {
                const folderPath = this.getParentFolder(item.file.path);
                this.expandedFolders.add(folderPath);
            }
            this.renderList();
        });

        const collapseAllBtn = selectionBtns.createEl('button', { text: 'Collapse All' });
        collapseAllBtn.addEventListener('click', () => {
            this.expandedFolders.clear();
            this.renderList();
        });

        // File list (scrollable)
        this.listEl = leftColumn.createDiv({ cls: 'bbab-tf-preview' });
        this.renderList();

        // Edit mode buttons container
        this.editButtonsContainer = leftColumn.createDiv({ cls: 'bbab-tf-edit-buttons' });
        this.renderEditButtons();

        // RIGHT COLUMN - Controls
        this.rightColumn = columnsContainer.createDiv({ cls: 'bbab-tf-column-right' });

        // Folder Tags Section
        const folderSection = this.rightColumn.createDiv({ cls: 'bbab-tf-section' });
        folderSection.createEl('h3', { text: 'Folder Tags' });

        const levelContainer = folderSection.createDiv({ cls: 'bbab-tf-level-toggles' });

        // Level checkboxes
        for (let level = 1; level <= this.maxLevel; level++) {
            const levelLabel = levelContainer.createEl('label', { cls: 'bbab-tf-level-toggle' });
            const levelCb = levelLabel.createEl('input', { type: 'checkbox' });
            levelCb.checked = this.enabledLevels.has(level);
            levelCb.disabled = this.skipAllFolderTags;
            levelLabel.createSpan({ text: `Level ${level}` });

            levelCb.addEventListener('change', () => {
                if (levelCb.checked) {
                    this.enabledLevels.add(level);
                } else {
                    this.enabledLevels.delete(level);
                }
                this.renderList();
            });
        }

        // Skip all checkbox
        const skipLabel = levelContainer.createEl('label', { cls: 'bbab-tf-level-toggle bbab-tf-skip-all' });
        const skipCb = skipLabel.createEl('input', { type: 'checkbox' });
        skipCb.checked = this.skipAllFolderTags;
        skipLabel.createSpan({ text: 'Skip all folder tags' });

        skipCb.addEventListener('change', () => {
            this.skipAllFolderTags = skipCb.checked;
            // Disable/enable level checkboxes
            const levelCbs = levelContainer.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
            levelCbs.forEach((cb, i) => {
                if (i < this.maxLevel) cb.disabled = this.skipAllFolderTags;
            });
            this.renderList();
        });

        // Additional Tags Section
        const additionalSection = this.rightColumn.createDiv({ cls: 'bbab-tf-section' });
        additionalSection.createEl('h3', { text: 'Additional Tags' });

        const additionalInput = additionalSection.createEl('input', {
            type: 'text',
            placeholder: 'Tags separated by commas',
            cls: 'bbab-tf-additional-input',
        });
        additionalInput.addEventListener('input', () => {
            this.additionalTags = additionalInput.value
                .split(',')
                .map(t => t.trim().replace(/^#/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, ''))
                .filter(t => t.length > 0);
            this.renderList();
        });

        // Apply to all/selected radio
        additionalSection.createEl('p', {
            text: 'Apply additional tags to:',
            cls: 'bbab-tf-description',
        });
        const applyToContainer = additionalSection.createDiv({ cls: 'bbab-tf-apply-to' });

        const allLabel = applyToContainer.createEl('label');
        const allRadio = allLabel.createEl('input', { type: 'radio', attr: { name: 'applyTo' } });
        allRadio.checked = true;
        allLabel.createSpan({ text: ' All files in list' });

        const selectedLabel = applyToContainer.createEl('label');
        const selectedRadio = selectedLabel.createEl('input', { type: 'radio', attr: { name: 'applyTo' } });
        selectedLabel.createSpan({ text: ' Checked files only' });

        allRadio.addEventListener('change', () => {
            this.additionalTagsToSelectedOnly = false;
            this.renderList();
        });
        selectedRadio.addEventListener('change', () => {
            this.additionalTagsToSelectedOnly = true;
            this.renderList();
        });

        // Phase 10: Save as Rule Section (only show for folder-based bulk add)
        if (this.targetFolder !== null) {
            const ruleSection = this.rightColumn.createDiv({ cls: 'bbab-tf-section bbab-tf-rule-section' });
            ruleSection.createEl('h3', { text: 'Folder Rule' });

            const ruleCheckContainer = ruleSection.createDiv({ cls: 'bbab-tf-rule-check' });
            const ruleLabel = ruleCheckContainer.createEl('label');
            const ruleCb = ruleLabel.createEl('input', { type: 'checkbox' });
            ruleCb.checked = this.saveAsRule;
            ruleLabel.createSpan({ text: ' Save as folder rule' });

            const ruleDescription = ruleSection.createEl('p', {
                text: 'When enabled, new files in this folder will automatically receive these tags.',
                cls: 'bbab-tf-rule-description setting-item-description',
            });

            const ruleOptionsContainer = ruleSection.createDiv({ cls: 'bbab-tf-rule-options' });
            ruleOptionsContainer.style.display = this.saveAsRule ? 'block' : 'none';

            const folderOnlyLabel = ruleOptionsContainer.createEl('label');
            const folderOnlyRadio = folderOnlyLabel.createEl('input', { type: 'radio', attr: { name: 'ruleApplyTo' } });
            folderOnlyRadio.checked = this.ruleApplyTo === 'folder';
            folderOnlyLabel.createSpan({ text: ' This folder only' });

            const subfoldersLabel = ruleOptionsContainer.createEl('label');
            const subfoldersRadio = subfoldersLabel.createEl('input', { type: 'radio', attr: { name: 'ruleApplyTo' } });
            subfoldersRadio.checked = this.ruleApplyTo === 'subfolders';
            subfoldersLabel.createSpan({ text: ' This folder + all subfolders' });

            ruleCb.addEventListener('change', () => {
                this.saveAsRule = ruleCb.checked;
                ruleOptionsContainer.style.display = this.saveAsRule ? 'block' : 'none';
            });

            folderOnlyRadio.addEventListener('change', () => {
                if (folderOnlyRadio.checked) this.ruleApplyTo = 'folder';
            });

            subfoldersRadio.addEventListener('change', () => {
                if (subfoldersRadio.checked) this.ruleApplyTo = 'subfolders';
            });
        }

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-button-container' });

        this.applyBtn = buttonContainer.createEl('button', {
            text: `Apply`,
            cls: 'mod-cta',
        }) as HTMLButtonElement;
        this.applyBtn.addEventListener('click', async () => {
            const results = this.computeFinalResults();
            if (results.length === 0 && !this.saveAsRule) {
                new Notice('No changes to apply');
                return;
            }

            // Phase 10: Save folder rule if requested
            if (this.saveAsRule && this.targetFolder !== null) {
                await this.saveRule();
            }

            this.close();
            this.onConfirm(results);
        });

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => {
            this.close();
        });
    }

    renderList() {
        if (!this.listEl) return;

        // Preserve scroll position
        const scrollTop = this.listEl.scrollTop;

        this.listEl.empty();

        let filesWithChanges = 0;

        // Group items by parent folder
        const folderGroups = new Map<string, EnhancedPreviewItem[]>();
        for (const item of this.items) {
            const folderPath = this.getParentFolder(item.file.path);
            if (!folderGroups.has(folderPath)) {
                folderGroups.set(folderPath, []);
            }
            folderGroups.get(folderPath)!.push(item);
        }

        // Get all folders in scope (including empty ones)
        const allFoldersInScope = new Set<string>(folderGroups.keys());
        this.app.vault.getAllLoadedFiles().forEach(file => {
            if (file instanceof TFolder && file.path !== '/') {
                // Check if folder is in scope
                if (this.targetFolder === null) {
                    // Entire vault - include all folders
                    allFoldersInScope.add(file.path);
                } else if (file.path.startsWith(this.targetFolder + '/') || file.path === this.targetFolder) {
                    // Within target folder
                    allFoldersInScope.add(file.path);
                }
            }
        });

        // Sort folders alphabetically
        const sortedFolders = Array.from(allFoldersInScope).sort();

        for (const folderPath of sortedFolders) {
            const folderItems = folderGroups.get(folderPath) || [];
            const isEmpty = folderItems.length === 0;
            const isExpanded = this.expandedFolders.has(folderPath);

            // Count files with changes and selected files in this folder
            let folderChanges = 0;
            let folderSelected = 0;
            const folderTagsPreview: string[] = [];

            for (const item of folderItems) {
                const folderTags = this.computeFolderTags(item);
                const additionalTags = this.getAdditionalTagsForFile(item);
                const allNewTags = [...new Set([...folderTags, ...additionalTags])];
                const tagsToAdd = allNewTags.filter(t => !item.currentTags.includes(t));
                const deletionsForFile = this.tagsToDelete.get(item.file.path);
                const hasChanges = tagsToAdd.length > 0 || (deletionsForFile && deletionsForFile.size > 0);
                if (hasChanges) {
                    folderChanges++;
                    filesWithChanges++;
                }
                if (this.selectedFiles.has(item.file.path)) {
                    folderSelected++;
                }
                // Collect unique tags for this folder (from first file as example)
                if (folderTagsPreview.length === 0 && folderTags.length > 0) {
                    folderTagsPreview.push(...folderTags);
                }
            }

            // Folder group container
            const groupEl = this.listEl.createDiv({ cls: 'bbab-tf-tree-group' });

            // Folder header (clickable to expand/collapse)
            const headerEl = groupEl.createDiv({ cls: 'bbab-tf-tree-header' + (isEmpty ? ' bbab-tf-tree-header-empty' : '') });

            // Expand/collapse toggle (only for folders with files)
            if (!isEmpty) {
                const toggleBtn = headerEl.createEl('button', {
                    cls: 'bbab-tf-tree-toggle',
                    text: isExpanded ? '▼' : '▶',
                });
                toggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.expandedFolders.has(folderPath)) {
                        this.expandedFolders.delete(folderPath);
                    } else {
                        this.expandedFolders.add(folderPath);
                    }
                    this.renderList();
                });
            }

            // Folder name
            const folderName = folderPath || '(vault root)';
            headerEl.createSpan({ text: folderName, cls: 'bbab-tf-tree-folder-name' });

            // File count badge or empty indicator
            if (isEmpty) {
                headerEl.createSpan({
                    text: ' — (empty)',
                    cls: 'bbab-tf-tree-count bbab-tf-tree-empty',
                });
            } else {
                headerEl.createSpan({
                    text: ` — ${folderItems.length} file${folderItems.length > 1 ? 's' : ''}`,
                    cls: 'bbab-tf-tree-count',
                });
            }

            // Tags preview on folder header (only for folders with files)
            if (!isEmpty && folderTagsPreview.length > 0 && !isExpanded) {
                const tagsPreview = headerEl.createSpan({ cls: 'bbab-tf-tree-tags-preview' });
                tagsPreview.createSpan({ text: '→ ' });
                tagsPreview.createSpan({
                    text: folderTagsPreview.map(t => '#' + t).join(' '),
                    cls: 'bbab-tf-tag-add',
                });
            }

            // Files container (only rendered if expanded and has files)
            if (isExpanded && !isEmpty) {
                const filesEl = groupEl.createDiv({ cls: 'bbab-tf-tree-files' });

                for (const item of folderItems) {
                    const isSelected = this.selectedFiles.has(item.file.path);
                    const folderTags = this.computeFolderTags(item);
                    const additionalTags = this.getAdditionalTagsForFile(item);
                    const allNewTags = [...new Set([...folderTags, ...additionalTags])];
                    const tagsToAdd = allNewTags.filter(t => !item.currentTags.includes(t));

                    const itemEl = filesEl.createDiv({ cls: 'bbab-tf-tree-file' });

                    // Checkbox
                    const checkbox = itemEl.createEl('input', { type: 'checkbox' });
                    checkbox.checked = isSelected;
                    checkbox.addEventListener('change', () => {
                        if (checkbox.checked) {
                            this.selectedFiles.add(item.file.path);
                        } else {
                            this.selectedFiles.delete(item.file.path);
                        }
                        this.renderList();
                    });

                    // File name (not full path)
                    itemEl.createSpan({ text: item.file.name, cls: 'bbab-tf-tree-filename' });

                    // Tags display
                    const tagsEl = itemEl.createDiv({ cls: 'bbab-tf-tree-file-tags' });

                    // Get tags marked for deletion for this file
                    const deletionsForFile = this.tagsToDelete.get(item.file.path) || new Set<string>();

                    if (item.currentTags.length > 0) {
                        tagsEl.createSpan({ text: 'Has: ', cls: 'bbab-tf-tag-label' });

                        if (this.isEditMode) {
                            // Edit mode: show tags as chips
                            const chipsContainer = tagsEl.createSpan({ cls: 'bbab-tf-tag-chips' });
                            for (const tag of item.currentTags) {
                                const isAutoTag = item.autoTags.includes(tag);
                                const isMarkedForDeletion = deletionsForFile.has(tag);
                                const canEdit = isAutoTag || this.allowManualTagEditing;

                                const chipEl = chipsContainer.createSpan({
                                    cls: `bbab-tf-tag-chip ${isAutoTag ? 'bbab-tf-tag-chip-auto' : 'bbab-tf-tag-chip-manual'} ${isMarkedForDeletion ? 'bbab-tf-tag-chip-delete' : ''} ${!canEdit ? 'bbab-tf-tag-chip-locked' : ''}`,
                                });
                                chipEl.createSpan({ text: '#' + tag });

                                if (canEdit) {
                                    const deleteBtn = chipEl.createSpan({
                                        text: '×',
                                        cls: 'bbab-tf-tag-delete-btn',
                                    });
                                    deleteBtn.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        this.toggleTagDeletion(item.file.path, tag);
                                    });
                                }
                            }
                        } else {
                            // Normal mode: show tags as text, with strikethrough for deletions
                            const tagsWithStatus = item.currentTags.map(t => {
                                if (deletionsForFile.has(t)) {
                                    return `<s>#${t}</s>`;
                                }
                                return '#' + t;
                            });
                            const tagSpan = tagsEl.createSpan({ cls: 'bbab-tf-tag-current' });
                            tagSpan.innerHTML = tagsWithStatus.join(' ');
                        }
                    }

                    // Show "Removing:" for tags marked for deletion (only in normal mode for clarity)
                    if (!this.isEditMode && deletionsForFile.size > 0) {
                        tagsEl.createSpan({ text: ' ' });
                        tagsEl.createSpan({ text: 'Removing: ', cls: 'bbab-tf-tag-label bbab-tf-tag-label-remove' });
                        tagsEl.createSpan({
                            text: Array.from(deletionsForFile).map(t => '#' + t).join(' '),
                            cls: 'bbab-tf-tag-remove',
                        });
                    }

                    // Only show "Adding:" if the file is selected (checked)
                    if (isSelected && tagsToAdd.length > 0) {
                        if (item.currentTags.length > 0 || deletionsForFile.size > 0) tagsEl.createSpan({ text: ' ' });
                        tagsEl.createSpan({ text: 'Adding: ', cls: 'bbab-tf-tag-label' });

                        // Show folder tags
                        const newFolderTags = folderTags.filter(t => !item.currentTags.includes(t));
                        if (newFolderTags.length > 0) {
                            tagsEl.createSpan({
                                text: newFolderTags.map(t => '#' + t).join(' '),
                                cls: 'bbab-tf-tag-add',
                            });
                        }

                        // Show additional tags
                        const newAdditionalTags = additionalTags.filter(t => !item.currentTags.includes(t) && !folderTags.includes(t));
                        if (newAdditionalTags.length > 0) {
                            if (newFolderTags.length > 0) tagsEl.createSpan({ text: ' ' });
                            tagsEl.createSpan({
                                text: newAdditionalTags.map(t => '#' + t).join(' '),
                                cls: 'bbab-tf-tag-additional',
                            });
                        }
                    } else if (!isSelected && tagsToAdd.length > 0) {
                        // Show indicator that file is excluded
                        if (item.currentTags.length > 0) tagsEl.createSpan({ text: ' ' });
                        tagsEl.createSpan({ text: '(excluded)', cls: 'bbab-tf-no-changes' });
                    } else if (item.currentTags.length === 0 && tagsToAdd.length === 0 && deletionsForFile.size === 0) {
                        tagsEl.createSpan({ text: '(no changes)', cls: 'bbab-tf-no-changes' });
                    }
                }
            }
        }

        // Update stats
        if (this.statsEl) {
            this.statsEl.textContent = `Files (${this.items.length} total, ${this.selectedFiles.size} selected, ${filesWithChanges} with changes)`;
        }

        // Update apply button
        if (this.applyBtn) {
            const results = this.computeFinalResults();
            this.applyBtn.textContent = `Apply to ${results.length} files`;
            this.applyBtn.disabled = results.length === 0;
        }

        // Restore scroll position
        this.listEl.scrollTop = scrollTop;
    }

    renderEditButtons() {
        if (!this.editButtonsContainer) return;
        this.editButtonsContainer.empty();

        if (!this.isEditMode) {
            // Normal mode: show "Edit Existing Tags" button
            const editBtn = this.editButtonsContainer.createEl('button', {
                text: 'Edit Existing Tags',
                cls: 'bbab-tf-edit-tags-btn',
            });
            editBtn.addEventListener('click', () => {
                this.isEditMode = true;
                this.renderEditButtons();
                this.renderList();
                this.updateRightColumnState();
            });
        } else {
            // Edit mode: show "Stop Editing" and "Edit Manual Tags" buttons
            const stopBtn = this.editButtonsContainer.createEl('button', {
                text: 'Stop Editing',
                cls: 'bbab-tf-stop-editing-btn',
            });
            stopBtn.addEventListener('click', () => {
                this.isEditMode = false;
                this.allowManualTagEditing = false;
                this.renderEditButtons();
                this.renderList();
                this.updateRightColumnState();
            });

            if (!this.allowManualTagEditing) {
                const manualBtn = this.editButtonsContainer.createEl('button', {
                    text: 'Edit Manual Tags',
                    cls: 'bbab-tf-edit-manual-btn',
                });
                manualBtn.addEventListener('click', () => {
                    this.allowManualTagEditing = true;
                    this.renderEditButtons();
                    this.renderList();
                });

                // Warning text
                this.editButtonsContainer.createEl('p', {
                    text: 'Warning: Manual tag changes cannot be reverted by TagForge.',
                    cls: 'bbab-tf-manual-warning',
                });
            } else {
                // Show indicator that manual editing is enabled
                this.editButtonsContainer.createEl('p', {
                    text: 'Manual tag editing enabled. Changes cannot be reverted.',
                    cls: 'bbab-tf-manual-warning bbab-tf-manual-active',
                });
            }
        }
    }

    updateRightColumnState() {
        if (!this.rightColumn) return;
        if (this.isEditMode) {
            this.rightColumn.addClass('bbab-tf-controls-disabled');
        } else {
            this.rightColumn.removeClass('bbab-tf-controls-disabled');
        }
    }

    toggleTagDeletion(filePath: string, tag: string) {
        if (!this.tagsToDelete.has(filePath)) {
            this.tagsToDelete.set(filePath, new Set());
        }
        const fileTags = this.tagsToDelete.get(filePath)!;
        if (fileTags.has(tag)) {
            fileTags.delete(tag);
            if (fileTags.size === 0) {
                this.tagsToDelete.delete(filePath);
            }
        } else {
            fileTags.add(tag);
        }
        this.renderList();
    }

    isTagMarkedForDeletion(filePath: string, tag: string): boolean {
        return this.tagsToDelete.get(filePath)?.has(tag) || false;
    }

    getParentFolder(filePath: string): string {
        const parts = filePath.split(/[/\\]/);
        parts.pop(); // Remove filename
        return parts.join('/');
    }

    computeFolderTags(item: EnhancedPreviewItem): string[] {
        if (this.skipAllFolderTags) return [];
        const tags: string[] = [];
        for (let level = 1; level <= item.folderTagsByLevel.length; level++) {
            if (this.enabledLevels.has(level)) {
                tags.push(...item.folderTagsByLevel[level - 1]);
            }
        }
        return tags;
    }

    getAdditionalTagsForFile(item: EnhancedPreviewItem): string[] {
        if (this.additionalTags.length === 0) return [];
        if (this.additionalTagsToSelectedOnly && !this.selectedFiles.has(item.file.path)) {
            return [];
        }
        return this.additionalTags;
    }

    computeFinalResults(): Array<{ file: TFile; tagsToAdd: string[]; tagsToRemove: string[] }> {
        const results: Array<{ file: TFile; tagsToAdd: string[]; tagsToRemove: string[] }> = [];

        for (const item of this.items) {
            const folderTags = this.computeFolderTags(item);
            const additionalTags = this.getAdditionalTagsForFile(item);
            const allNewTags = [...new Set([...folderTags, ...additionalTags])];

            // Only add tags if file is selected
            const tagsToAdd = this.selectedFiles.has(item.file.path)
                ? allNewTags.filter(t => !item.currentTags.includes(t))
                : [];

            // Get tags marked for removal (applies regardless of selection)
            const tagsToRemove = Array.from(this.tagsToDelete.get(item.file.path) || []);

            if (tagsToAdd.length > 0 || tagsToRemove.length > 0) {
                results.push({ file: item.file, tagsToAdd, tagsToRemove });
            }
        }

        return results;
    }

    /**
     * Phase 10: Save the current configuration as a folder rule
     */
    async saveRule(): Promise<void> {
        if (!this.targetFolder) return;

        // Get enabled folder tag levels (for dynamic tag computation)
        const folderTagLevels: number[] = [];
        if (!this.skipAllFolderTags) {
            for (const level of this.enabledLevels) {
                folderTagLevels.push(level);
            }
        }
        folderTagLevels.sort((a, b) => a - b);

        // Get static/additional tags (if they apply to all files)
        const staticTags: string[] = [];
        if (!this.additionalTagsToSelectedOnly && this.additionalTags.length > 0) {
            staticTags.push(...this.additionalTags);
        }

        if (folderTagLevels.length === 0 && staticTags.length === 0) {
            new Notice('No tags to save as rule');
            return;
        }

        // Determine applyDownLevels based on user selection
        const applyDownLevels: 'all' | number[] = this.ruleApplyTo === 'subfolders' ? 'all' : [0];

        // Create the rule
        const rule: FolderRule = {
            tags: staticTags,
            folderTagLevels: folderTagLevels,
            applyDownLevels: applyDownLevels,
            inheritFromAncestors: false,  // Default to false, can be changed in Rules Management later
            applyToNewFiles: true,
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString(),
        };

        // Save to plugin data
        this.plugin.folderRules[this.targetFolder] = rule;
        await this.plugin.saveSettings();

        new Notice(`Folder rule saved for ${this.targetFolder}`);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
