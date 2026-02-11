// src/services/ValidationService.ts
// Tag integrity checking — validates tracking data against actual file state.

import { TFile, Notice } from 'obsidian';
import type TagForgePlugin from '../../main';
import { ValidationIssue } from '../types';

export class ValidationService {
    constructor(private plugin: TagForgePlugin) { }

    /**
     * Scan the vault for tag integrity issues:
     * - Orphaned tracking (file deleted but tracking remains)
     * - Files in ignored paths with tracking data
     * - Missing tags (tracked tags not in file's frontmatter)
     */
    async validateTags() {
        const issues: ValidationIssue[] = [];

        // First, identify files in ignored paths (these take priority)
        const ignoredPathFiles = new Set<string>();
        for (const filePath of Object.keys(this.plugin.tagTracking)) {
            for (const ignorePath of this.plugin.settings.ignorePaths) {
                if (filePath.startsWith(ignorePath + '/') || filePath.startsWith(ignorePath + '\\')) {
                    ignoredPathFiles.add(filePath);
                    issues.push({
                        type: 'ignored-path-tracked',
                        filePath,
                        description: `File in ignored path "${ignorePath}" but still has tracking data. Fix will remove tracking.`,
                    });
                    break;
                }
            }
        }

        // Check for orphaned tracking (tracked files that don't exist)
        for (const filePath of Object.keys(this.plugin.tagTracking)) {
            if (ignoredPathFiles.has(filePath)) continue; // Skip if already flagged

            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (!file) {
                issues.push({
                    type: 'orphaned-tracking',
                    filePath,
                    description: 'File no longer exists but is still tracked',
                });
            }
        }

        // Check for missing tags (tracked tags not in file's frontmatter)
        // Skip files in ignored paths - those have a different issue type
        for (const [filePath, tracking] of Object.entries(this.plugin.tagTracking)) {
            if (ignoredPathFiles.has(filePath)) continue; // Skip if in ignored path

            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (!file || !(file instanceof TFile)) continue;

            const currentTags = await this.plugin.tagIO.getFileTags(file);
            // Case-insensitive comparison for missing tags
            const currentTagsLower = currentTags.map(t => t.toLowerCase());
            const missingTags = tracking.autoTags.filter(t => !currentTagsLower.includes(t.toLowerCase()));

            if (missingTags.length > 0) {
                issues.push({
                    type: 'missing-tags',
                    filePath,
                    description: `Tracked tags missing from file: ${missingTags.map(t => '#' + t).join(', ')}`,
                    tags: missingTags,
                });
            }
        }

        if (issues.length === 0) {
            new Notice('No issues found!');
            return;
        }

        // Import dynamically to avoid circular deps at module level
        const { ValidationResultsModal } = await import('../modals/ValidationResultsModal');
        new ValidationResultsModal(this.plugin.app, issues, this.plugin).open();
    }

    /**
     * Fix a single validation issue based on its type.
     */
    async fixValidationIssue(issue: ValidationIssue) {
        switch (issue.type) {
            case 'orphaned-tracking':
                delete this.plugin.tagTracking[issue.filePath];
                await this.plugin.saveSettings();
                new Notice(`Removed tracking for: ${issue.filePath}`);
                break;

            case 'ignored-path-tracked':
                delete this.plugin.tagTracking[issue.filePath];
                await this.plugin.saveSettings();
                new Notice(`Removed tracking for: ${issue.filePath}`);
                break;

            case 'missing-tags':
                // Re-apply the missing tags
                if (issue.tags) {
                    const file = this.plugin.app.vault.getAbstractFileByPath(issue.filePath);
                    if (file && file instanceof TFile) {
                        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                            let existingTags: string[] = [];
                            if (frontmatter.tags) {
                                if (Array.isArray(frontmatter.tags)) {
                                    existingTags = frontmatter.tags;
                                } else if (typeof frontmatter.tags === 'string') {
                                    existingTags = [frontmatter.tags];
                                }
                            }
                            frontmatter.tags = [...new Set([...existingTags, ...issue.tags!])];
                        });
                        new Notice(`Re-applied missing tags to: ${issue.filePath}`);
                    }
                }
                break;
        }
    }
}
