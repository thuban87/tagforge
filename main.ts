import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, Modal, TFolder } from 'obsidian';

// ============================================================================
// Settings Interface
// ============================================================================

interface TagForgeSettings {
	// Core settings
	inheritDepth: number;
	tagFormat: 'frontmatter' | 'inline';
	showMoveConfirmation: boolean;
	rememberedMoveAction: 'continue' | 'leave' | null;

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

// ============================================================================
// Operation History (Phase 8 - Undo/History)
// ============================================================================

interface OperationFileState {
	path: string;
	tagsBefore: string[];
	tagsAfter: string[];
}

interface TagOperation {
	id: string;
	type: 'apply' | 'remove' | 'bulk' | 'move' | 'revert';
	description: string;
	timestamp: string;
	files: OperationFileState[];
}

const MAX_HISTORY_SIZE = 50;

interface TagForgeData {
	settings: TagForgeSettings;
	tagTracking: Record<string, TagTrackingEntry>;
	operationHistory: TagOperation[];
}

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_SETTINGS: TagForgeSettings = {
	inheritDepth: 3,
	tagFormat: 'frontmatter',
	showMoveConfirmation: true,
	rememberedMoveAction: null,
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
	operationHistory: [],
};

// ============================================================================
// Main Plugin Class
// ============================================================================

export default class TagForgePlugin extends Plugin {
	settings: TagForgeSettings;
	tagTracking: Record<string, TagTrackingEntry>;
	operationHistory: TagOperation[];
	pendingUndoPath: string | null = null; // Track when we're undoing a move to prevent modal loop

	async onload() {
		console.log('TagForge: Loading plugin');

		// Load settings and tag tracking data
		await this.loadSettings();

		// Add settings tab
		this.addSettingTab(new TagForgeSettingTab(this.app, this));

		// Add command to manually trigger tagging
		this.addCommand({
			id: 'tag-current-file',
			name: 'TAG: Manually tag current file',
			callback: () => this.tagCurrentFile(),
		});

		// Remove auto-applied tags
		this.addCommand({
			id: 'revert-all-auto-tags',
			name: 'REMOVE: Remove all auto-applied tags',
			callback: () => this.revertAllAutoTags(),
		});

		// Nuclear remove - clear ALL tags
		this.addCommand({
			id: 'revert-all-tags-nuclear',
			name: 'REMOVE: Remove ALL tags from vault (nuclear option)',
			callback: () => this.revertAllTagsNuclear(),
		});

		// Date-filtered remove
		this.addCommand({
			id: 'revert-auto-tags-by-date',
			name: 'REMOVE: Remove auto-tags by date',
			callback: () => this.revertAutoTagsByDate(),
		});

		// Folder-specific remove
		this.addCommand({
			id: 'revert-auto-tags-by-folder',
			name: 'REMOVE: Remove auto-tags from specific folder',
			callback: () => this.revertAutoTagsByFolder(),
		});

		// Phase 3: Bulk operations
		this.addCommand({
			id: 'bulk-apply-tags',
			name: 'BULK ADD: Apply tags to entire vault (with preview)',
			callback: () => this.bulkApplyTags(),
		});

		this.addCommand({
			id: 'bulk-apply-folder',
			name: 'BULK ADD: Apply tags to specific folder (with preview)',
			callback: () => this.bulkApplyToFolder(),
		});

		// Phase 8: Undo/History
		this.addCommand({
			id: 'undo-operation',
			name: 'UNDO: Undo a recent tag operation',
			callback: () => this.showUndoHistory(),
		});

		// Phase 8: Tag Report Dashboard
		this.addCommand({
			id: 'tag-report',
			name: 'REPORT: View tag report dashboard',
			callback: () => this.showTagReport(),
		});

		// Phase 8: Validation
		this.addCommand({
			id: 'validate-tags',
			name: 'VALIDATE: Check for tag issues',
			callback: () => this.validateTags(),
		});

		// Phase 9: Ribbon icons for mobile menu
		this.addRibbonIcon('history', 'TagForge: Undo', () => {
			this.showUndoHistory();
		});

		this.addRibbonIcon('tags', 'TagForge: Bulk Add to folder', () => {
			this.bulkApplyToFolder();
		});

		// Phase 2: Watch for new files (only after vault is fully loaded)
		// Phase 6: Watch for file moves (renames that change parent folder)
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on('create', (file) => {
					if (file instanceof TFile) {
						// Small delay to ensure file is ready
						setTimeout(() => this.handleFileCreate(file), 100);
					}
				})
			);

