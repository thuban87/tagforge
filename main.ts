import { App, Plugin, PluginSettingTab, Setting, Notice, TFile } from 'obsidian';

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
	folderAliases: Record<string, string>;

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
				if (this.settings.folderAliases[folderPath]) {
					tags.push(this.settings.folderAliases[folderPath]);
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
			.addSlider(slider => slider
				.setLimits(1, 10, 1)
				.setValue(this.plugin.settings.inheritDepth)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.inheritDepth = value;
					await this.plugin.saveSettings();
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
