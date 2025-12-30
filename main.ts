import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, Modal, TFolder } from 'obsidian';

// ============================================================================
// Settings Interface
// ============================================================================

interface TagForgeSettings {
	// Core settings
	inheritDepth: number;
	tagFormat: 'frontmatter' | 'inline';
	showMoveConfirmation: boolean;

	// Folder-based rules (Phase 2+)
	folderMappings: Record<string, string[]>;
	folderAliases: Record<string, string[]>;  // folder path -> array of tag names

	// Exclusions and protection
	ignorePaths: string[];
	protectedTags: string[];

	// Advanced rules (Phase 7+)
	contentRules: Array<{ pattern: string; tags: string[] }>;
	filenameRules: Array<{ pattern: string; tags: string[] }>;
}

// ============================================================================
// Tag Tracking Interface (for internal plugin data)
// ============================================================================

interface TagTrackingEntry {
	autoTags: string[];
	lastUpdated: string;
}

interface TagForgeData {
	settings: TagForgeSettings;
	tagTracking: Record<string, TagTrackingEntry>;
}

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_SETTINGS: TagForgeSettings = {
	inheritDepth: 3,
	tagFormat: 'frontmatter',
	showMoveConfirmation: true,
	folderMappings: {},
	folderAliases: {},
	ignorePaths: ['Templates', '.obsidian'],
	protectedTags: [],
	contentRules: [],
	filenameRules: [],
};

const DEFAULT_DATA: TagForgeData = {
	settings: DEFAULT_SETTINGS,
	tagTracking: {},
};

// ============================================================================
// Main Plugin Class
// ============================================================================

export default class TagForgePlugin extends Plugin {
	settings: TagForgeSettings;
	tagTracking: Record<string, TagTrackingEntry>;

