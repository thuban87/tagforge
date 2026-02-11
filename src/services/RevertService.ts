// src/services/RevertService.ts
// Tag revert operations — removes auto-applied tags by various criteria.

import { TFile, TFolder, Notice } from 'obsidian';
import type TagForgePlugin from '../../main';
import { OperationFileState } from '../types';
import { DatePickerModal } from '../modals/DatePickerModal';
import { FolderPickerModal } from '../modals/FolderPickerModal';

export class RevertService {
    constructor(private plugin: TagForgePlugin) { }

    /**
     * Revert all auto-applied tags across the vault.
     * Respects protected tags — they are kept intact.
     */
    async revertAllAutoTags() {
        const trackedFiles = Object.keys(this.plugin.tagTracking);
        if (trackedFiles.length === 0) {
            new Notice('No auto-tags to revert');
            return;
        }

        const confirmed = confirm(
            `This will remove auto-applied tags from ${trackedFiles.length} files. Continue?`
        );
        if (!confirmed) {
            return;
        }

        let reverted = 0;
        let errors = 0;
        const operationFiles: OperationFileState[] = [];

        for (let i = 0; i < trackedFiles.length; i++) {
            const filePath = trackedFiles[i];
            const tracking = this.plugin.tagTracking[filePath];
            if (!tracking || tracking.autoTags.length === 0) {
                continue;
            }

            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (!file || !(file instanceof TFile)) {
                errors++;
                continue;
            }

            try {
                // Capture state before
                const tagsBefore = await this.plugin.tagIO.getFileTags(file);

                // Filter out protected tags - they should NOT be removed
                const protectedLower = this.plugin.settings.protectedTags.map(t => t.toLowerCase());
                const tagsToRemove = tracking.autoTags.filter(t => !protectedLower.includes(t.toLowerCase()));
                const protectedAutoTags = tracking.autoTags.filter(t => protectedLower.includes(t.toLowerCase()));

                if (tagsToRemove.length > 0) {
                    await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                        if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
                            // Remove only non-protected auto-applied tags
                            frontmatter.tags = frontmatter.tags.filter(
                                (tag: string) => !tagsToRemove.includes(tag)
                            );
                            // Remove empty tags array
                            if (frontmatter.tags.length === 0) {
                                delete frontmatter.tags;
                            }
                        }
                    });
                }

                // Capture state after
                const tagsAfter = await this.plugin.tagIO.getFileTags(file);
                operationFiles.push({
                    path: filePath,
                    tagsBefore,
                    tagsAfter,
                    trackingBefore: [...tracking.autoTags]  // Save tracking for undo
                });

                // Keep tracking for protected tags that weren't removed
                if (protectedAutoTags.length > 0) {
                    this.plugin.tagTracking[filePath] = {
                        autoTags: protectedAutoTags,
                        lastUpdated: tracking.lastUpdated
                    };
                }

