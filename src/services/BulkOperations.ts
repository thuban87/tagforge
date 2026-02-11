// src/services/BulkOperations.ts
// Bulk apply orchestration — handles vault-wide and folder-specific tag operations.

import { TFile, TFolder, Notice } from 'obsidian';
import type TagForgePlugin from '../../main';
import { EnhancedPreviewItem, OperationFileState } from '../types';
import { BulkPreviewModal } from '../modals/BulkPreviewModal';
import { FolderPickerModal } from '../modals/FolderPickerModal';

export class BulkOperations {
    constructor(private plugin: TagForgePlugin) { }

    /**
     * Launch bulk apply for the entire vault.
     * Shows a preview modal with all non-ignored markdown files.
     */
    async bulkApplyTags() {
        const files = this.plugin.app.vault.getMarkdownFiles();
        const items = this.generateEnhancedPreview(files);

        if (items.length === 0) {
            new Notice('No files found (all files may be in ignored paths)');
            return;
        }

        new BulkPreviewModal(this.plugin.app, this.plugin, items, 'entire vault', null, this.plugin.settings.inheritDepth, async (results) => {
            await this.executeBulkApply(results);
        }).open();
    }

    /**
     * Launch bulk apply for a specific folder.
     * Shows a folder picker, then a preview modal.
     */
    async bulkApplyToFolder() {
        // Get all folders in vault
        const folders: string[] = [];
        this.plugin.app.vault.getAllLoadedFiles().forEach(file => {
            if (file instanceof TFolder && file.path !== '/') {
                folders.push(file.path);
            }
        });

        if (folders.length === 0) {
            new Notice('No folders found in vault');
            return;
        }

        // Sort folders alphabetically
        folders.sort();

        new FolderPickerModal(this.plugin.app, folders, async (selectedFolder, includeSubdirs) => {
            // Check if folder is in ignored paths
            const isIgnored = this.plugin.settings.ignorePaths.some(ignorePath =>
                selectedFolder === ignorePath ||
                selectedFolder.startsWith(ignorePath + '/') ||
                selectedFolder.startsWith(ignorePath + '\\')
            );

            if (isIgnored) {
                new Notice(`"${selectedFolder}" is in your ignored paths list. Remove it from settings to tag files here.`);
                return;
            }

            let files: TFile[];

            if (includeSubdirs) {
                // Include all files in folder and subdirectories
                files = this.plugin.app.vault.getMarkdownFiles().filter(f =>
                    f.path.startsWith(selectedFolder + '/')
                );
            } else {
                // Only files directly in this folder (not subdirectories)
                files = this.plugin.app.vault.getMarkdownFiles().filter(f => {
                    if (!f.path.startsWith(selectedFolder + '/')) return false;
                    // Check if there are additional path separators after the folder
                    const relativePath = f.path.slice(selectedFolder.length + 1);
                    return !relativePath.includes('/') && !relativePath.includes('\\');
                });
            }

            if (files.length === 0) {
                new Notice(`No markdown files in ${selectedFolder}${includeSubdirs ? ' (including subdirectories)' : ''}`);
                return;
            }

            const items = this.generateEnhancedPreview(files);

            if (items.length === 0) {
                new Notice('No files found in this folder');
                return;
            }

            const description = includeSubdirs ? `${selectedFolder} (+ subdirs)` : selectedFolder;
            new BulkPreviewModal(this.plugin.app, this.plugin, items, description, selectedFolder, this.plugin.settings.inheritDepth, async (results) => {
                await this.executeBulkApply(results);
            }).open();
        }).open();
    }

    /**
     * Generate enhanced preview items for a set of files.
     * Each item includes current tags, auto-tags, and folder-based tag breakdown.
     */
    generateEnhancedPreview(files: TFile[]): EnhancedPreviewItem[] {
        const items: EnhancedPreviewItem[] = [];

        for (const file of files) {
            // Check if in ignored path
            let ignored = false;
            for (const ignorePath of this.plugin.settings.ignorePaths) {
                if (file.path.startsWith(ignorePath + '/') || file.path.startsWith(ignorePath + '\\')) {
                    ignored = true;
                    break;
                }
            }
            if (ignored) continue;

            // Get current tags from cache
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            const currentTags: string[] = [];
            if (cache?.frontmatter?.tags) {
                if (Array.isArray(cache.frontmatter.tags)) {
                    currentTags.push(...cache.frontmatter.tags);
                } else if (typeof cache.frontmatter.tags === 'string') {
                    currentTags.push(cache.frontmatter.tags);
                }
            }

            // Get auto-tags (tags tracked by TagForge)
            const tracking = this.plugin.tagTracking[file.path];
            const autoTags = tracking?.autoTags || [];

            // Get folder tags by level
            const folderTagsByLevel = this.getFolderTagsByLevel(file.path);

            items.push({
                file,
                currentTags,
                autoTags,
                folderTagsByLevel,
            });
        }

        return items;
    }

