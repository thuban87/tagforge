// src/services/MoveHandler.ts
// File move orchestration — handles file renames that change parent folder,
// including batch move processing and move cancellation with folder cleanup.

import { TFile, TFolder, Notice } from 'obsidian';
import type TagForgePlugin from '../../main';
import { PendingMoveOperation, MoveConfirmationResult, GroupedMoveResult, WINDOWS_SYSTEM_FILES, OperationFileState } from '../types';
import { MoveConfirmationModal } from '../modals/MoveConfirmationModal';
import { GroupedMoveConfirmationModal } from '../modals/GroupedMoveConfirmationModal';

// Node.js modules (loaded at runtime in Electron)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodePath = require('path') as typeof import('path');

export class MoveHandler {
    // Pending state fields (moved from plugin)
    pendingUndoPath: string | null = null;
    pendingUndoPaths: Set<string> = new Set();
    pendingMoves: Map<string, PendingMoveOperation> = new Map();
    pendingMoveTimeout: number | null = null;

    constructor(private plugin: TagForgePlugin) { }

    /**
     * Clean up pending state. Called from plugin's onunload().
     */
    cleanup() {
        if (this.pendingMoveTimeout) {
            window.clearTimeout(this.pendingMoveTimeout);
            this.pendingMoveTimeout = null;
        }
        this.pendingMoves.clear();
        this.pendingUndoPath = null;
        this.pendingUndoPaths.clear();
    }

    /**
     * Handle a file rename event that may be a move (folder change).
     * Debounces multiple moves within 300ms into a single batch modal.
     */
    async handleFileRename(file: TFile, oldPath: string) {
        // Only process markdown files
        if (file.extension !== 'md') {
            return;
        }

        // Check if this is an undo move (Cancel was clicked) - skip to prevent loop
        if (this.pendingUndoPath && file.path === this.pendingUndoPath) {
            this.pendingUndoPath = null;
            return;
        }

        // Check if this is a batch undo move
        if (this.pendingUndoPaths.has(file.path)) {
            this.pendingUndoPaths.delete(file.path);
            return;
        }

        // Check if this is a move (folder changed) vs just a rename
        const oldFolder = this.plugin.getParentFolder(oldPath);
        const newFolder = this.plugin.getParentFolder(file.path);

        if (oldFolder === newFolder) {
            // Just a rename, not a move - update tracking and history
            let needsSave = false;
            const oldFileName = oldPath.split('/').pop() || oldPath;
            const newFileName = file.name;

            // Update tagTracking key
            if (this.plugin.tagTracking[oldPath]) {
                this.plugin.tagTracking[file.path] = this.plugin.tagTracking[oldPath];
                delete this.plugin.tagTracking[oldPath];
                needsSave = true;
            }

            // Update operationHistory entries (both paths and descriptions)
            for (const op of this.plugin.operationHistory) {
                for (const fileState of op.files) {
                    if (fileState.path === oldPath) {
                        fileState.path = file.path;
                        needsSave = true;
                    }
                }
                // Update description if it mentions the old filename
                if (op.description.includes(oldFileName)) {
                    op.description = op.description.replace(oldFileName, newFileName);
                    needsSave = true;
                }
            }

            if (needsSave) {
                await this.plugin.saveSettings();
            }
            return;
        }

        // Check if new path is in ignored folders
        for (const ignorePath of this.plugin.settings.ignorePaths) {
            if (file.path.startsWith(ignorePath + '/') || file.path.startsWith(ignorePath + '\\')) {
                return;
            }
        }

        // Decide what to do based on settings
        if (!this.plugin.settings.showMoveConfirmation) {
            // Setting is off - silently retag
            await this.applyMoveRetag(file, oldPath);
            return;
        }

        if (this.plugin.settings.rememberedMoveAction) {
            // User has a remembered choice
            if (this.plugin.settings.rememberedMoveAction === 'continue') {
                await this.applyMoveRetag(file, oldPath);
            } else if (this.plugin.settings.rememberedMoveAction === 'leave') {
                // Just update tracking key, don't change tags
                if (this.plugin.tagTracking[oldPath]) {
                    this.plugin.tagTracking[file.path] = this.plugin.tagTracking[oldPath];
                    delete this.plugin.tagTracking[oldPath];
                    await this.plugin.saveSettings();
                }
            }
            return;
        }

        // Queue this move for batch processing
        this.pendingMoves.set(file.path, {
            file,
            oldPath,
            oldFolder,
            newFolder,
        });

        // Clear existing timeout and set a new one (debounce 300ms)
        if (this.pendingMoveTimeout) {
            window.clearTimeout(this.pendingMoveTimeout);
        }

        this.pendingMoveTimeout = window.setTimeout(() => {
            this.pendingMoveTimeout = null;
            this.showBatchedMoveModal();
        }, 300);
    }

