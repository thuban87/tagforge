// src/services/TagResolver.ts
// Tag resolution logic — determines which tags apply to a file based on
// explicit folder rules and legacy path-based algorithms.

import type TagForgePlugin from '../../main';

export class TagResolver {
    constructor(private plugin: TagForgePlugin) { }

    /**
     * Legacy path-based tag resolution.
     * Derives tags from folder hierarchy up to inheritDepth.
     */
    getTagsForPath(filePath: string): string[] {
        // Check if path should be ignored
        for (const ignorePath of this.plugin.settings.ignorePaths) {
            if (filePath.startsWith(ignorePath + '/') || filePath.startsWith(ignorePath + '\\')) {
                return [];
            }
        }

        const tags: string[] = [];
        const pathParts = filePath.split(/[/\\]/);

        // Remove the filename to get folder parts only
        pathParts.pop();

        // Get tags from folder hierarchy (up to inheritDepth)
        const depth = Math.min(pathParts.length, this.plugin.settings.inheritDepth);
        for (let i = 0; i < depth; i++) {
            const folderName = pathParts[i];
            if (folderName) {
                // Check for folder alias first
                const folderPath = pathParts.slice(0, i + 1).join('/');
                const aliasValue = this.plugin.settings.folderAliases[folderPath];

                if (aliasValue) {
                    // Handle both old format (string) and new format (string[])
                    if (Array.isArray(aliasValue)) {
                        tags.push(...aliasValue);
                    } else {
                        // Legacy: single string value
                        tags.push(String(aliasValue));
                    }
                } else {
                    // Convert folder name to tag format
                    const tag = this.folderNameToTag(folderName);
                    // Only push valid tags (at least 2 chars and contains alphanumeric)
                    if (tag.length > 1 && /[a-z0-9]/.test(tag)) {
                        tags.push(tag);
                    }
                }
            }
        }

        // Add explicit folder mappings
        const fullFolderPath = pathParts.join('/');
        if (this.plugin.settings.folderMappings[fullFolderPath]) {
            tags.push(...this.plugin.settings.folderMappings[fullFolderPath]);
        }

        return [...new Set(tags)]; // Remove duplicates
    }

    /**
     * Get tags for a file path based on explicit folder rules.
     * This is the new rules-based system that replaces the implicit algorithm.
     *
     * Rules work as follows:
     * - Each folder can have a rule that defines tags and how far down they apply
     * - Rules are additive: multiple rules can contribute tags to a single file
     * - A rule's `applyDownLevels` controls how many levels below the rule folder it affects
     * - A rule's `inheritFromAncestors` controls whether it receives tags from parent rules
     *   When set to false, it acts as a "barrier" - ancestor rules won't apply to this folder or below
     */
    getRulesForPath(filePath: string): string[] {
        // Check if path should be ignored
        for (const ignorePath of this.plugin.settings.ignorePaths) {
            if (filePath.startsWith(ignorePath + '/') || filePath.startsWith(ignorePath + '\\')) {
                return [];
            }
        }

        const tags: string[] = [];
        const pathParts = filePath.split(/[/\\]/);

        // Remove the filename to get folder parts only
        pathParts.pop();

        if (pathParts.length === 0) {
            // File is at vault root, check for root rule
            const rootRule = this.plugin.folderRules[''] || this.plugin.folderRules['/'];
            if (rootRule && rootRule.applyToNewFiles) {
                tags.push(...rootRule.tags);
            }
            return [...new Set(tags)];
        }

        // Build the file's folder path
        const fileFolderPath = pathParts.join('/');

        // First, find the deepest folder with inheritFromAncestors: false
        // This acts as a "barrier" - ancestors above this point won't contribute tags
        let inheritanceBarrierLevel = -1;  // -1 means no barrier, include all ancestors
        for (let i = pathParts.length; i >= 1; i--) {
            const folderPath = pathParts.slice(0, i).join('/');
            const rule = this.plugin.folderRules[folderPath];
            if (rule && rule.inheritFromAncestors === false) {
                inheritanceBarrierLevel = i;
                break;  // Found the deepest barrier, stop looking
            }
        }

        // Collect all applicable rules, respecting the inheritance barrier
        for (let i = 0; i <= pathParts.length; i++) {
            const ancestorPath = i === 0 ? '' : pathParts.slice(0, i).join('/');
            const rule = this.plugin.folderRules[ancestorPath];

            if (!rule || !rule.applyToNewFiles) {
                continue;
            }

            // If there's a barrier, skip ancestor rules above the barrier
            // (i.e., rules from folders shallower than the barrier folder)
            if (inheritanceBarrierLevel > 0 && i < inheritanceBarrierLevel) {
                continue;  // Skip this ancestor - blocked by inheritFromAncestors: false
            }

            // Calculate how many levels down the file is from this rule's folder
            const levelsDown = pathParts.length - i;

            // Check if this rule applies to the file based on applyDownLevels
            let ruleApplies = false;

            if (levelsDown === 0) {
                // File is directly in this folder - rule always applies
                ruleApplies = true;
            } else if (rule.applyDownLevels === 'all') {
                // Rule applies to all subfolders
                ruleApplies = true;
            } else if (Array.isArray(rule.applyDownLevels)) {
                // Rule applies to specific levels
                ruleApplies = rule.applyDownLevels.includes(levelsDown);
            }

            if (ruleApplies) {
                // Add custom tags from the rule
                tags.push(...rule.tags);

                // Add dynamic folder-based tags from folderTagLevels
                if (rule.folderTagLevels && rule.folderTagLevels.length > 0) {
                    for (const level of rule.folderTagLevels) {
                        // Level 1 = first folder in path, Level 2 = second folder, etc.
                        const folderIndex = level - 1;
                        if (folderIndex >= 0 && folderIndex < pathParts.length) {
                            const folderName = pathParts[folderIndex];
                            const tag = this.folderNameToTag(folderName);
                            if (tag.length > 1 && /[a-z0-9]/.test(tag)) {
                                tags.push(tag);
                            }
                        }
                    }
                }
            }
        }

        return [...new Set(tags)]; // Remove duplicates
    }

    /**
     * Check if any rules apply to a given file path.
     * Useful for determining if auto-tagging should occur.
     */
    hasRulesForPath(filePath: string): boolean {
        return this.getRulesForPath(filePath).length > 0;
    }

    /**
     * Convert a folder name to a lowercase kebab-case tag.
     */
    folderNameToTag(folderName: string): string {
        return folderName
            .toLowerCase()
            .replace(/['']/g, '')           // Remove apostrophes
            .replace(/[^a-z0-9]+/g, '-')    // Replace non-alphanumeric with hyphens
            .replace(/^-|-$/g, '');          // Remove leading/trailing hyphens
    }
}