    /**
     * Get folder-derived tags broken down by hierarchy level.
     * Used by the bulk preview modal for per-level tag display.
     */
    getFolderTagsByLevel(filePath: string): string[][] {
        const tagsByLevel: string[][] = [];
        const pathParts = filePath.split(/[/\\]/);
        pathParts.pop(); // Remove filename

        for (let i = 0; i < pathParts.length; i++) {
            const folderName = pathParts[i];
            if (folderName) {
                const folderPath = pathParts.slice(0, i + 1).join('/');
                const aliasValue = this.plugin.settings.folderAliases[folderPath];

                if (aliasValue) {
                    // Handle both old format (string) and new format (string[])
                    if (Array.isArray(aliasValue)) {
                        tagsByLevel.push(aliasValue);
                    } else {
                        // Legacy: single string value
                        tagsByLevel.push([String(aliasValue)]);
                    }
                } else {
                    const tag = this.plugin.tagResolver.folderNameToTag(folderName);
                    // Only push valid tags (at least 2 chars and contains alphanumeric)
                    if (tag.length > 1 && /[a-z0-9]/.test(tag)) {
                        tagsByLevel.push([tag]);
                    }
                }
            }
        }

        return tagsByLevel;
    }

    /**
     * Execute the bulk apply operation — adds and removes tags as specified.
     * Records the operation for undo capability.
     */
    async executeBulkApply(results: Array<{ file: TFile; tagsToAdd: string[]; tagsToRemove: string[] }>) {
        let filesModified = 0;
        let tagsAdded = 0;
        let tagsRemoved = 0;
        let errors = 0;
        const operationFiles: OperationFileState[] = [];

        for (let i = 0; i < results.length; i++) {
            const item = results[i];
            try {
                // Capture state before
                const tagsBefore = await this.plugin.tagIO.getFileTags(item.file);

                // Remove tags first (if any)
                if (item.tagsToRemove.length > 0) {
                    await this.plugin.tagIO.removeTagsFromFile(item.file, item.tagsToRemove);
                    tagsRemoved += item.tagsToRemove.length;
                }

                // Add tags (if any)
                if (item.tagsToAdd.length > 0) {
                    await this.plugin.tagIO.applyTagsToFile(item.file.path, item.tagsToAdd);
                    tagsAdded += item.tagsToAdd.length;
                }

                // Capture state after
                const tagsAfter = await this.plugin.tagIO.getFileTags(item.file);

                operationFiles.push({
                    path: item.file.path,
                    tagsBefore,
                    tagsAfter,
                });

                filesModified++;
            } catch (e) {
                console.error(`TagForge: Failed to modify ${item.file.path}`, e);
                errors++;
            }

            // Every 50 files, yield to UI and show progress
            if (i > 0 && i % 50 === 0) {
                new Notice(`Processing: ${i}/${results.length}...`);
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        // Record the bulk operation
        if (operationFiles.length > 0) {
            const description = tagsRemoved > 0
                ? `Bulk modified ${filesModified} files (${tagsAdded} added, ${tagsRemoved} removed)`
                : `Bulk applied tags to ${filesModified} files`;
            await this.plugin.historyService.recordOperation('bulk', description, operationFiles);
        }

        // Build notice message
        const parts: string[] = [];
        if (tagsAdded > 0) parts.push(`${tagsAdded} tags added`);
        if (tagsRemoved > 0) parts.push(`${tagsRemoved} tags removed`);
        if (errors > 0) parts.push(`${errors} errors`);
        new Notice(`Modified ${filesModified} files. ${parts.join(', ')}`);
    }
}
