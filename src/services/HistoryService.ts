// src/services/HistoryService.ts
// Undo/redo tracking — records tag operations and supports undoing them.

import { TFile, Notice } from 'obsidian';
import type TagForgePlugin from '../../main';
import { TagOperation, OperationFileState, MAX_HISTORY_SIZE } from '../types';

export class HistoryService {
    constructor(private plugin: TagForgePlugin) { }

    /**
     * Generate a unique operation ID.
     */
    generateOperationId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * Record a tag operation for undo capability.
     * Maintains a capped history of MAX_HISTORY_SIZE operations.
     */
    async recordOperation(
        type: TagOperation['type'],
        description: string,
        files: OperationFileState[]
    ) {
        const operation: TagOperation = {
            id: this.generateOperationId(),
            type,
            description,
            timestamp: new Date().toISOString(),
            files,
        };

        // Add to beginning of history
        this.plugin.operationHistory.unshift(operation);

        // Trim to max size
        if (this.plugin.operationHistory.length > MAX_HISTORY_SIZE) {
            this.plugin.operationHistory = this.plugin.operationHistory.slice(0, MAX_HISTORY_SIZE);
        }

        await this.plugin.saveSettings();
    }

    /**
     * Undo a previously recorded operation by restoring file tags
     * to their pre-operation state.
     */
    async undoOperation(operation: TagOperation) {
        let undone = 0;
        let errors = 0;

        for (const fileState of operation.files) {
            const file = this.plugin.app.vault.getAbstractFileByPath(fileState.path);
            if (!file || !(file instanceof TFile)) {
                errors++;
                continue;
            }

            try {
                await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                    // Restore to the state before the operation
                    if (fileState.tagsBefore.length > 0) {
                        frontmatter.tags = [...fileState.tagsBefore];
                    } else {
                        delete frontmatter.tags;
                    }
                });

                // Restore tracking if we have it saved from the operation
                if (fileState.trackingBefore && fileState.trackingBefore.length > 0) {
                    // Restore the tracking that was saved before the revert
                    this.plugin.tagTracking[fileState.path] = {
                        autoTags: [...fileState.trackingBefore],
                        lastUpdated: new Date().toISOString()
                    };
                } else {
                    // Legacy behavior: Update tracking if we're reverting to having no auto-tags
                    const trackedAutoTags = this.plugin.tagTracking[fileState.path]?.autoTags || [];
                    const restoredHasAutoTags = trackedAutoTags.some(t => fileState.tagsBefore.includes(t));
                    if (!restoredHasAutoTags) {
                        delete this.plugin.tagTracking[fileState.path];
                    }
                }

                undone++;
            } catch (e) {
                console.error(`TagForge: Failed to undo for ${fileState.path}`, e);
                errors++;
            }
        }

        // Remove the operation from history
        this.plugin.operationHistory = this.plugin.operationHistory.filter(op => op.id !== operation.id);
        await this.plugin.saveSettings();

        new Notice(`Undone "${operation.description}": ${undone} files restored. ${errors > 0 ? `${errors} errors.` : ''}`);
    }
}
