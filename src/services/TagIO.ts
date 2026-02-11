// src/services/TagIO.ts
// Frontmatter read/write operations — handles applying and removing tags
// from file frontmatter via the Obsidian API.

import { TFile } from 'obsidian';
import type TagForgePlugin from '../../main';

export class TagIO {
    constructor(private plugin: TagForgePlugin) { }

    /**
     * Apply tags to a file: writes to frontmatter and updates tag tracking.
     * Protected tags are NOT filtered during application — they CAN be added.
     * Protection only applies to removal.
     */
    async applyTagsToFile(filePath: string, tags: string[]) {
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (!file || !(file instanceof TFile)) {
            return;
        }

        await this.applyFrontmatterTags(filePath, tags);

        // Track the tags we applied - MERGE with existing tracking, don't replace
        const existingTracking = this.plugin.tagTracking[filePath];
        const existingAutoTags = existingTracking?.autoTags || [];
        const mergedAutoTags = [...new Set([...existingAutoTags, ...tags])];

        this.plugin.tagTracking[filePath] = {
            autoTags: mergedAutoTags,
            lastUpdated: new Date().toISOString(),
        };
        await this.plugin.saveSettings();
    }

    /**
     * Write tags to a file's YAML frontmatter.
     * Only adds tags that don't already exist (case-insensitive).
     */
    async applyFrontmatterTags(filePath: string, tags: string[]) {
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (!file || !(file instanceof TFile)) return;

        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            // Get existing tags
            let existingTags: string[] = [];
            if (frontmatter.tags) {
                if (Array.isArray(frontmatter.tags)) {
                    existingTags = frontmatter.tags;
                } else if (typeof frontmatter.tags === 'string') {
                    existingTags = [frontmatter.tags];
                }
            }

            // Normalize all tags (lowercase, no # prefix)
            const normalizedExisting = existingTags.map(t => t.toLowerCase().replace(/^#/, ''));
            const normalizedNew = tags.map(t => t.toLowerCase().replace(/^#/, ''));

            // Only add tags that don't already exist (case-insensitive)
            const tagsToAdd = normalizedNew.filter(t => !normalizedExisting.includes(t));

            // Keep existing tags as-is, add new normalized tags
            const allTags = [...existingTags, ...tagsToAdd];
            frontmatter.tags = allTags;
        });
    }

    /**
     * Remove auto-applied tags from a file's frontmatter.
     * Respects protected tags — they are never removed.
     */
    async removeAutoTagsFromFile(file: TFile, tagsToRemove: string[]) {
        // Filter out protected tags - never remove those (case-insensitive comparison)
        const protectedLower = this.plugin.settings.protectedTags.map(t => t.toLowerCase());
        const safeToRemove = tagsToRemove.filter(t => !protectedLower.includes(t.toLowerCase()));

        if (safeToRemove.length === 0) {
            return;
        }

        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
                frontmatter.tags = frontmatter.tags.filter(
                    (tag: string) => !safeToRemove.includes(tag)
                );
                if (frontmatter.tags.length === 0) {
                    delete frontmatter.tags;
                }
            }
        });
    }

    /**
     * Remove specific tags from a file and update tag tracking.
     * Respects protected tags — they are never removed.
     */
    async removeTagsFromFile(file: TFile, tagsToRemove: string[]) {
        // Filter out protected tags - never remove those (case-insensitive comparison)
        const protectedLower = this.plugin.settings.protectedTags.map(t => t.toLowerCase());
        const safeToRemove = tagsToRemove.filter(t => !protectedLower.includes(t.toLowerCase()));

        if (safeToRemove.length === 0) {
            return;
        }

        // Remove from frontmatter
        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
                frontmatter.tags = frontmatter.tags.filter(
                    (tag: string) => !safeToRemove.includes(tag)
                );
                if (frontmatter.tags.length === 0) {
                    delete frontmatter.tags;
                }
            }
        });

        // Update tag tracking to remove these tags from the tracked list
        const tracking = this.plugin.tagTracking[file.path];
        if (tracking && tracking.autoTags) {
            tracking.autoTags = tracking.autoTags.filter(t => !safeToRemove.includes(t));
            if (tracking.autoTags.length === 0) {
                delete this.plugin.tagTracking[file.path];
            }
            await this.plugin.saveSettings();
        }
    }

    /**
     * Read the current tags from a file's metadata cache.
     */
    async getFileTags(file: TFile): Promise<string[]> {
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const tags: string[] = [];
        if (cache?.frontmatter?.tags) {
            if (Array.isArray(cache.frontmatter.tags)) {
                tags.push(...cache.frontmatter.tags);
            } else if (typeof cache.frontmatter.tags === 'string') {
                tags.push(cache.frontmatter.tags);
            }
        }
        return tags;
    }
}