                reverted++;
            } catch (e) {
                console.error(`TagForge: Failed to revert ${filePath}`, e);
                errors++;
            }

            // Every 50 files, yield to UI and show progress
            if (i > 0 && i % 50 === 0) {
                new Notice(`Removing: ${i}/${trackedFiles.length}...`);
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        // Record the revert operation
        if (operationFiles.length > 0) {
            await this.plugin.historyService.recordOperation('revert', `Removed auto-tags from ${reverted} files`, operationFiles);
        }

        // Clear tracking data for files that had all tags removed
        // (files with protected tags were already handled above)
        for (const filePath of trackedFiles) {
            const tracking = this.plugin.tagTracking[filePath];
            if (tracking) {
                const protectedLower = this.plugin.settings.protectedTags.map(t => t.toLowerCase());
                const hasProtected = tracking.autoTags.some(t => protectedLower.includes(t.toLowerCase()));
                if (!hasProtected) {
                    delete this.plugin.tagTracking[filePath];
                }
            }
        }
        await this.plugin.saveSettings();

        new Notice(`Reverted ${reverted} files. ${errors > 0 ? `${errors} errors.` : ''}`);
    }

    /**
     * Nuclear option: remove ALL tags from ALL files and clear all rules.
     * Desktop only. Double-confirmation required.
     */
    async revertAllTagsNuclear() {
        const files = this.plugin.app.vault.getMarkdownFiles();
        const ruleCount = Object.keys(this.plugin.folderRules).length;

        const confirmed = confirm(
            `⚠️ NUCLEAR OPTION ⚠️\n\nThis will:\n• Remove ALL tags (auto AND manual) from ALL ${files.length} markdown files\n• Delete ALL folder rules (${ruleCount} rules)\n• Clear all tracking data\n\nThis cannot be undone. Continue?`
        );
        if (!confirmed) {
            return;
        }

        // Double confirm for safety
        const doubleConfirm = confirm(
            `Are you REALLY sure? This will clear tags from ${files.length} files and delete ${ruleCount} folder rules.`
        );
        if (!doubleConfirm) {
            return;
        }

        let cleared = 0;
        let errors = 0;
        const operationFiles: OperationFileState[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                // Capture state before
                const tagsBefore = await this.plugin.tagIO.getFileTags(file);

                await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                    if (frontmatter.tags) {
                        delete frontmatter.tags;
                    }
                });

                // Only record if file had tags
                if (tagsBefore.length > 0) {
                    operationFiles.push({
                        path: file.path,
                        tagsBefore,
                        tagsAfter: [],
                    });
                }

                cleared++;
            } catch (e) {
                console.error(`TagForge: Failed to clear tags from ${file.path}`, e);
                errors++;
            }

            // Every 50 files, yield to UI and show progress
            if (i > 0 && i % 50 === 0) {
                new Notice(`Clearing: ${i}/${files.length}...`);
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        // Record the nuclear operation
        if (operationFiles.length > 0) {
            await this.plugin.historyService.recordOperation('revert', `Nuclear: Cleared ALL tags from ${operationFiles.length} files`, operationFiles);
        }

        // Clear tracking data and folder rules
        this.plugin.tagTracking = {};
        this.plugin.folderRules = {};  // Phase 10: Also wipe all folder rules
        await this.plugin.saveSettings();

        new Notice(`Nuclear complete: ${cleared} files cleared, all rules deleted. ${errors > 0 ? `${errors} errors.` : ''}`);
    }

    /**
     * Revert auto-tags filtered by date.
     * Opens a date picker modal with available dates.
     */
    async revertAutoTagsByDate() {
        // Get unique dates from tracking (using UTC for consistency across timezones)
        const dateMap: Record<string, string[]> = {};

        for (const [filePath, tracking] of Object.entries(this.plugin.tagTracking)) {
            if (!tracking.lastUpdated) continue;
            // Extract UTC date from ISO string (YYYY-MM-DD)
            const date = tracking.lastUpdated.split('T')[0];
            if (!dateMap[date]) {
                dateMap[date] = [];
            }
            dateMap[date].push(filePath);
        }

        const dates = Object.keys(dateMap).sort().reverse(); // Most recent first

        if (dates.length === 0) {
            new Notice('No tracked auto-tags to revert');
            return;
        }

        // Show date picker modal
        new DatePickerModal(this.plugin.app, dates, dateMap, async (selectedDates) => {
            await this.revertFilesFromDates(selectedDates, dateMap);
        }).open();
    }

    /**
     * Revert files from the specified dates.
     */
    async revertFilesFromDates(selectedDates: string[], dateMap: Record<string, string[]>) {
        const filesToRevert: string[] = [];
        for (const date of selectedDates) {
            filesToRevert.push(...(dateMap[date] || []));
        }

        if (filesToRevert.length === 0) {
            new Notice('No files to revert for selected dates');
            return;
        }

        let reverted = 0;
        let errors = 0;
        const operationFiles: OperationFileState[] = [];

        for (let i = 0; i < filesToRevert.length; i++) {
            const filePath = filesToRevert[i];
            const tracking = this.plugin.tagTracking[filePath];
            if (!tracking || tracking.autoTags.length === 0) {
                continue;
            }

            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (!file || !(file instanceof TFile)) {
                errors++;
                continue;
            }

            try {
                // Capture state before
                const tagsBefore = await this.plugin.tagIO.getFileTags(file);

                // Filter out protected tags - they should NOT be removed
                const protectedLower = this.plugin.settings.protectedTags.map(t => t.toLowerCase());
                const tagsToRemove = tracking.autoTags.filter(t => !protectedLower.includes(t.toLowerCase()));
                const protectedAutoTags = tracking.autoTags.filter(t => protectedLower.includes(t.toLowerCase()));

                if (tagsToRemove.length > 0) {
                    await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                        if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
                            frontmatter.tags = frontmatter.tags.filter(
                                (tag: string) => !tagsToRemove.includes(tag)
                            );
                            if (frontmatter.tags.length === 0) {
                                delete frontmatter.tags;
                            }
                        }
                    });
                }

                // Capture state after
                const tagsAfter = await this.plugin.tagIO.getFileTags(file);
                operationFiles.push({
                    path: filePath,
                    tagsBefore,
                    tagsAfter,
                    trackingBefore: [...tracking.autoTags]  // Save tracking for undo
                });

                // Update tracking: keep protected tags, remove others
                if (protectedAutoTags.length > 0) {
                    this.plugin.tagTracking[filePath] = {
                        autoTags: protectedAutoTags,
                        lastUpdated: tracking.lastUpdated
                    };
                } else {
                    delete this.plugin.tagTracking[filePath];
                }
                reverted++;
            } catch (e) {
                console.error(`TagForge: Failed to revert ${filePath}`, e);
                errors++;
            }

            // Every 50 files, yield to UI and show progress
            if (i > 0 && i % 50 === 0) {
                new Notice(`Removing: ${i}/${filesToRevert.length}...`);
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        // Record the revert operation
        if (operationFiles.length > 0) {
            await this.plugin.historyService.recordOperation('revert', `Removed auto-tags from ${reverted} files (by date)`, operationFiles);
        }

        await this.plugin.saveSettings();
        new Notice(`Removed auto-tags from ${reverted} files from ${selectedDates.length} date(s). ${errors > 0 ? `${errors} errors.` : ''}`);
    }

    /**
     * Revert auto-tags for a specific folder.
     * Opens a folder picker with folders that have tracked files.
     */
    async revertAutoTagsByFolder() {
        // Get all folders that have tracked files
        const foldersWithTracking = new Set<string>();
        for (const filePath of Object.keys(this.plugin.tagTracking)) {
            const folder = this.plugin.getParentFolder(filePath);
            if (folder) {
                foldersWithTracking.add(folder);
                // Also add parent folders
                const parts = folder.split('/');
                for (let i = 1; i < parts.length; i++) {
                    foldersWithTracking.add(parts.slice(0, i).join('/'));
                }
            }
        }

        if (foldersWithTracking.size === 0) {
            new Notice('No folders with tracked auto-tags');
            return;
        }

        const folders = Array.from(foldersWithTracking).sort();

        new FolderPickerModal(this.plugin.app, folders, async (selectedFolder, includeSubdirs) => {
            // Find tracked files in this folder
            const filesToRevert = Object.keys(this.plugin.tagTracking).filter(filePath => {
                if (includeSubdirs) {
                    return filePath.startsWith(selectedFolder + '/');
                } else {
                    const fileFolder = this.plugin.getParentFolder(filePath);
                    return fileFolder === selectedFolder;
                }
            });

            if (filesToRevert.length === 0) {
                new Notice(`No tracked files in ${selectedFolder}`);
                return;
            }

            const confirmed = confirm(
                `Remove auto-tags from ${filesToRevert.length} file(s) in "${selectedFolder}"${includeSubdirs ? ' (including subdirectories)' : ''}?`
            );
            if (!confirmed) return;

            let reverted = 0;
            let errors = 0;
            const operationFiles: OperationFileState[] = [];

            for (let i = 0; i < filesToRevert.length; i++) {
                const filePath = filesToRevert[i];
                const tracking = this.plugin.tagTracking[filePath];
                if (!tracking || tracking.autoTags.length === 0) continue;

                const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
                if (!file || !(file instanceof TFile)) {
                    errors++;
                    continue;
                }

                try {
                    const tagsBefore = await this.plugin.tagIO.getFileTags(file);

                    // Filter out protected tags - they should NOT be removed
                    const protectedLower = this.plugin.settings.protectedTags.map(t => t.toLowerCase());
                    const tagsToRemove = tracking.autoTags.filter(t => !protectedLower.includes(t.toLowerCase()));
                    const protectedAutoTags = tracking.autoTags.filter(t => protectedLower.includes(t.toLowerCase()));

                    if (tagsToRemove.length > 0) {
                        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                            if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
                                frontmatter.tags = frontmatter.tags.filter(
                                    (tag: string) => !tagsToRemove.includes(tag)
                                );
                                if (frontmatter.tags.length === 0) {
                                    delete frontmatter.tags;
                                }
                            }
                        });
                    }

                    const tagsAfter = await this.plugin.tagIO.getFileTags(file);
                    operationFiles.push({
                        path: filePath,
                        tagsBefore,
                        tagsAfter,
                        trackingBefore: [...tracking.autoTags]  // Save tracking for undo
                    });

                    // Update tracking: keep protected tags, remove others
                    if (protectedAutoTags.length > 0) {
                        this.plugin.tagTracking[filePath] = {
                            autoTags: protectedAutoTags,
                            lastUpdated: tracking.lastUpdated
                        };
                    } else {
                        delete this.plugin.tagTracking[filePath];
                    }
                    reverted++;
                } catch (e) {
                    console.error(`TagForge: Failed to revert ${filePath}`, e);
                    errors++;
                }

                // Every 50 files, yield to UI and show progress
                if (i > 0 && i % 50 === 0) {
                    new Notice(`Removing: ${i}/${filesToRevert.length}...`);
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }

            if (operationFiles.length > 0) {
                await this.plugin.historyService.recordOperation('revert', `Removed auto-tags from ${reverted} files in ${selectedFolder}`, operationFiles);
            }

            await this.plugin.saveSettings();
            new Notice(`Removed auto-tags from ${reverted} files in ${selectedFolder}. ${errors > 0 ? `${errors} errors.` : ''}`);
        }).open();
    }
}