			// Phase 6: Handle file moves
			this.registerEvent(
				this.app.vault.on('rename', (file, oldPath) => {
					if (file instanceof TFile) {
						// Small delay to ensure file is ready
						setTimeout(() => this.handleFileRename(file, oldPath), 100);
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
		this.operationHistory = loadedData.operationHistory || [];
	}

	async saveSettings() {
		const data: TagForgeData = {
			settings: this.settings,
			tagTracking: this.tagTracking,
			operationHistory: this.operationHistory,
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

		// Capture state before
		const tagsBefore = await this.getFileTags(activeFile);

		// Apply tags to the file
		await this.applyTagsToFile(activeFile.path, tags);

		// Capture state after
		const tagsAfter = await this.getFileTags(activeFile);

		// Record the operation
		await this.recordOperation('apply', `Tagged ${activeFile.name}`, [{
			path: activeFile.path,
			tagsBefore,
			tagsAfter,
		}]);

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

		// Capture state before (new files have no tags)
		const tagsBefore: string[] = [];

		// Apply tags to the file
		await this.applyTagsToFile(file.path, tags);

		// Capture state after
		const tagsAfter = await this.getFileTags(file);

		// Record the operation
		await this.recordOperation('apply', `Auto-tagged ${file.name}`, [{
			path: file.path,
			tagsBefore,
			tagsAfter,
		}]);

		console.log(`TagForge: Auto-tagged ${file.name} with ${tags.map(t => '#' + t).join(', ')}`);
	}

	// -------------------------------------------------------------------------
	// Phase 6: File Move Handling
	// -------------------------------------------------------------------------

	async handleFileRename(file: TFile, oldPath: string) {
		// Only process markdown files
		if (file.extension !== 'md') {
			return;
		}

		// Check if this is an undo move (Cancel was clicked) - skip to prevent loop
		if (this.pendingUndoPath && file.path === this.pendingUndoPath) {
			console.log('TagForge: Skipping undo move event');
			this.pendingUndoPath = null;
			return;
		}

		// Check if this is a move (folder changed) vs just a rename
		const oldFolder = this.getParentFolder(oldPath);
		const newFolder = this.getParentFolder(file.path);

		if (oldFolder === newFolder) {
			// Just a rename, not a move - update tracking and history
			let needsSave = false;
			const oldFileName = oldPath.split('/').pop() || oldPath;
			const newFileName = file.name;

			// Update tagTracking key
			if (this.tagTracking[oldPath]) {
				this.tagTracking[file.path] = this.tagTracking[oldPath];
				delete this.tagTracking[oldPath];
				needsSave = true;
			}

			// Update operationHistory entries (both paths and descriptions)
			for (const op of this.operationHistory) {
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
				await this.saveSettings();
				console.log(`TagForge: Updated tracking for renamed file: ${oldPath} -> ${file.path}`);
			}
			return;
		}

		// Check if new path is in ignored folders
		for (const ignorePath of this.settings.ignorePaths) {
			if (file.path.startsWith(ignorePath + '/') || file.path.startsWith(ignorePath + '\\')) {
				console.log(`TagForge: Moved file is in ignored path, skipping`);
				return;
			}
		}

		console.log(`TagForge: File moved from "${oldFolder}" to "${newFolder}"`);

		// Decide what to do based on settings
		if (!this.settings.showMoveConfirmation) {
			// Setting is off - silently retag
			await this.applyMoveRetag(file, oldPath);
			return;
		}

		if (this.settings.rememberedMoveAction) {
			// User has a remembered choice
			if (this.settings.rememberedMoveAction === 'continue') {
				await this.applyMoveRetag(file, oldPath);
			} else if (this.settings.rememberedMoveAction === 'leave') {
				// Just update tracking key, don't change tags
				if (this.tagTracking[oldPath]) {
					this.tagTracking[file.path] = this.tagTracking[oldPath];
					delete this.tagTracking[oldPath];
					await this.saveSettings();
				}
			}
			return;
		}

		// Show confirmation modal
		new MoveConfirmationModal(
			this.app,
			file.name,
			oldFolder,
			newFolder,
			async (result) => {
				await this.handleMoveResult(file, oldPath, result);
			}
		).open();
	}

	async handleMoveResult(file: TFile, oldPath: string, result: MoveConfirmationResult) {
		// Save remembered choice if applicable
		if (result.remember && (result.action === 'continue' || result.action === 'leave')) {
			this.settings.rememberedMoveAction = result.action;
			await this.saveSettings();
			new Notice(`TagForge: Will remember "${result.action === 'continue' ? 'Continue' : 'Leave Tags'}" for future moves`);
		}

		switch (result.action) {
			case 'continue':
				await this.applyMoveRetag(file, oldPath);
				break;

			case 'leave':
				// Just update tracking key, don't change tags
				if (this.tagTracking[oldPath]) {
					this.tagTracking[file.path] = this.tagTracking[oldPath];
					delete this.tagTracking[oldPath];
					await this.saveSettings();
				}
				new Notice('Tags left unchanged');
				break;

			case 'cancel':
				// Move file back to original location
				try {
					// Set flag to prevent this undo from triggering another modal
					this.pendingUndoPath = oldPath;
					await this.app.vault.rename(file, oldPath);
					new Notice('Move cancelled - file restored to original location');
				} catch (e) {
					this.pendingUndoPath = null;
					console.error('TagForge: Failed to restore file', e);
					new Notice('Failed to restore file to original location');
				}
				break;
		}
	}

	async applyMoveRetag(file: TFile, oldPath: string) {
		// Capture state before
		const tagsBefore = await this.getFileTags(file);

		// Step 1: Remove old auto-tags (if any were tracked)
		const oldTracking = this.tagTracking[oldPath];
		if (oldTracking && oldTracking.autoTags.length > 0) {
			await this.removeAutoTagsFromFile(file, oldTracking.autoTags);
			delete this.tagTracking[oldPath];
		}

		// Step 2: Apply new tags based on new location
		const newTags = this.getTagsForPath(file.path);
		if (newTags.length > 0) {
			await this.applyTagsToFile(file.path, newTags);
			console.log(`TagForge: Retagged ${file.name} with ${newTags.map(t => '#' + t).join(', ')}`);
			new Notice(`Retagged with: ${newTags.map(t => '#' + t).join(', ')}`);
		} else {
			await this.saveSettings();
			new Notice('Auto-tags removed (new location has no tags)');
		}

		// Capture state after and record operation
		const tagsAfter = await this.getFileTags(file);
		await this.recordOperation('move', `Retagged ${file.name} after move`, [{
			path: file.path,
			tagsBefore,
			tagsAfter,
		}]);
	}

	async removeAutoTagsFromFile(file: TFile, tagsToRemove: string[]) {
		// Filter out protected tags - never remove those
		const safeToRemove = tagsToRemove.filter(t => !this.settings.protectedTags.includes(t));

		if (safeToRemove.length === 0) {
			return;
		}

		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
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

	getParentFolder(filePath: string): string {
		const parts = filePath.split(/[/\\]/);
		parts.pop(); // Remove filename
		return parts.join('/') || '';
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
		const operationFiles: OperationFileState[] = [];

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
				// Capture state before
				const tagsBefore = await this.getFileTags(file);

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

				// Capture state after
				const tagsAfter = await this.getFileTags(file);
				operationFiles.push({ path: filePath, tagsBefore, tagsAfter });

				reverted++;
			} catch (e) {
				console.error(`TagForge: Failed to revert ${filePath}`, e);
				errors++;
			}
		}

		// Record the revert operation
		if (operationFiles.length > 0) {
			await this.recordOperation('revert', `Reverted auto-tags from ${reverted} files`, operationFiles);
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
		const operationFiles: OperationFileState[] = [];

		for (const file of files) {
			try {
				// Capture state before
				const tagsBefore = await this.getFileTags(file);

				await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
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
		}

		// Record the nuclear operation
		if (operationFiles.length > 0) {
			await this.recordOperation('revert', `Nuclear: Cleared ALL tags from ${operationFiles.length} files`, operationFiles);
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
		const operationFiles: OperationFileState[] = [];

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
				// Capture state before
				const tagsBefore = await this.getFileTags(file);

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

				// Capture state after
				const tagsAfter = await this.getFileTags(file);
				operationFiles.push({ path: filePath, tagsBefore, tagsAfter });

				// Remove from tracking
				delete this.tagTracking[filePath];
				reverted++;
			} catch (e) {
				console.error(`TagForge: Failed to revert ${filePath}`, e);
				errors++;
			}
		}

		// Record the revert operation
		if (operationFiles.length > 0) {
			await this.recordOperation('revert', `Reverted auto-tags from ${reverted} files (by date)`, operationFiles);
		}

		await this.saveSettings();
		new Notice(`Reverted ${reverted} files from ${selectedDates.length} date(s). ${errors > 0 ? `${errors} errors.` : ''}`);
	}

	async revertAutoTagsByFolder() {
		// Get all folders that have tracked files
		const foldersWithTracking = new Set<string>();
		for (const filePath of Object.keys(this.tagTracking)) {
			const folder = this.getParentFolder(filePath);
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

		new FolderPickerModal(this.app, folders, async (selectedFolder, includeSubdirs) => {
			// Find tracked files in this folder
			const filesToRevert = Object.keys(this.tagTracking).filter(filePath => {
				if (includeSubdirs) {
					return filePath.startsWith(selectedFolder + '/');
				} else {
					const fileFolder = this.getParentFolder(filePath);
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

			for (const filePath of filesToRevert) {
				const tracking = this.tagTracking[filePath];
				if (!tracking || tracking.autoTags.length === 0) continue;

				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (!file || !(file instanceof TFile)) {
					errors++;
					continue;
				}

				try {
					const tagsBefore = await this.getFileTags(file);

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

					const tagsAfter = await this.getFileTags(file);
					operationFiles.push({ path: filePath, tagsBefore, tagsAfter });

					delete this.tagTracking[filePath];
					reverted++;
				} catch (e) {
					console.error(`TagForge: Failed to revert ${filePath}`, e);
					errors++;
				}
			}

			if (operationFiles.length > 0) {
				await this.recordOperation('revert', `Reverted auto-tags from ${reverted} files in ${selectedFolder}`, operationFiles);
			}

			await this.saveSettings();
			new Notice(`Reverted ${reverted} files in ${selectedFolder}. ${errors > 0 ? `${errors} errors.` : ''}`);
		}).open();
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
			// Check if folder is in ignored paths
			const isIgnored = this.settings.ignorePaths.some(ignorePath =>
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
		const operationFiles: OperationFileState[] = [];

		for (const item of results) {
			try {
				// Capture state before
				const tagsBefore = await this.getFileTags(item.file);

				await this.applyTagsToFile(item.file.path, item.tags);

				// Capture state after
				const tagsAfter = await this.getFileTags(item.file);

				operationFiles.push({
					path: item.file.path,
					tagsBefore,
					tagsAfter,
				});

				applied++;
			} catch (e) {
				console.error(`TagForge: Failed to tag ${item.file.path}`, e);
				errors++;
			}
		}

		// Record the bulk operation
		if (operationFiles.length > 0) {
			await this.recordOperation('bulk', `Bulk applied tags to ${applied} files`, operationFiles);
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

	// -------------------------------------------------------------------------
	// Phase 8: Operation History & Undo
	// -------------------------------------------------------------------------

	generateOperationId(): string {
		return Date.now().toString(36) + Math.random().toString(36).substr(2);
	}

	async getFileTags(file: TFile): Promise<string[]> {
		const cache = this.app.metadataCache.getFileCache(file);
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
		this.operationHistory.unshift(operation);

		// Trim to max size
		if (this.operationHistory.length > MAX_HISTORY_SIZE) {
			this.operationHistory = this.operationHistory.slice(0, MAX_HISTORY_SIZE);
		}

		await this.saveSettings();
	}

	showUndoHistory() {
		if (this.operationHistory.length === 0) {
			new Notice('No operations to undo');
			return;
		}

		new UndoHistoryModal(this.app, this.operationHistory, async (operation) => {
			await this.undoOperation(operation);
		}).open();
	}

	async undoOperation(operation: TagOperation) {
		let undone = 0;
		let errors = 0;

		for (const fileState of operation.files) {
			const file = this.app.vault.getAbstractFileByPath(fileState.path);
			if (!file || !(file instanceof TFile)) {
				errors++;
				continue;
			}

			try {
				await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
					// Restore to the state before the operation
					if (fileState.tagsBefore.length > 0) {
						frontmatter.tags = [...fileState.tagsBefore];
					} else {
						delete frontmatter.tags;
					}
				});

				// Update tracking if we're reverting to having no auto-tags
				const trackedAutoTags = this.tagTracking[fileState.path]?.autoTags || [];
				const restoredHasAutoTags = trackedAutoTags.some(t => fileState.tagsBefore.includes(t));
				if (!restoredHasAutoTags) {
					delete this.tagTracking[fileState.path];
				}

				undone++;
			} catch (e) {
				console.error(`TagForge: Failed to undo for ${fileState.path}`, e);
				errors++;
			}
		}

		// Remove the operation from history
		this.operationHistory = this.operationHistory.filter(op => op.id !== operation.id);
		await this.saveSettings();

		new Notice(`Undone "${operation.description}": ${undone} files restored. ${errors > 0 ? `${errors} errors.` : ''}`);
	}

	// -------------------------------------------------------------------------
	// Phase 8: Tag Report Dashboard
	// -------------------------------------------------------------------------

	showTagReport() {
		new TagReportModal(this.app, this).open();
	}

	// -------------------------------------------------------------------------
	// Phase 8: Validation
	// -------------------------------------------------------------------------

	async validateTags() {
		const issues: ValidationIssue[] = [];

		// First, identify files in ignored paths (these take priority)
		const ignoredPathFiles = new Set<string>();
		for (const filePath of Object.keys(this.tagTracking)) {
			for (const ignorePath of this.settings.ignorePaths) {
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
		for (const filePath of Object.keys(this.tagTracking)) {
			if (ignoredPathFiles.has(filePath)) continue; // Skip if already flagged

			const file = this.app.vault.getAbstractFileByPath(filePath);
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
		for (const [filePath, tracking] of Object.entries(this.tagTracking)) {
			if (ignoredPathFiles.has(filePath)) continue; // Skip if in ignored path

			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!file || !(file instanceof TFile)) continue;

			const currentTags = await this.getFileTags(file);
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

		new ValidationResultsModal(this.app, issues, this).open();
	}

	async fixValidationIssue(issue: ValidationIssue) {
		switch (issue.type) {
			case 'orphaned-tracking':
				delete this.tagTracking[issue.filePath];
				await this.saveSettings();
				new Notice(`Removed tracking for: ${issue.filePath}`);
				break;

			case 'ignored-path-tracked':
				delete this.tagTracking[issue.filePath];
				await this.saveSettings();
				new Notice(`Removed tracking for: ${issue.filePath}`);
				break;

			case 'missing-tags':
				// Re-apply the missing tags
				if (issue.tags) {
					const file = this.app.vault.getAbstractFileByPath(issue.filePath);
					if (file && file instanceof TFile) {
						await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
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

// ============================================================================
// Validation Issue Interface (Phase 8)
// ============================================================================

interface ValidationIssue {
	type: 'orphaned-tracking' | 'missing-tags' | 'ignored-path-tracked';
	filePath: string;
	description: string;
	tags?: string[];
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
// Move Confirmation Modal (Phase 6)
// ============================================================================

interface MoveConfirmationResult {
	action: 'continue' | 'leave' | 'cancel';
	remember: boolean;
}

class MoveConfirmationModal extends Modal {
	fileName: string;
	oldFolder: string;
	newFolder: string;
	onResult: (result: MoveConfirmationResult) => void;
	rememberChoice: boolean = false;

	constructor(
		app: App,
		fileName: string,
		oldFolder: string,
		newFolder: string,
		onResult: (result: MoveConfirmationResult) => void
	) {
		super(app);
		this.fileName = fileName;
		this.oldFolder = oldFolder || '(vault root)';
		this.newFolder = newFolder || '(vault root)';
		this.onResult = onResult;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('bbab-tf-move-modal');

		contentEl.createEl('h2', { text: 'File Moved' });

		// File info
		const infoEl = contentEl.createDiv({ cls: 'bbab-tf-move-info' });
		infoEl.createEl('p', { text: `"${this.fileName}" was moved.` });

		const pathInfo = infoEl.createDiv({ cls: 'bbab-tf-move-paths' });
		pathInfo.createEl('div', { text: `From: ${this.oldFolder}`, cls: 'bbab-tf-move-path' });
		pathInfo.createEl('div', { text: `To: ${this.newFolder}`, cls: 'bbab-tf-move-path' });

		// Explanation with button descriptions
		const descEl = contentEl.createDiv({ cls: 'bbab-tf-move-description' });
		descEl.createEl('p', { text: 'Choose how to handle tags:' });
		const optionsList = descEl.createEl('ul', { cls: 'bbab-tf-move-options' });
		optionsList.createEl('li', { text: 'Continue — Remove old folder tags, apply new folder tags' });
		optionsList.createEl('li', { text: 'Leave Tags — Keep current tags, don\'t add new ones' });
		optionsList.createEl('li', { text: 'Cancel — Move file back to original folder' });

		// Remember choice checkbox
		const rememberLabel = contentEl.createEl('label', { cls: 'bbab-tf-remember-choice' });
		const rememberCb = rememberLabel.createEl('input', { type: 'checkbox' });
		rememberLabel.createSpan({ text: ' Remember my choice' });
		rememberCb.addEventListener('change', () => {
			this.rememberChoice = rememberCb.checked;
		});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-move-buttons' });

		const continueBtn = buttonContainer.createEl('button', {
			text: 'Continue',
			cls: 'mod-cta',
		});
		continueBtn.addEventListener('click', () => {
			this.close();
			this.onResult({ action: 'continue', remember: this.rememberChoice });
		});

		const leaveBtn = buttonContainer.createEl('button', {
			text: 'Leave Tags',
		});
		leaveBtn.addEventListener('click', () => {
			this.close();
			this.onResult({ action: 'leave', remember: this.rememberChoice });
		});

		const cancelBtn = buttonContainer.createEl('button', {
			text: 'Cancel',
			cls: 'mod-warning',
		});
		cancelBtn.addEventListener('click', () => {
			this.close();
			// Cancel doesn't respect "remember" - you wouldn't want to auto-cancel moves
			this.onResult({ action: 'cancel', remember: false });
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

		// Determine current move behavior for dropdown
		let currentMoveBehavior: string;
		if (!this.plugin.settings.showMoveConfirmation) {
			currentMoveBehavior = 'always-retag';
		} else if (this.plugin.settings.rememberedMoveAction === 'continue') {
			currentMoveBehavior = 'always-retag';
		} else if (this.plugin.settings.rememberedMoveAction === 'leave') {
			currentMoveBehavior = 'always-keep';
		} else {
			currentMoveBehavior = 'ask';
		}

		new Setting(containerEl)
			.setName('When files are moved')
			.setDesc('Choose how to handle tags when files move between folders')
			.addDropdown(dropdown => dropdown
				.addOption('ask', 'Ask every time')
				.addOption('always-retag', 'Always retag (remove old, add new)')
				.addOption('always-keep', 'Always keep current tags')
				.setValue(currentMoveBehavior)
				.onChange(async (value) => {
					if (value === 'ask') {
						this.plugin.settings.showMoveConfirmation = true;
						this.plugin.settings.rememberedMoveAction = null;
					} else if (value === 'always-retag') {
						this.plugin.settings.showMoveConfirmation = false;
						this.plugin.settings.rememberedMoveAction = null;
					} else if (value === 'always-keep') {
						this.plugin.settings.showMoveConfirmation = true;
						this.plugin.settings.rememberedMoveAction = 'leave';
					}
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

// ============================================================================
// Undo History Modal (Phase 8)
// ============================================================================

const UNDO_FILE_DISPLAY_LIMIT = 40;

class UndoHistoryModal extends Modal {
	operations: TagOperation[];
	onUndo: (operation: TagOperation) => void;

	constructor(
		app: App,
		operations: TagOperation[],
		onUndo: (operation: TagOperation) => void
	) {
		super(app);
		this.operations = operations;
		this.onUndo = onUndo;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('bbab-tf-undo-history-modal');

		contentEl.createEl('h2', { text: 'Undo History' });
		contentEl.createEl('p', {
			text: `${this.operations.length} operation(s) available to undo`,
			cls: 'bbab-tf-description',
		});

		const listEl = contentEl.createDiv({ cls: 'bbab-tf-undo-list' });

		for (const op of this.operations) {
			const itemEl = listEl.createDiv({ cls: 'bbab-tf-undo-item' });

			// Header row with expand toggle
			const headerEl = itemEl.createDiv({ cls: 'bbab-tf-undo-header' });

			const infoEl = headerEl.createDiv({ cls: 'bbab-tf-undo-info' });

			// Expand toggle
			const expandBtn = infoEl.createEl('button', {
				text: '▶',
				cls: 'bbab-tf-undo-expand-toggle',
			});

			// Operation type badge
			const typeBadge = infoEl.createSpan({ cls: `bbab-tf-undo-type bbab-tf-type-${op.type}` });
			typeBadge.textContent = op.type.toUpperCase();

			// Description
			infoEl.createSpan({ text: op.description, cls: 'bbab-tf-undo-description' });

			// Undo button in header
			const undoBtn = headerEl.createEl('button', {
				text: 'Undo',
				cls: 'bbab-tf-undo-btn',
			});
			undoBtn.addEventListener('click', () => {
				this.close();
				this.onUndo(op);
			});

			// Details row
			const detailsEl = itemEl.createDiv({ cls: 'bbab-tf-undo-details' });
			const date = new Date(op.timestamp);
			detailsEl.createSpan({
				text: `${date.toLocaleDateString()} ${date.toLocaleTimeString()} • ${op.files.length} file(s)`,
				cls: 'bbab-tf-undo-meta',
			});

			// Expandable file list (hidden by default)
			const filesEl = itemEl.createDiv({ cls: 'bbab-tf-undo-files hidden' });

			// Get unique folders for bulk operations, or file names for single ops
			if (op.files.length > 10) {
				// For large operations, group by folder
				const folders = new Map<string, number>();
				for (const f of op.files) {
					const folder = f.path.split('/').slice(0, -1).join('/') || '(root)';
					folders.set(folder, (folders.get(folder) || 0) + 1);
				}
				const sortedFolders = Array.from(folders.entries()).sort((a, b) => b[1] - a[1]);
				const displayFolders = sortedFolders.slice(0, UNDO_FILE_DISPLAY_LIMIT);

				for (const [folder, count] of displayFolders) {
					filesEl.createDiv({
						text: `${folder}/ (${count} file${count > 1 ? 's' : ''})`,
						cls: 'bbab-tf-undo-file',
					});
				}

				if (sortedFolders.length > UNDO_FILE_DISPLAY_LIMIT) {
					filesEl.createDiv({
						text: `... and ${sortedFolders.length - UNDO_FILE_DISPLAY_LIMIT} more folders`,
						cls: 'bbab-tf-undo-file bbab-tf-undo-more',
					});
				}
			} else {
				// For small operations, show individual files
				for (const f of op.files.slice(0, UNDO_FILE_DISPLAY_LIMIT)) {
					const fileName = f.path.split('/').pop() || f.path;
					filesEl.createDiv({
						text: fileName,
						cls: 'bbab-tf-undo-file',
					});
				}

				if (op.files.length > UNDO_FILE_DISPLAY_LIMIT) {
					filesEl.createDiv({
						text: `... and ${op.files.length - UNDO_FILE_DISPLAY_LIMIT} more files`,
						cls: 'bbab-tf-undo-file bbab-tf-undo-more',
					});
				}
			}

			// Toggle expand
			expandBtn.addEventListener('click', () => {
				filesEl.classList.toggle('hidden');
				expandBtn.textContent = filesEl.classList.contains('hidden') ? '▶' : '▼';
			});
		}

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
// Tag Report Modal (Phase 8)
// ============================================================================

class TagReportModal extends Modal {
	plugin: TagForgePlugin;

	constructor(app: App, plugin: TagForgePlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
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

// ============================================================================
// Validation Results Modal (Phase 8)
// ============================================================================

class ValidationResultsModal extends Modal {
	issues: ValidationIssue[];
	plugin: TagForgePlugin;

	constructor(app: App, issues: ValidationIssue[], plugin: TagForgePlugin) {
		super(app);
		this.issues = issues;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('bbab-tf-validation-modal');

		contentEl.createEl('h2', { text: 'Validation Results' });
		contentEl.createEl('p', {
			text: `Found ${this.issues.length} issue(s)`,
			cls: 'bbab-tf-description',
		});

		const listEl = contentEl.createDiv({ cls: 'bbab-tf-validation-list' });

		for (const issue of this.issues) {
			const itemEl = listEl.createDiv({ cls: 'bbab-tf-validation-item' });

			// Issue type badge
			const typeBadge = itemEl.createSpan({ cls: `bbab-tf-issue-type bbab-tf-issue-${issue.type}` });
			typeBadge.textContent = this.getIssueTypeLabel(issue.type);

			// File path
			itemEl.createSpan({ text: issue.filePath, cls: 'bbab-tf-validation-path' });

			// Description
			itemEl.createDiv({ text: issue.description, cls: 'bbab-tf-validation-desc' });

			// Fix button
			const fixBtn = itemEl.createEl('button', {
				text: this.getFixButtonLabel(issue.type),
				cls: 'bbab-tf-fix-btn',
			});
			fixBtn.addEventListener('click', async () => {
				await this.plugin.fixValidationIssue(issue);
				// Remove this issue from the list
				this.issues = this.issues.filter(i => i !== issue);
				if (this.issues.length === 0) {
					this.close();
					new Notice('All issues fixed!');
				} else {
					this.onOpen(); // Re-render
				}
			});
		}

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-button-container' });

		const fixAllBtn = buttonContainer.createEl('button', {
			text: 'Fix All',
			cls: 'mod-warning',
		});
		fixAllBtn.addEventListener('click', async () => {
			for (const issue of this.issues) {
				await this.plugin.fixValidationIssue(issue);
			}
			this.close();
			new Notice('All issues fixed!');
		});

		const closeBtn = buttonContainer.createEl('button', { text: 'Close' });
		closeBtn.addEventListener('click', () => {
			this.close();
		});
	}

	getIssueTypeLabel(type: ValidationIssue['type']): string {
		switch (type) {
			case 'orphaned-tracking': return 'Orphaned';
			case 'missing-tags': return 'Missing';
			case 'ignored-path-tracked': return 'Ignored';
			default: return 'Unknown';
		}
	}

	getFixButtonLabel(type: ValidationIssue['type']): string {
		switch (type) {
			case 'orphaned-tracking': return 'Remove tracking';
			case 'missing-tags': return 'Re-apply tags';
			case 'ignored-path-tracked': return 'Remove tracking';
			default: return 'Fix';
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