	async onload() {
		console.log('TagForge: Loading plugin');

		// Load settings and tag tracking data
		await this.loadSettings();

		// Add settings tab
		this.addSettingTab(new TagForgeSettingTab(this.app, this));

		// Add command to manually trigger tagging (for testing)
		this.addCommand({
			id: 'tag-current-file',
			name: 'Tag current file based on folder',
			callback: () => this.tagCurrentFile(),
		});

		// Emergency revert command
		this.addCommand({
			id: 'revert-all-auto-tags',
			name: 'REVERT: Remove all auto-applied tags',
			callback: () => this.revertAllAutoTags(),
		});

		// Nuclear revert - clear ALL tags
		this.addCommand({
			id: 'revert-all-tags-nuclear',
			name: 'REVERT: Remove ALL tags from vault (nuclear option)',
			callback: () => this.revertAllTagsNuclear(),
		});

		// Date-filtered revert
		this.addCommand({
			id: 'revert-auto-tags-by-date',
			name: 'REVERT: Remove auto-tags by date',
			callback: () => this.revertAutoTagsByDate(),
		});

		// Phase 3: Bulk operations
		this.addCommand({
			id: 'bulk-apply-tags',
			name: 'BULK: Apply tags to entire vault (with preview)',
			callback: () => this.bulkApplyTags(),
		});

		this.addCommand({
			id: 'bulk-apply-folder',
			name: 'BULK: Apply tags to specific folder (with preview)',
			callback: () => this.bulkApplyToFolder(),
		});

		// Phase 2: Watch for new files (only after vault is fully loaded)
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on('create', (file) => {
					if (file instanceof TFile) {
						// Small delay to ensure file is ready
						setTimeout(() => this.handleFileCreate(file), 100);
					}
				})
			);
			console.log('TagForge: File watcher activated');
		});

		console.log('TagForge: Plugin loaded successfully');
	}

	onunload() {
		console.log('TagForge: Unloading plugin');
	}

	// -------------------------------------------------------------------------
	// Settings Management
	// -------------------------------------------------------------------------

	async loadSettings() {
		const data = await this.loadData();
		const loadedData: TagForgeData = Object.assign({}, DEFAULT_DATA, data);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData.settings);
		this.tagTracking = loadedData.tagTracking || {};
	}

	async saveSettings() {
		const data: TagForgeData = {
			settings: this.settings,
			tagTracking: this.tagTracking,
		};
		await this.saveData(data);
	}

	// -------------------------------------------------------------------------
	// Tagging Functions (Phase 1 - Basic Implementation)
	// -------------------------------------------------------------------------

	async tagCurrentFile() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('No active file');
			return;
		}

		// Get tags based on folder path
		const tags = this.getTagsForPath(activeFile.path);
		if (tags.length === 0) {
			new Notice('No tags to apply for this location');
			return;
		}

		// Apply tags to the file
		await this.applyTagsToFile(activeFile.path, tags);
		new Notice(`Applied tags: ${tags.map(t => '#' + t).join(', ')}`);
	}

	async handleFileCreate(file: TFile) {
		// Only process markdown files
		if (file.extension !== 'md') {
			return;
		}

		// Get tags based on folder path
		const tags = this.getTagsForPath(file.path);
		if (tags.length === 0) {
			return;
		}

		// Apply tags to the file
		await this.applyTagsToFile(file.path, tags);
		console.log(`TagForge: Auto-tagged ${file.name} with ${tags.map(t => '#' + t).join(', ')}`);
	}

	async revertAllAutoTags() {
		const trackedFiles = Object.keys(this.tagTracking);
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

		for (const filePath of trackedFiles) {
			const tracking = this.tagTracking[filePath];
			if (!tracking || tracking.autoTags.length === 0) {
				continue;
			}

			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!file || !(file instanceof TFile)) {
				errors++;
				continue;
			}

			try {
				await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
					if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
						// Remove only the auto-applied tags
						frontmatter.tags = frontmatter.tags.filter(
							(tag: string) => !tracking.autoTags.includes(tag)
						);
						// Remove empty tags array
						if (frontmatter.tags.length === 0) {
							delete frontmatter.tags;
						}
					}
				});
				reverted++;
			} catch (e) {
				console.error(`TagForge: Failed to revert ${filePath}`, e);
				errors++;
			}
		}

		// Clear tracking data
		this.tagTracking = {};
		await this.saveSettings();

		new Notice(`Reverted ${reverted} files. ${errors > 0 ? `${errors} errors.` : ''}`);
		console.log(`TagForge: Revert complete. ${reverted} files reverted, ${errors} errors.`);
	}

	async revertAllTagsNuclear() {
		const files = this.app.vault.getMarkdownFiles();

		const confirmed = confirm(
			`⚠️ NUCLEAR OPTION ⚠️\n\nThis will remove ALL tags (auto AND manual) from ALL ${files.length} markdown files in your vault.\n\nThis cannot be undone. Continue?`
		);
		if (!confirmed) {
			return;
		}

		// Double confirm for safety
		const doubleConfirm = confirm(
			`Are you REALLY sure? This will clear tags from ${files.length} files.`
		);
		if (!doubleConfirm) {
			return;
		}

		let cleared = 0;
		let errors = 0;

		for (const file of files) {
			try {
				await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
					if (frontmatter.tags) {
						delete frontmatter.tags;
					}
				});
				cleared++;
			} catch (e) {
				console.error(`TagForge: Failed to clear tags from ${file.path}`, e);
				errors++;
			}
		}

		// Clear tracking data too
		this.tagTracking = {};
		await this.saveSettings();

		new Notice(`Cleared tags from ${cleared} files. ${errors > 0 ? `${errors} errors.` : ''}`);
		console.log(`TagForge: Nuclear revert complete. ${cleared} files cleared, ${errors} errors.`);
	}

	async revertAutoTagsByDate() {
		// Get unique dates from tracking
		const dateMap: Record<string, string[]> = {};

		for (const [filePath, tracking] of Object.entries(this.tagTracking)) {
			if (!tracking.lastUpdated) continue;
			const date = tracking.lastUpdated.split('T')[0]; // YYYY-MM-DD
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
		new DatePickerModal(this.app, dates, dateMap, async (selectedDates) => {
			await this.revertFilesFromDates(selectedDates, dateMap);
		}).open();
	}

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

		for (const filePath of filesToRevert) {
			const tracking = this.tagTracking[filePath];
			if (!tracking || tracking.autoTags.length === 0) {
				continue;
			}

			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!file || !(file instanceof TFile)) {
				errors++;
				continue;
			}

			try {
				await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
					if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
						frontmatter.tags = frontmatter.tags.filter(
							(tag: string) => !tracking.autoTags.includes(tag)
						);
						if (frontmatter.tags.length === 0) {
							delete frontmatter.tags;
						}
					}
				});
				// Remove from tracking
				delete this.tagTracking[filePath];
				reverted++;
			} catch (e) {
				console.error(`TagForge: Failed to revert ${filePath}`, e);
				errors++;
			}
		}

		await this.saveSettings();
		new Notice(`Reverted ${reverted} files from ${selectedDates.length} date(s). ${errors > 0 ? `${errors} errors.` : ''}`);
	}

	// -------------------------------------------------------------------------
	// Phase 3: Bulk Operations
	// -------------------------------------------------------------------------

	async bulkApplyTags() {
		const files = this.app.vault.getMarkdownFiles();
		const items = this.generateEnhancedPreview(files);

		if (items.length === 0) {
			new Notice('No files found (all files may be in ignored paths)');
			return;
		}

		new BulkPreviewModal(this.app, items, 'entire vault', async (results) => {
			await this.executeBulkApply(results);
		}).open();
	}

	async bulkApplyToFolder() {
		// Get all folders in vault
		const folders: string[] = [];
		this.app.vault.getAllLoadedFiles().forEach(file => {
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

		new FolderPickerModal(this.app, folders, async (selectedFolder, includeSubdirs) => {
			let files: TFile[];

			if (includeSubdirs) {
				// Include all files in folder and subdirectories
				files = this.app.vault.getMarkdownFiles().filter(f =>
					f.path.startsWith(selectedFolder + '/')
				);
			} else {
				// Only files directly in this folder (not subdirectories)
				files = this.app.vault.getMarkdownFiles().filter(f => {
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
			new BulkPreviewModal(this.app, items, description, async (results) => {
				await this.executeBulkApply(results);
			}).open();
		}).open();
	}

	generateEnhancedPreview(files: TFile[]): EnhancedPreviewItem[] {
		const items: EnhancedPreviewItem[] = [];

		for (const file of files) {
			// Check if in ignored path
			let ignored = false;
			for (const ignorePath of this.settings.ignorePaths) {
				if (file.path.startsWith(ignorePath + '/') || file.path.startsWith(ignorePath + '\\')) {
					ignored = true;
					break;
				}
			}
			if (ignored) continue;

			// Get current tags from cache
			const cache = this.app.metadataCache.getFileCache(file);
			const currentTags: string[] = [];
			if (cache?.frontmatter?.tags) {
				if (Array.isArray(cache.frontmatter.tags)) {
					currentTags.push(...cache.frontmatter.tags);
				} else if (typeof cache.frontmatter.tags === 'string') {
					currentTags.push(cache.frontmatter.tags);
				}
			}

			// Get folder tags by level
			const folderTagsByLevel = this.getFolderTagsByLevel(file.path);

			items.push({
				file,
				currentTags,
				folderTagsByLevel,
			});
		}

		return items;
	}

	getFolderTagsByLevel(filePath: string): string[][] {
		const tagsByLevel: string[][] = [];
		const pathParts = filePath.split(/[/\\]/);
		pathParts.pop(); // Remove filename

		for (let i = 0; i < pathParts.length; i++) {
			const folderName = pathParts[i];
			if (folderName) {
				const folderPath = pathParts.slice(0, i + 1).join('/');
				const aliasValue = this.settings.folderAliases[folderPath];

				if (aliasValue) {
					// Handle both old format (string) and new format (string[])
					if (Array.isArray(aliasValue)) {
						tagsByLevel.push(aliasValue);
					} else {
						// Legacy: single string
						tagsByLevel.push([aliasValue as unknown as string]);
					}
				} else {
					tagsByLevel.push([this.folderNameToTag(folderName)]);
				}
			}
		}

		return tagsByLevel;
	}

	async executeBulkApply(results: Array<{ file: TFile; tags: string[] }>) {
		let applied = 0;
		let errors = 0;

		for (const item of results) {
			try {
				await this.applyTagsToFile(item.file.path, item.tags);
				applied++;
			} catch (e) {
				console.error(`TagForge: Failed to tag ${item.file.path}`, e);
				errors++;
			}
		}

		new Notice(`Tagged ${applied} files. ${errors > 0 ? `${errors} errors.` : ''}`);
		console.log(`TagForge: Bulk apply complete. ${applied} files tagged, ${errors} errors.`);
	}

	getTagsForPath(filePath: string): string[] {
		// Check if path should be ignored
		for (const ignorePath of this.settings.ignorePaths) {
			if (filePath.startsWith(ignorePath + '/') || filePath.startsWith(ignorePath + '\\')) {
				return [];
			}
		}

		const tags: string[] = [];
		const pathParts = filePath.split(/[/\\]/);

		// Remove the filename to get folder parts only
		pathParts.pop();

		// Get tags from folder hierarchy (up to inheritDepth)
		const depth = Math.min(pathParts.length, this.settings.inheritDepth);
		for (let i = 0; i < depth; i++) {
			const folderName = pathParts[i];
			if (folderName) {
				// Check for folder alias first
				const folderPath = pathParts.slice(0, i + 1).join('/');
				const aliasValue = this.settings.folderAliases[folderPath];

				if (aliasValue) {
					// Handle both old format (string) and new format (string[])
					if (Array.isArray(aliasValue)) {
						tags.push(...aliasValue);
					} else {
						tags.push(aliasValue as unknown as string);
					}
				} else {
					// Convert folder name to tag format
					const tag = this.folderNameToTag(folderName);
					tags.push(tag);
				}
			}
		}

		// Add explicit folder mappings
		const fullFolderPath = pathParts.join('/');
		if (this.settings.folderMappings[fullFolderPath]) {
			tags.push(...this.settings.folderMappings[fullFolderPath]);
		}

		return [...new Set(tags)]; // Remove duplicates
	}

	folderNameToTag(folderName: string): string {
		// Convert folder name to lowercase kebab-case tag
		return folderName
			.toLowerCase()
			.replace(/['']/g, '')           // Remove apostrophes
			.replace(/[^a-z0-9]+/g, '-')    // Replace non-alphanumeric with hyphens
			.replace(/^-|-$/g, '');          // Remove leading/trailing hyphens
	}

	async applyTagsToFile(filePath: string, tags: string[]) {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) {
			return;
		}

		// Filter out protected tags
		const tagsToApply = tags.filter(t => !this.settings.protectedTags.includes(t));

		if (this.settings.tagFormat === 'frontmatter') {
			await this.applyFrontmatterTags(filePath, tagsToApply);
		} else {
			await this.applyInlineTags(filePath, tagsToApply);
		}

		// Track the tags we applied
		this.tagTracking[filePath] = {
			autoTags: tagsToApply,
			lastUpdated: new Date().toISOString(),
		};
		await this.saveSettings();
	}

	async applyFrontmatterTags(filePath: string, tags: string[]) {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) return;

		await this.app.fileManager.processFrontMatter(file as any, (frontmatter) => {
			// Get existing tags
			let existingTags: string[] = [];
			if (frontmatter.tags) {
				if (Array.isArray(frontmatter.tags)) {
					existingTags = frontmatter.tags;
				} else if (typeof frontmatter.tags === 'string') {
					existingTags = [frontmatter.tags];
				}
			}

			// Merge with new tags (avoiding duplicates)
			const allTags = [...new Set([...existingTags, ...tags])];
			frontmatter.tags = allTags;
		});
	}

	async applyInlineTags(filePath: string, tags: string[]) {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) return;

		const content = await this.app.vault.read(file as any);
		const tagString = tags.map(t => '#' + t).join(' ');

		// Add tags at the end of the file if not already present
		const lines = content.split('\n');
		const lastLine = lines[lines.length - 1];

		// Check if tags are already there
		const existingTags = tags.filter(t => content.includes('#' + t));
		const newTags = tags.filter(t => !existingTags.includes(t));

		if (newTags.length > 0) {
			const newTagString = newTags.map(t => '#' + t).join(' ');
			const newContent = content + '\n\n' + newTagString;
			await this.app.vault.modify(file as any, newContent);
		}
	}
}

// ============================================================================
// Enhanced Bulk Preview Modal (Phase 3+)
// ============================================================================

interface EnhancedPreviewItem {
	file: TFile;
	currentTags: string[];
	folderTagsByLevel: string[][]; // Tags at each level: [[level1], [level2], ...]
}

class BulkPreviewModal extends Modal {
	items: EnhancedPreviewItem[];
	targetDescription: string;
	onConfirm: (results: Array<{ file: TFile; tags: string[] }>) => void;

	// State
	selectedFiles: Set<string> = new Set();
	enabledLevels: Set<number> = new Set();
	skipAllFolderTags: boolean = false;
	additionalTags: string[] = [];
	additionalTagsToSelectedOnly: boolean = false;
	maxLevel: number = 0;

	// UI references for updates
	listEl: HTMLElement | null = null;
	applyBtn: HTMLButtonElement | null = null;
	statsEl: HTMLElement | null = null;

	constructor(
		app: App,
		items: EnhancedPreviewItem[],
		targetDescription: string,
		onConfirm: (results: Array<{ file: TFile; tags: string[] }>) => void
	) {
		super(app);
		this.items = items;
		this.targetDescription = targetDescription;
		this.onConfirm = onConfirm;

		// Initialize: all files selected, all levels enabled
		for (const item of items) {
			this.selectedFiles.add(item.file.path);
			const levels = item.folderTagsByLevel.length;
			if (levels > this.maxLevel) this.maxLevel = levels;
		}
		for (let i = 1; i <= this.maxLevel; i++) {
			this.enabledLevels.add(i);
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('bbab-tf-bulk-preview-modal');

		contentEl.createEl('h2', { text: 'Preview: Bulk Tag Application' });
		contentEl.createEl('p', {
			text: `Configuring tags for ${this.items.length} files in ${this.targetDescription}`,
			cls: 'bbab-tf-description',
		});

		// Folder Tags Section
		const folderSection = contentEl.createDiv({ cls: 'bbab-tf-section' });
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
		const additionalSection = contentEl.createDiv({ cls: 'bbab-tf-section' });
		additionalSection.createEl('h3', { text: 'Additional Tags' });

		const additionalInput = additionalSection.createEl('input', {
			type: 'text',
			placeholder: 'Enter tags separated by commas (e.g., tinder, dating-app)',
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
		const applyToContainer = additionalSection.createDiv({ cls: 'bbab-tf-apply-to' });
		applyToContainer.createSpan({ text: 'Apply additional tags to: ' });

		const allLabel = applyToContainer.createEl('label');
		const allRadio = allLabel.createEl('input', { type: 'radio', attr: { name: 'applyTo' } });
		allRadio.checked = true;
		allLabel.createSpan({ text: ' All files' });

		const selectedLabel = applyToContainer.createEl('label');
		const selectedRadio = selectedLabel.createEl('input', { type: 'radio', attr: { name: 'applyTo' } });
		selectedLabel.createSpan({ text: ' Selected only' });

		allRadio.addEventListener('change', () => {
			this.additionalTagsToSelectedOnly = false;
			this.renderList();
		});
		selectedRadio.addEventListener('change', () => {
			this.additionalTagsToSelectedOnly = true;
			this.renderList();
		});

		// Files Section
		const filesSection = contentEl.createDiv({ cls: 'bbab-tf-section' });
		this.statsEl = filesSection.createEl('h3', { text: 'Files' });

		// Select all/none buttons
		const selectionBtns = filesSection.createDiv({ cls: 'bbab-tf-selection-btns' });
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

		// File list
		this.listEl = filesSection.createDiv({ cls: 'bbab-tf-preview' });
		this.renderList();

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-button-container' });

		this.applyBtn = buttonContainer.createEl('button', {
			text: `Apply`,
			cls: 'mod-cta',
		}) as HTMLButtonElement;
		this.applyBtn.addEventListener('click', () => {
			const results = this.computeFinalResults();
			if (results.length === 0) {
				new Notice('No tags to apply');
				return;
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

		for (const item of this.items) {
			const isSelected = this.selectedFiles.has(item.file.path);
			const folderTags = this.computeFolderTags(item);
			const additionalTags = this.getAdditionalTagsForFile(item);
			const allNewTags = [...new Set([...folderTags, ...additionalTags])];
			const tagsToAdd = allNewTags.filter(t => !item.currentTags.includes(t));

			if (tagsToAdd.length > 0) filesWithChanges++;

			const itemEl = this.listEl.createDiv({ cls: 'bbab-tf-preview-item' });

			// Checkbox + path row
			const headerRow = itemEl.createDiv({ cls: 'bbab-tf-preview-header' });
			const checkbox = headerRow.createEl('input', { type: 'checkbox' });
			checkbox.checked = isSelected;
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					this.selectedFiles.add(item.file.path);
				} else {
					this.selectedFiles.delete(item.file.path);
				}
				this.renderList();
			});

			headerRow.createSpan({ text: item.file.path, cls: 'bbab-tf-preview-path' });

			// Tags display
			const tagsEl = itemEl.createDiv({ cls: 'bbab-tf-preview-tags' });

			if (item.currentTags.length > 0) {
				tagsEl.createSpan({ text: 'Current: ', cls: 'bbab-tf-tag-label' });
				tagsEl.createSpan({ text: item.currentTags.map(t => '#' + t).join(' ') });
				tagsEl.createEl('br');
			}

			if (tagsToAdd.length > 0) {
				tagsEl.createSpan({ text: 'Adding: ', cls: 'bbab-tf-tag-label' });

				// Show folder tags
				if (folderTags.length > 0) {
					const newFolderTags = folderTags.filter(t => !item.currentTags.includes(t));
					if (newFolderTags.length > 0) {
						tagsEl.createSpan({
							text: newFolderTags.map(t => '#' + t).join(' '),
							cls: 'bbab-tf-tag-add',
						});
					}
				}

				// Show additional tags
				const newAdditionalTags = additionalTags.filter(t => !item.currentTags.includes(t) && !folderTags.includes(t));
				if (newAdditionalTags.length > 0) {
					if (folderTags.length > 0) tagsEl.createSpan({ text: ' ' });
					tagsEl.createSpan({
						text: newAdditionalTags.map(t => '#' + t).join(' '),
						cls: 'bbab-tf-tag-additional',
					});
				}
			} else {
				tagsEl.createSpan({ text: '(no changes)', cls: 'bbab-tf-no-changes' });
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

	computeFinalResults(): Array<{ file: TFile; tags: string[] }> {
		const results: Array<{ file: TFile; tags: string[] }> = [];

		for (const item of this.items) {
			const folderTags = this.computeFolderTags(item);
			const additionalTags = this.getAdditionalTagsForFile(item);
			const allNewTags = [...new Set([...folderTags, ...additionalTags])];
			const tagsToAdd = allNewTags.filter(t => !item.currentTags.includes(t));

			if (tagsToAdd.length > 0) {
				results.push({ file: item.file, tags: tagsToAdd });
			}
		}

		return results;
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// Folder Picker Modal (Phase 3)
// ============================================================================

class FolderPickerModal extends Modal {
	folders: string[];
	onSelect: (folder: string, includeSubdirs: boolean) => void;
	filteredFolders: string[];
	includeSubdirs: boolean = true;

	constructor(app: App, folders: string[], onSelect: (folder: string, includeSubdirs: boolean) => void) {
		super(app);
		this.folders = folders;
		this.filteredFolders = folders;
		this.onSelect = onSelect;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('bbab-tf-folder-picker-modal');

		contentEl.createEl('h2', { text: 'Select folder to tag' });

		// Include subdirectories option
		const optionsDiv = contentEl.createDiv({ cls: 'bbab-tf-folder-options' });
		const subdirsLabel = optionsDiv.createEl('label', { cls: 'bbab-tf-subdirs-option' });
		const subdirsCheckbox = subdirsLabel.createEl('input', { type: 'checkbox' });
		subdirsCheckbox.checked = this.includeSubdirs;
		subdirsLabel.createSpan({ text: ' Include subdirectories' });
		subdirsCheckbox.addEventListener('change', () => {
			this.includeSubdirs = subdirsCheckbox.checked;
		});

		// Search input
		const searchInput = contentEl.createEl('input', {
			type: 'text',
			placeholder: 'Type to filter folders...',
			cls: 'bbab-tf-folder-search',
		});

		const listEl = contentEl.createDiv({ cls: 'bbab-tf-folder-list' });

		const renderList = () => {
			listEl.empty();
			for (const folder of this.filteredFolders) {
				const itemEl = listEl.createDiv({
					cls: 'bbab-tf-folder-item',
					text: folder,
				});
				itemEl.addEventListener('click', () => {
					this.close();
					this.onSelect(folder, this.includeSubdirs);
				});
			}
		};

		searchInput.addEventListener('input', () => {
			const query = searchInput.value.toLowerCase();
			this.filteredFolders = this.folders.filter(f =>
				f.toLowerCase().includes(query)
			);
			renderList();
		});

		renderList();

		// Focus search input
		searchInput.focus();

		// Cancel button
		const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-button-container' });
		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => {
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// Date Picker Modal for Revert by Date
// ============================================================================

class DatePickerModal extends Modal {
	dates: string[];
	dateMap: Record<string, string[]>;
	onSubmit: (selectedDates: string[]) => void;
	selectedDates: Set<string> = new Set();

	constructor(
		app: App,
		dates: string[],
		dateMap: Record<string, string[]>,
		onSubmit: (selectedDates: string[]) => void
	) {
		super(app);
		this.dates = dates;
		this.dateMap = dateMap;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('bbab-tf-date-picker-modal');

		contentEl.createEl('h2', { text: 'Select dates to revert' });
		contentEl.createEl('p', {
			text: 'Choose which dates to remove auto-applied tags from:',
			cls: 'bbab-tf-description',
		});

		const listEl = contentEl.createDiv({ cls: 'bbab-tf-date-list' });

		for (const date of this.dates) {
			const fileCount = this.dateMap[date].length;
			const itemEl = listEl.createDiv({ cls: 'bbab-tf-date-item' });

			const checkbox = itemEl.createEl('input', {
				type: 'checkbox',
				attr: { id: `date-${date}` },
			});

			const label = itemEl.createEl('label', {
				text: `${date} (${fileCount} file${fileCount !== 1 ? 's' : ''})`,
				attr: { for: `date-${date}` },
			});

			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					this.selectedDates.add(date);
				} else {
					this.selectedDates.delete(date);
				}
			});
		}

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-button-container' });

		const selectAllBtn = buttonContainer.createEl('button', { text: 'Select All' });
		selectAllBtn.addEventListener('click', () => {
			const checkboxes = listEl.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
			checkboxes.forEach(cb => {
				cb.checked = true;
				const date = cb.id.replace('date-', '');
				this.selectedDates.add(date);
			});
		});

		const selectNoneBtn = buttonContainer.createEl('button', { text: 'Select None' });
		selectNoneBtn.addEventListener('click', () => {
			const checkboxes = listEl.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
			checkboxes.forEach(cb => {
				cb.checked = false;
			});
			this.selectedDates.clear();
		});

		const revertBtn = buttonContainer.createEl('button', {
			text: 'Revert Selected',
			cls: 'mod-cta',
		});
		revertBtn.addEventListener('click', () => {
			if (this.selectedDates.size === 0) {
				new Notice('No dates selected');
				return;
			}
			this.close();
			this.onSubmit(Array.from(this.selectedDates));
		});

		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => {
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// Settings Tab
// ============================================================================

class TagForgeSettingTab extends PluginSettingTab {
	plugin: TagForgePlugin;

	constructor(app: App, plugin: TagForgePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('bbab-tf-settings-container');

		// Header
		containerEl.createEl('h1', { text: 'TagForge Settings' });
		containerEl.createEl('p', {
			text: 'Automatic hierarchical tag management based on folder structure.',
			cls: 'bbab-tf-description',
		});

		// -------------------------------------------------------------------------
		// Core Settings
		// -------------------------------------------------------------------------

		containerEl.createEl('h2', { text: 'Core Settings' });

		new Setting(containerEl)
			.setName('Inheritance depth')
			.setDesc('How many folder levels to inherit tags from (e.g., 3 = top 3 folders)')
			.addText(text => text
				.setPlaceholder('3')
				.setValue(String(this.plugin.settings.inheritDepth))
				.onChange(async (value) => {
					const num = parseInt(value, 10);
					if (!isNaN(num) && num >= 1) {
						this.plugin.settings.inheritDepth = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Tag format')
			.setDesc('Where to store tags in your notes')
			.addDropdown(dropdown => dropdown
				.addOption('frontmatter', 'Frontmatter (YAML)')
				.addOption('inline', 'Inline (end of file)')
				.setValue(this.plugin.settings.tagFormat)
				.onChange(async (value: 'frontmatter' | 'inline') => {
					this.plugin.settings.tagFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show move confirmation')
			.setDesc('Ask before updating tags when a file is moved')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showMoveConfirmation)
				.onChange(async (value) => {
					this.plugin.settings.showMoveConfirmation = value;
					await this.plugin.saveSettings();
				}));

		// -------------------------------------------------------------------------
		// Ignore Paths
		// -------------------------------------------------------------------------

		containerEl.createEl('h2', { text: 'Ignore Paths' });
		containerEl.createEl('p', {
			text: 'Folders to skip when auto-tagging (one per line)',
			cls: 'bbab-tf-description',
		});

		new Setting(containerEl)
			.setName('Ignored folders')
			.setDesc('Files in these folders will not be auto-tagged')
			.addTextArea(text => text
				.setPlaceholder('Templates\n.obsidian\nArchive')
				.setValue(this.plugin.settings.ignorePaths.join('\n'))
				.onChange(async (value) => {
					this.plugin.settings.ignorePaths = value
						.split('\n')
						.map(p => p.trim())
						.filter(p => p.length > 0);
					await this.plugin.saveSettings();
				}));

		// -------------------------------------------------------------------------
		// Protected Tags
		// -------------------------------------------------------------------------

		containerEl.createEl('h2', { text: 'Protected Tags' });
		containerEl.createEl('p', {
			text: 'Tags that TagForge should never add or remove (one per line, without #)',
			cls: 'bbab-tf-description',
		});

		new Setting(containerEl)
			.setName('Protected tags')
			.setDesc('These tags will be left untouched by auto-tagging')
			.addTextArea(text => text
				.setPlaceholder('important\nfavorite\npinned')
				.setValue(this.plugin.settings.protectedTags.join('\n'))
				.onChange(async (value) => {
					this.plugin.settings.protectedTags = value
						.split('\n')
						.map(t => t.trim().replace(/^#/, ''))
						.filter(t => t.length > 0);
					await this.plugin.saveSettings();
				}));

		// -------------------------------------------------------------------------
		// Folder Aliases
		// -------------------------------------------------------------------------

		containerEl.createEl('h2', { text: 'Folder Aliases' });
		containerEl.createEl('p', {
			text: 'Override auto-generated tag names for specific folders. Useful when folder names don\'t match desired tags.',
			cls: 'bbab-tf-description',
		});

		const aliasContainer = containerEl.createDiv({ cls: 'bbab-tf-alias-container' });

		const renderAliases = () => {
			aliasContainer.empty();

			const aliases = Object.entries(this.plugin.settings.folderAliases);

			if (aliases.length === 0) {
				aliasContainer.createEl('p', {
					text: 'No aliases configured. Add one below.',
					cls: 'bbab-tf-no-aliases',
				});
			} else {
				for (const [folderPath, tagNames] of aliases) {
					const aliasRow = aliasContainer.createDiv({ cls: 'bbab-tf-alias-row' });

					aliasRow.createSpan({ text: folderPath, cls: 'bbab-tf-alias-folder' });
					aliasRow.createSpan({ text: ' → ', cls: 'bbab-tf-alias-arrow' });

					// Handle both old format (string) and new format (string[])
					const tagsArray = Array.isArray(tagNames) ? tagNames : [tagNames];
					aliasRow.createSpan({
						text: tagsArray.map(t => '#' + t).join(', '),
						cls: 'bbab-tf-alias-tag',
					});

					const removeBtn = aliasRow.createEl('button', { text: '×', cls: 'bbab-tf-alias-remove' });
					removeBtn.addEventListener('click', async () => {
						delete this.plugin.settings.folderAliases[folderPath];
						await this.plugin.saveSettings();
						renderAliases();
					});
				}
			}

			// Add new alias form
			const addForm = aliasContainer.createDiv({ cls: 'bbab-tf-alias-add-form' });

			const folderInput = addForm.createEl('input', {
				type: 'text',
				placeholder: 'Folder path (e.g., Personal/Projects)',
				cls: 'bbab-tf-alias-input',
			});

			const tagInput = addForm.createEl('input', {
				type: 'text',
				placeholder: 'Tags (comma-separated, e.g., dating, relationships)',
				cls: 'bbab-tf-alias-input',
			});

			const addBtn = addForm.createEl('button', { text: 'Add Alias' });
			addBtn.addEventListener('click', async () => {
				const folder = folderInput.value.trim();
				const tagsRaw = tagInput.value;

				// Parse comma-separated tags
				const tags = tagsRaw
					.split(',')
					.map(t => t.trim().replace(/^#/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, ''))
					.filter(t => t.length > 0);

				if (folder && tags.length > 0) {
					this.plugin.settings.folderAliases[folder] = tags;
					await this.plugin.saveSettings();
					folderInput.value = '';
					tagInput.value = '';
					renderAliases();
				}
			});
		};

		renderAliases();

		// -------------------------------------------------------------------------
		// Info Section
		// -------------------------------------------------------------------------

		containerEl.createEl('h2', { text: 'Quick Start' });

		const infoDiv = containerEl.createDiv({ cls: 'bbab-tf-info' });
		infoDiv.createEl('p', {
			text: 'TagForge automatically converts folder names to tags:',
		});

		const exampleDiv = infoDiv.createDiv({ cls: 'bbab-tf-example' });
		exampleDiv.createEl('code', {
			text: 'Health/Therapy/Notes/session.md',
		});
		exampleDiv.createEl('span', { text: ' → ' });
		exampleDiv.createEl('code', {
			text: '#health #therapy #notes',
		});

		infoDiv.createEl('p', {
			text: 'Use the command palette (Ctrl+P) and search for "TagForge" to manually tag files.',
		});
	}
}