    /**
     * Show the appropriate move modal based on batch size.
     */
    showBatchedMoveModal() {
        const moves = Array.from(this.pendingMoves.values());
        this.pendingMoves.clear();

        if (moves.length === 0) {
            return;
        }

        if (moves.length === 1) {
            // Just one file - use the simpler single-file modal
            const move = moves[0];
            new MoveConfirmationModal(
                this.plugin.app,
                this.plugin,  // Pass plugin for rule checking
                move.file,
                move.oldPath,
                move.oldFolder,
                move.newFolder,
                async (result) => {
                    await this.handleMoveResult(move.file, move.oldPath, result);
                }
            ).open();
        } else {
            // Multiple files - use grouped modal
            new GroupedMoveConfirmationModal(
                this.plugin.app,
                this.plugin,  // Pass plugin for rule checking
                moves,
                async (result) => {
                    await this.handleGroupedMoveResult(moves, result);
                }
            ).open();
        }
    }

    /**
     * Handle the result of a grouped move confirmation modal.
     */
    async handleGroupedMoveResult(moves: PendingMoveOperation[], result: GroupedMoveResult) {
        // Save remembered choice if applicable
        if (result.remember && (result.action === 'continue' || result.action === 'leave')) {
            this.plugin.settings.rememberedMoveAction = result.action;
            await this.plugin.saveSettings();
            new Notice(`TagForge: Will remember "${result.action === 'continue' ? 'Continue' : 'Leave Tags'}" for future moves`);
        }

        // Filter out excluded files
        const filesToProcess = moves.filter(m => !result.excludedPaths.has(m.file.path));
        const excludedFiles = moves.filter(m => result.excludedPaths.has(m.file.path));

        // Handle excluded files - just update tracking keys (leave tags alone)
        for (const move of excludedFiles) {
            if (this.plugin.tagTracking[move.oldPath]) {
                this.plugin.tagTracking[move.file.path] = this.plugin.tagTracking[move.oldPath];
                delete this.plugin.tagTracking[move.oldPath];
            }
        }

        if (filesToProcess.length === 0) {
            await this.plugin.saveSettings();
            new Notice('All files excluded - tags left unchanged');
            return;
        }

        switch (result.action) {
            case 'continue':
                let retagged = 0;
                for (const move of filesToProcess) {
                    await this.applyMoveRetag(move.file, move.oldPath);
                    retagged++;
                }
                new Notice(`Retagged ${retagged} files`);
                break;

            case 'leave':
                for (const move of filesToProcess) {
                    if (this.plugin.tagTracking[move.oldPath]) {
                        this.plugin.tagTracking[move.file.path] = this.plugin.tagTracking[move.oldPath];
                        delete this.plugin.tagTracking[move.oldPath];
                    }
                }
                await this.plugin.saveSettings();
                new Notice(`Left tags unchanged for ${filesToProcess.length} files`);
                break;

            case 'cancel':
                // Move all files back to original locations
                let restored = 0;
                let failed = 0;

                // First, ensure all original folders exist
                const foldersToCreate = new Set<string>();
                for (const move of filesToProcess) {
                    if (move.oldFolder) {
                        foldersToCreate.add(move.oldFolder);
                    }
                }

                // Create missing folders
                for (const folderPath of foldersToCreate) {
                    const existingFolder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
                    if (!existingFolder) {
                        try {
                            await this.plugin.app.vault.createFolder(folderPath);
                        } catch (e) {
                            // Folder might already exist or parent needs creating
                            // Try creating parent folders one by one
                            const parts = folderPath.split('/');
                            let currentPath = '';
                            for (const part of parts) {
                                currentPath = currentPath ? `${currentPath}/${part}` : part;
                                const exists = this.plugin.app.vault.getAbstractFileByPath(currentPath);
                                if (!exists) {
                                    try {
                                        await this.plugin.app.vault.createFolder(currentPath);
                                    } catch (innerE) {
                                        // Ignore - might already exist
                                    }
                                }
                            }
                        }
                    }
                }

                // Pre-register all paths to prevent feedback loop
                for (const move of filesToProcess) {
                    this.pendingUndoPaths.add(move.oldPath);
                }

                // Collect destination folders to clean up later (including all subfolders)
                const destFoldersToCleanup = new Set<string>();
                for (const move of filesToProcess) {
                    if (move.newFolder) {
                        // Add this folder and all parent folders up to the moved folder root
                        destFoldersToCleanup.add(move.newFolder);

                        // Also recursively find any subfolders that might exist
                        const folder = this.plugin.app.vault.getAbstractFileByPath(move.newFolder);
                        if (folder && folder instanceof TFolder) {
                            const collectSubfolders = (f: TFolder) => {
                                for (const child of f.children) {
                                    if (child instanceof TFolder) {
                                        destFoldersToCleanup.add(child.path);
                                        collectSubfolders(child);
                                    }
                                }
                            };
                            collectSubfolders(folder);
                        }
                    }
                }

                // Now move files back
                for (const move of filesToProcess) {
                    try {
                        await this.plugin.app.vault.rename(move.file, move.oldPath);
                        restored++;
                    } catch (e) {
                        console.error('TagForge: Failed to restore file', e);
                        this.pendingUndoPaths.delete(move.oldPath); // Remove from tracking if failed
                        failed++;
                    }
                }

                // Clean up empty destination folders after a delay (let filesystem sync, especially for cloud drives)
                setTimeout(async () => {
                    // Get vault base path for filesystem operations
                    const vaultBasePath = (this.plugin.app.vault.adapter as any).basePath as string;

                    // Helper to clean Windows system files from a folder
                    const cleanSystemFiles = (folderPath: string): void => {
                        try {
                            const fullPath = nodePath.join(vaultBasePath, folderPath);
                            if (!fs.existsSync(fullPath)) return;

                            const entries = fs.readdirSync(fullPath);
                            for (const entry of entries) {
                                if (WINDOWS_SYSTEM_FILES.has(entry.toLowerCase())) {
                                    try {
                                        fs.unlinkSync(nodePath.join(fullPath, entry));
                                    } catch (e) {
                                        // File might be locked - that's ok, we'll retry
                                    }
                                }
                            }
                        } catch (e) {
                            // Ignore errors
                        }
                    };

                    // Helper to delete a folder with retries for ENOTEMPTY race conditions
                    const tryDeleteFolder = async (folderPath: string, retries = 3): Promise<boolean> => {
                        const fullPath = nodePath.join(vaultBasePath, folderPath);

                        for (let attempt = 0; attempt < retries; attempt++) {
                            try {
                                if (!fs.existsSync(fullPath)) return false;

                                // Clean any Windows system files first
                                cleanSystemFiles(folderPath);

                                // Check filesystem directly (not Obsidian's stale cache)
                                const remaining = fs.readdirSync(fullPath);
                                if (remaining.length === 0) {
                                    // Delete via filesystem directly
                                    fs.rmdirSync(fullPath);
                                    return true;
                                }
                                return false; // Not empty
                            } catch (e: unknown) {
                                // Retry on ENOTEMPTY (filesystem sync delay)
                                if (e instanceof Error && e.message.includes('ENOTEMPTY') && attempt < retries - 1) {
                                    cleanSystemFiles(folderPath);
                                    await new Promise(r => setTimeout(r, 300));
                                    continue;
                                }
                                return false;
                            }
                        }
                        return false;
                    };

                    // Recursively delete empty folders - keep trying until no more can be deleted
                    let totalDeleted = 0;
                    let deletedThisRound = 0;
                    let maxRounds = 10;

                    do {
                        deletedThisRound = 0;
                        // Sort by path length (deepest first) to delete children before parents
                        const sortedFolders = Array.from(destFoldersToCleanup).sort((a, b) => b.length - a.length);

                        for (const folderPath of sortedFolders) {
                            if (await tryDeleteFolder(folderPath)) {
                                destFoldersToCleanup.delete(folderPath);
                                deletedThisRound++;
                                totalDeleted++;
                            }
                        }
                        maxRounds--;
                    } while (deletedThisRound > 0 && maxRounds > 0);

                    if (totalDeleted > 0) {
                        new Notice(`Cleaned up ${totalDeleted} empty folder${totalDeleted > 1 ? 's' : ''}`);
                    }
                }, 500);

                // Clear any remaining paths after a short delay (in case events are delayed)
                setTimeout(() => {
                    this.pendingUndoPaths.clear();
                }, 1000);

                new Notice(`Restored ${restored} files${failed > 0 ? `, ${failed} failed` : ''}`);
                break;
        }
    }

