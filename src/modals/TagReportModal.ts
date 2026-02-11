// src/modals/TagReportModal.ts
// Tag report dashboard modal

import { App, Modal } from 'obsidian';
import type TagForgePlugin from '../../main';

export class TagReportModal extends Modal {
    plugin: TagForgePlugin;

    constructor(app: App, plugin: TagForgePlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('bbab-tf-large-modal');
        contentEl.addClass('bbab-tf-report-modal');

        contentEl.createEl('h2', { text: 'Tag Report Dashboard' });

        // Gather data
        const tagForgeStats = this.getTagForgeStats();
        const allVaultTags = this.getAllVaultTags();

        // Filter out TagForge tags from vault tags
        const manualTags = allVaultTags.filter(t => !tagForgeStats.tags.has(t));

        // Summary section
        const summaryEl = contentEl.createDiv({ cls: 'bbab-tf-report-summary' });
        summaryEl.createEl('div', {
            text: `Tracked files: ${Object.keys(this.plugin.tagTracking).length}`,
            cls: 'bbab-tf-report-stat',
        });
        summaryEl.createEl('div', {
            text: `TagForge tags: ${tagForgeStats.tags.size}`,
            cls: 'bbab-tf-report-stat',
        });
        summaryEl.createEl('div', {
            text: `Manual tags: ${manualTags.length}`,
            cls: 'bbab-tf-report-stat',
        });

        // TagForge Tags Section
        const tfSection = contentEl.createDiv({ cls: 'bbab-tf-report-section' });
        tfSection.createEl('h3', { text: 'TagForge Tags' });

        const REPORT_FILE_LIMIT = 50;

        if (tagForgeStats.tags.size === 0) {
            tfSection.createEl('p', {
                text: 'No tags applied by TagForge yet.',
                cls: 'bbab-tf-no-data',
            });
        } else {
            const tfListEl = tfSection.createDiv({ cls: 'bbab-tf-report-tag-list' });

            // Sort by count descending
            const sortedTags = Array.from(tagForgeStats.tagCounts.entries())
                .sort((a, b) => b[1] - a[1]);

            for (const [tag, count] of sortedTags) {
                const tagEl = tfListEl.createDiv({ cls: 'bbab-tf-report-tag-item' });
                tagEl.createSpan({ text: `#${tag}`, cls: 'bbab-tf-report-tag-name' });
                tagEl.createSpan({ text: `${count} file(s)`, cls: 'bbab-tf-report-tag-count' });

                // Expandable file list
                const filesBtn = tagEl.createEl('button', {
                    text: 'Show files',
                    cls: 'bbab-tf-report-expand-btn',
                });

                const filesEl = tagEl.createDiv({ cls: 'bbab-tf-report-files hidden' });
                const files = tagForgeStats.tagFiles.get(tag) || [];
                const displayFiles = files.slice(0, REPORT_FILE_LIMIT);
                const hasMore = files.length > REPORT_FILE_LIMIT;

                for (const f of displayFiles) {
                    filesEl.createEl('div', { text: f, cls: 'bbab-tf-report-file' });
                }

                if (hasMore) {
                    const moreEl = filesEl.createDiv({ cls: 'bbab-tf-report-more' });
                    let shownCount = REPORT_FILE_LIMIT;

                    const updateMoreText = () => {
                        const remaining = files.length - shownCount;
                        moreTextSpan.textContent = `... and ${remaining} more files`;
                        showMoreBtn.textContent = remaining > REPORT_FILE_LIMIT ? `Show ${REPORT_FILE_LIMIT} more` : `Show ${remaining} more`;
                    };

                    const moreTextSpan = moreEl.createSpan({
                        text: `... and ${files.length - REPORT_FILE_LIMIT} more files`,
                        cls: 'bbab-tf-report-more-text',
                    });
                    const showMoreBtn = moreEl.createEl('button', {
                        text: files.length - REPORT_FILE_LIMIT > REPORT_FILE_LIMIT ? `Show ${REPORT_FILE_LIMIT} more` : `Show ${files.length - REPORT_FILE_LIMIT} more`,
                        cls: 'bbab-tf-report-show-all-btn',
                    });
                    showMoreBtn.addEventListener('click', () => {
                        // Add next batch of files
                        const nextBatch = files.slice(shownCount, shownCount + REPORT_FILE_LIMIT);
                        for (const f of nextBatch) {
                            const newFileEl = filesEl.createEl('div', { text: f, cls: 'bbab-tf-report-file' });
                            filesEl.insertBefore(newFileEl, moreEl);
                        }
                        shownCount += nextBatch.length;

                        // Remove the "more" element if we've shown all files
                        if (shownCount >= files.length) {
                            moreEl.remove();
                        } else {
                            updateMoreText();
                        }
                    });
                }

                filesBtn.addEventListener('click', () => {
                    filesEl.classList.toggle('hidden');
                    filesBtn.textContent = filesEl.classList.contains('hidden') ? 'Show files' : 'Hide files';
                });
            }
        }

        // Manual Tags Section
        const manualSection = contentEl.createDiv({ cls: 'bbab-tf-report-section' });
        manualSection.createEl('h3', { text: 'Manual Tags (not tracked by TagForge)' });

        if (manualTags.length === 0) {
            manualSection.createEl('p', {
                text: 'No manual tags found.',
                cls: 'bbab-tf-no-data',
            });
        } else {
            const manualListEl = manualSection.createDiv({ cls: 'bbab-tf-report-manual-tags' });
            for (const tag of manualTags.sort()) {
                manualListEl.createSpan({ text: `#${tag}`, cls: 'bbab-tf-report-manual-tag' });
            }
        }

        // Close button
        const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-button-container' });
        const closeBtn = buttonContainer.createEl('button', { text: 'Close', cls: 'mod-cta' });
        closeBtn.addEventListener('click', () => {
            this.close();
        });
    }

    getTagForgeStats(): {
        tags: Set<string>;
        tagCounts: Map<string, number>;
        tagFiles: Map<string, string[]>;
    } {
        const tags = new Set<string>();
        const tagCounts = new Map<string, number>();
        const tagFiles = new Map<string, string[]>();

        for (const [filePath, tracking] of Object.entries(this.plugin.tagTracking)) {
            for (const tag of tracking.autoTags) {
                tags.add(tag);
                tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);

                if (!tagFiles.has(tag)) {
                    tagFiles.set(tag, []);
                }
                tagFiles.get(tag)!.push(filePath);
            }
        }

        return { tags, tagCounts, tagFiles };
    }

    getAllVaultTags(): string[] {
        const tags = new Set<string>();
        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter?.tags) {
                if (Array.isArray(cache.frontmatter.tags)) {
                    cache.frontmatter.tags.forEach((t: string) => tags.add(t));
                } else if (typeof cache.frontmatter.tags === 'string') {
                    tags.add(cache.frontmatter.tags);
                }
            }
        }

        return Array.from(tags);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