    /**
     * Handle the result of a single-file move confirmation modal.
     */
    async handleMoveResult(file: TFile, oldPath: string, result: MoveConfirmationResult) {
        // Save remembered choice if applicable
        if (result.remember && (result.action === 'continue' || result.action === 'leave')) {
            this.plugin.settings.rememberedMoveAction = result.action;
            await this.plugin.saveSettings();
            new Notice(`TagForge: Will remember "${result.action === 'continue' ? 'Continue' : 'Leave Tags'}" for future moves`);
        }

        switch (result.action) {
            case 'continue':
                await this.applyMoveRetag(file, oldPath);
                break;

            case 'leave':
                // Just update tracking key, don't change tags
                if (this.plugin.tagTracking[oldPath]) {
                    this.plugin.tagTracking[file.path] = this.plugin.tagTracking[oldPath];
                    delete this.plugin.tagTracking[oldPath];
                    await this.plugin.saveSettings();
                }
                new Notice('Tags left unchanged');
                break;

            case 'cancel':
                // Move file back to original location
                try {
                    // Set flag to prevent this undo from triggering another modal
                    this.pendingUndoPath = oldPath;
                    await this.plugin.app.vault.rename(file, oldPath);
                    new Notice('Move cancelled - file restored to original location');
                } catch (e) {
                    this.pendingUndoPath = null;
                    console.error('TagForge: Failed to restore file', e);
                    new Notice('Failed to restore file to original location');
                }
                break;
        }
    }

    /**
     * Apply retag after a file move: remove old auto-tags, apply new ones
     * based on the file's new location rules.
     */
    async applyMoveRetag(file: TFile, oldPath: string) {
        // Capture state before
        const tagsBefore = await this.plugin.tagIO.getFileTags(file);

        // Step 1: Remove old auto-tags (if any were tracked)
        const oldTracking = this.plugin.tagTracking[oldPath];
        if (oldTracking && oldTracking.autoTags.length > 0) {
            await this.plugin.tagIO.removeAutoTagsFromFile(file, oldTracking.autoTags);
            delete this.plugin.tagTracking[oldPath];
        }

        // Step 2: Apply new tags based on new location's folder rules
        const newTags = this.plugin.tagResolver.getRulesForPath(file.path);
        if (newTags.length > 0) {
            await this.plugin.tagIO.applyTagsToFile(file.path, newTags);
            new Notice(`Retagged with: ${newTags.map(t => '#' + t).join(', ')}`);
        } else {
            await this.plugin.saveSettings();
            new Notice('Auto-tags removed (new location has no folder rules)');
        }

        // Capture state after and record operation
        const tagsAfter = await this.plugin.tagIO.getFileTags(file);
        await this.plugin.historyService.recordOperation('move', `Retagged ${file.name} after move`, [{
            path: file.path,
            tagsBefore,
            tagsAfter,
        }]);
    }
}
