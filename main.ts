import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, Modal, TFolder } from 'obsidian';

// Windows system files that are safe to delete when cleaning up empty folders
const WINDOWS_SYSTEM_FILES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

// Node.js modules (loaded at runtime in Electron)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodePath = require('path') as typeof import('path');

// ============================================================================
// Settings Interface
// ============================================================================

interface TagForgeSettings {
	// Core settings
	autoTagEnabled: boolean;
	inheritDepth: number;
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
// Folder Rules System (Phase 10 - Explicit Rules)
// ============================================================================

interface FolderRule {
	tags: string[];                      // Custom/additional tags to apply
	folderTagLevels: number[];           // Which folder levels to derive tags from (1=first level, 2=second, etc.)
	applyDownLevels: 'all' | number[];   // 'all' or specific levels [1, 2, 4]
	inheritFromAncestors: boolean;       // Also receive tags from parent rules?
	applyToNewFiles: boolean;            // Trigger on file creation?
	createdAt: string;                   // ISO timestamp
	lastModified: string;                // ISO timestamp
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
	folderRules: Record<string, FolderRule>;  // Phase 10: Explicit folder rules
}

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_SETTINGS: TagForgeSettings = {
	autoTagEnabled: true,
	inheritDepth: 3,
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
	folderRules: {},  // Phase 10: No rules by default - fully explicit
};

// ============================================================================
// Main Plugin Class
// ============================================================================

export default class TagForgePlugin extends Plugin {
	settings: TagForgeSettings;
	tagTracking: Record<string, TagTrackingEntry>;
	operationHistory: TagOperation[];
	folderRules: Record<string, FolderRule>;  // Phase 10: Explicit folder rules
	pendingUndoPath: string | null = null; // Track when we're undoing a move to prevent modal loop
	pendingUndoPaths: Set<string> = new Set(); // Track multiple undo paths for batch cancel
	pendingTimeouts: number[] = []; // Track pending timeouts for cleanup
	pendingFileOps: Map<string, number> = new Map(); // Track pending operations per file for debouncing
	pendingMoves: Map<string, PendingMoveOperation> = new Map(); // Batch move operations
	pendingMoveTimeout: number | null = null; // Debounce timer for grouped move modal

	async onload() {
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
						// Cancel any pending operation for this file (debouncing)
						const existingTimeout = this.pendingFileOps.get(file.path);
						if (existingTimeout) {
							window.clearTimeout(existingTimeout);
							this.pendingTimeouts = this.pendingTimeouts.filter(id => id !== existingTimeout);
						}

						// Wait 100ms to ensure Obsidian's metadata cache has registered
						// the file before we modify its frontmatter (race condition mitigation)
						const timeoutId = window.setTimeout(() => {
							this.pendingTimeouts = this.pendingTimeouts.filter(id => id !== timeoutId);
							this.pendingFileOps.delete(file.path);
							this.handleFileCreate(file);
						}, 100);
						this.pendingTimeouts.push(timeoutId);
						this.pendingFileOps.set(file.path, timeoutId);
					}
				})
			);

			// Phase 6: Handle file moves
			this.registerEvent(
				this.app.vault.on('rename', (file, oldPath) => {
					if (file instanceof TFile) {
						// Cancel any pending operation for this file (debouncing)
						const existingTimeout = this.pendingFileOps.get(file.path);
						if (existingTimeout) {
							window.clearTimeout(existingTimeout);
							this.pendingTimeouts = this.pendingTimeouts.filter(id => id !== existingTimeout);
						}
						// Also cancel any pending op for the old path
						const oldPathTimeout = this.pendingFileOps.get(oldPath);
						if (oldPathTimeout) {
							window.clearTimeout(oldPathTimeout);
							this.pendingTimeouts = this.pendingTimeouts.filter(id => id !== oldPathTimeout);
							this.pendingFileOps.delete(oldPath);
						}

						// Wait 100ms to ensure Obsidian's metadata cache has registered
						// the rename before we modify its frontmatter (race condition mitigation)
						const timeoutId = window.setTimeout(() => {
							this.pendingTimeouts = this.pendingTimeouts.filter(id => id !== timeoutId);
							this.pendingFileOps.delete(file.path);
							this.handleFileRename(file, oldPath);
						}, 100);
						this.pendingTimeouts.push(timeoutId);
						this.pendingFileOps.set(file.path, timeoutId);
					}
				})
			);
		});
	}

	onunload() {
		// Clear any pending timeouts
		for (const timeoutId of this.pendingTimeouts) {
			window.clearTimeout(timeoutId);
		}
		this.pendingTimeouts = [];
		this.pendingFileOps.clear();
		// Clear pending move batch timeout
		if (this.pendingMoveTimeout) {
			window.clearTimeout(this.pendingMoveTimeout);
			this.pendingMoveTimeout = null;
		}
		this.pendingMoves.clear();
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
		this.folderRules = loadedData.folderRules || {};  // Phase 10
	}

	async saveSettings() {
		const data: TagForgeData = {
			settings: this.settings,
			tagTracking: this.tagTracking,
			operationHistory: this.operationHistory,
			folderRules: this.folderRules,  // Phase 10
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
		// Check if auto-tagging is enabled
		if (!this.settings.autoTagEnabled) {
			return;
		}

		// Only process markdown files
		if (file.extension !== 'md') {
			return;
		}

		// Phase 10: Use explicit folder rules instead of implicit algorithm
		// Tags are only applied if explicit rules exist for the file's location
		const tags = this.getRulesForPath(file.path);
		if (tags.length === 0) {
			// No rules apply to this file - do nothing (fully explicit system)
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
			this.pendingUndoPath = null;
			return;
		}

		// Check if this is a batch undo move
		if (this.pendingUndoPaths.has(file.path)) {
			this.pendingUndoPaths.delete(file.path);
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
			}
			return;
		}

		// Check if new path is in ignored folders
		for (const ignorePath of this.settings.ignorePaths) {
			if (file.path.startsWith(ignorePath + '/') || file.path.startsWith(ignorePath + '\\')) {
				return;
			}
		}

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
				this.app,
				move.file.name,
				move.oldFolder,
				move.newFolder,
				async (result) => {
					await this.handleMoveResult(move.file, move.oldPath, result);
				}
			).open();
		} else {
			// Multiple files - use grouped modal
			new GroupedMoveConfirmationModal(
				this.app,
				moves,
				async (result) => {
					await this.handleGroupedMoveResult(moves, result);
				}
			).open();
		}
	}

	async handleGroupedMoveResult(moves: PendingMoveOperation[], result: GroupedMoveResult) {
		// Save remembered choice if applicable
		if (result.remember && (result.action === 'continue' || result.action === 'leave')) {
			this.settings.rememberedMoveAction = result.action;
			await this.saveSettings();
			new Notice(`TagForge: Will remember "${result.action === 'continue' ? 'Continue' : 'Leave Tags'}" for future moves`);
		}

		// Filter out excluded files
		const filesToProcess = moves.filter(m => !result.excludedPaths.has(m.file.path));
		const excludedFiles = moves.filter(m => result.excludedPaths.has(m.file.path));

		// Handle excluded files - just update tracking keys (leave tags alone)
		for (const move of excludedFiles) {
			if (this.tagTracking[move.oldPath]) {
				this.tagTracking[move.file.path] = this.tagTracking[move.oldPath];
				delete this.tagTracking[move.oldPath];
			}
		}

		if (filesToProcess.length === 0) {
			await this.saveSettings();
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
					if (this.tagTracking[move.oldPath]) {
						this.tagTracking[move.file.path] = this.tagTracking[move.oldPath];
						delete this.tagTracking[move.oldPath];
					}
				}
				await this.saveSettings();
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
					const existingFolder = this.app.vault.getAbstractFileByPath(folderPath);
					if (!existingFolder) {
						try {
							await this.app.vault.createFolder(folderPath);
						} catch (e) {
							// Folder might already exist or parent needs creating
							// Try creating parent folders one by one
							const parts = folderPath.split('/');
							let currentPath = '';
							for (const part of parts) {
								currentPath = currentPath ? `${currentPath}/${part}` : part;
								const exists = this.app.vault.getAbstractFileByPath(currentPath);
								if (!exists) {
									try {
										await this.app.vault.createFolder(currentPath);
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
						const folder = this.app.vault.getAbstractFileByPath(move.newFolder);
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
						await this.app.vault.rename(move.file, move.oldPath);
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
					const vaultBasePath = (this.app.vault.adapter as any).basePath as string;

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
		// Filter out protected tags - never remove those (case-insensitive comparison)
		const protectedLower = this.settings.protectedTags.map(t => t.toLowerCase());
		const safeToRemove = tagsToRemove.filter(t => !protectedLower.includes(t.toLowerCase()));

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

	async removeTagsFromFile(file: TFile, tagsToRemove: string[]) {
		// Filter out protected tags - never remove those (case-insensitive comparison)
		const protectedLower = this.settings.protectedTags.map(t => t.toLowerCase());
		const safeToRemove = tagsToRemove.filter(t => !protectedLower.includes(t.toLowerCase()));

		if (safeToRemove.length === 0) {
			return;
		}

		// Remove from frontmatter
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

		// Update tag tracking to remove these tags from the tracked list
		const tracking = this.tagTracking[file.path];
		if (tracking && tracking.autoTags) {
			tracking.autoTags = tracking.autoTags.filter(t => !safeToRemove.includes(t));
			if (tracking.autoTags.length === 0) {
				delete this.tagTracking[file.path];
			}
			await this.saveSettings();
		}
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

		for (let i = 0; i < trackedFiles.length; i++) {
			const filePath = trackedFiles[i];
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

			// Every 50 files, yield to UI and show progress
			if (i > 0 && i % 50 === 0) {
				new Notice(`Reverting: ${i}/${trackedFiles.length}...`);
				await new Promise(resolve => setTimeout(resolve, 10));
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
	}

	async revertAllTagsNuclear() {
		const files = this.app.vault.getMarkdownFiles();
		const ruleCount = Object.keys(this.folderRules).length;

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

			// Every 50 files, yield to UI and show progress
			if (i > 0 && i % 50 === 0) {
				new Notice(`Clearing: ${i}/${files.length}...`);
				await new Promise(resolve => setTimeout(resolve, 10));
			}
		}

		// Record the nuclear operation
		if (operationFiles.length > 0) {
			await this.recordOperation('revert', `Nuclear: Cleared ALL tags from ${operationFiles.length} files`, operationFiles);
		}

		// Clear tracking data and folder rules
		this.tagTracking = {};
		this.folderRules = {};  // Phase 10: Also wipe all folder rules
		await this.saveSettings();

		new Notice(`Nuclear complete: ${cleared} files cleared, all rules deleted. ${errors > 0 ? `${errors} errors.` : ''}`);
	}

	async revertAutoTagsByDate() {
		// Get unique dates from tracking (using UTC for consistency across timezones)
		const dateMap: Record<string, string[]> = {};

		for (const [filePath, tracking] of Object.entries(this.tagTracking)) {
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

		for (let i = 0; i < filesToRevert.length; i++) {
			const filePath = filesToRevert[i];
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

			// Every 50 files, yield to UI and show progress
			if (i > 0 && i % 50 === 0) {
				new Notice(`Reverting: ${i}/${filesToRevert.length}...`);
				await new Promise(resolve => setTimeout(resolve, 10));
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

			for (let i = 0; i < filesToRevert.length; i++) {
				const filePath = filesToRevert[i];
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

				// Every 50 files, yield to UI and show progress
				if (i > 0 && i % 50 === 0) {
					new Notice(`Reverting: ${i}/${filesToRevert.length}...`);
					await new Promise(resolve => setTimeout(resolve, 10));
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

		new BulkPreviewModal(this.app, this, items, 'entire vault', null, this.settings.inheritDepth, async (results) => {
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
			new BulkPreviewModal(this.app, this, items, description, selectedFolder, this.settings.inheritDepth, async (results) => {
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

			// Get auto-tags (tags tracked by TagForge)
			const tracking = this.tagTracking[file.path];
			const autoTags = tracking?.autoTags || [];

			// Get folder tags by level
			const folderTagsByLevel = this.getFolderTagsByLevel(file.path);

			items.push({
				file,
				currentTags,
				autoTags,
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
						// Legacy: single string value
						tagsByLevel.push([String(aliasValue)]);
					}
				} else {
					const tag = this.folderNameToTag(folderName);
					// Only push valid tags (at least 2 chars and contains alphanumeric)
					if (tag.length > 1 && /[a-z0-9]/.test(tag)) {
						tagsByLevel.push([tag]);
					}
				}
			}
		}

		return tagsByLevel;
	}

	async executeBulkApply(results: Array<{ file: TFile; tagsToAdd: string[]; tagsToRemove: string[] }>) {
		let filesModified = 0;
		let tagsAdded = 0;
		let tagsRemoved = 0;
		let errors = 0;
		const operationFiles: OperationFileState[] = [];

		for (let i = 0; i < results.length; i++) {
			const item = results[i];
			try {
				// Capture state before
				const tagsBefore = await this.getFileTags(item.file);

				// Remove tags first (if any)
				if (item.tagsToRemove.length > 0) {
					await this.removeTagsFromFile(item.file, item.tagsToRemove);
					tagsRemoved += item.tagsToRemove.length;
				}

				// Add tags (if any)
				if (item.tagsToAdd.length > 0) {
					await this.applyTagsToFile(item.file.path, item.tagsToAdd);
					tagsAdded += item.tagsToAdd.length;
				}

				// Capture state after
				const tagsAfter = await this.getFileTags(item.file);

				operationFiles.push({
					path: item.file.path,
					tagsBefore,
					tagsAfter,
				});

				filesModified++;
			} catch (e) {
				console.error(`TagForge: Failed to modify ${item.file.path}`, e);
				errors++;
			}

			// Every 50 files, yield to UI and show progress
			if (i > 0 && i % 50 === 0) {
				new Notice(`Processing: ${i}/${results.length}...`);
				await new Promise(resolve => setTimeout(resolve, 10));
			}
		}

		// Record the bulk operation
		if (operationFiles.length > 0) {
			const description = tagsRemoved > 0
				? `Bulk modified ${filesModified} files (${tagsAdded} added, ${tagsRemoved} removed)`
				: `Bulk applied tags to ${filesModified} files`;
			await this.recordOperation('bulk', description, operationFiles);
		}

		// Build notice message
		const parts: string[] = [];
		if (tagsAdded > 0) parts.push(`${tagsAdded} tags added`);
		if (tagsRemoved > 0) parts.push(`${tagsRemoved} tags removed`);
		if (errors > 0) parts.push(`${errors} errors`);
		new Notice(`Modified ${filesModified} files. ${parts.join(', ')}`);
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
		if (this.settings.folderMappings[fullFolderPath]) {
			tags.push(...this.settings.folderMappings[fullFolderPath]);
		}

		return [...new Set(tags)]; // Remove duplicates
	}

	// -------------------------------------------------------------------------
	// Phase 10: Explicit Folder Rules System
	// -------------------------------------------------------------------------

	/**
	 * Get tags for a file path based on explicit folder rules.
	 * This is the new rules-based system that replaces the implicit algorithm.
	 *
	 * Rules work as follows:
	 * - Each folder can have a rule that defines tags and how far down they apply
	 * - Rules are additive: multiple rules can contribute tags to a single file
	 * - A rule's `applyDownLevels` controls how many levels below the rule folder it affects
	 * - A rule's `inheritFromAncestors` controls whether it also receives tags from parent rules
	 */
	getRulesForPath(filePath: string): string[] {
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

		if (pathParts.length === 0) {
			// File is at vault root, check for root rule
			const rootRule = this.folderRules[''] || this.folderRules['/'];
			if (rootRule && rootRule.applyToNewFiles) {
				tags.push(...rootRule.tags);
			}
			return [...new Set(tags)];
		}

		// Build the file's folder path
		const fileFolderPath = pathParts.join('/');

		// Collect all applicable rules
		// We need to check each ancestor folder for rules that might apply to this file
		for (let i = 0; i <= pathParts.length; i++) {
			const ancestorPath = i === 0 ? '' : pathParts.slice(0, i).join('/');
			const rule = this.folderRules[ancestorPath];

			if (!rule || !rule.applyToNewFiles) {
				continue;
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

		// Now handle inheritFromAncestors for the file's direct folder rule
		const directFolderRule = this.folderRules[fileFolderPath];
		if (directFolderRule && directFolderRule.inheritFromAncestors) {
			// The direct folder's rule says to inherit from ancestors
			// This is already handled by the loop above - ancestor rules that apply
			// are already included. The inheritFromAncestors flag is more about
			// explicit acknowledgment that this folder should receive parent tags.
			// The actual inheritance happens via the applyDownLevels mechanism.
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

		// Filter out protected tags (case-insensitive comparison)
		const protectedLower = this.settings.protectedTags.map(t => t.toLowerCase());
		const tagsToApply = tags.filter(t => !protectedLower.includes(t.toLowerCase()));

		await this.applyFrontmatterTags(filePath, tagsToApply);

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

		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
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
	currentTags: string[];        // All tags currently on the file
	autoTags: string[];           // Tags tracked by TagForge (subset of currentTags)
	folderTagsByLevel: string[][]; // Tags at each level: [[level1], [level2], ...]
}

class BulkPreviewModal extends Modal {
	plugin: TagForgePlugin;
	items: EnhancedPreviewItem[];
	targetDescription: string;
	targetFolder: string | null;  // null for entire vault, folder path otherwise
	onConfirm: (results: Array<{ file: TFile; tagsToAdd: string[]; tagsToRemove: string[] }>) => void;
	inheritDepth: number;

	// State
	selectedFiles: Set<string> = new Set();
	enabledLevels: Set<number> = new Set();
	skipAllFolderTags: boolean = false;
	additionalTags: string[] = [];
	additionalTagsToSelectedOnly: boolean = false;
	maxLevel: number = 0;
	expandedFolders: Set<string> = new Set(); // Track which folder groups are expanded

	// Edit mode state
	isEditMode: boolean = false;
	allowManualTagEditing: boolean = false;
	tagsToDelete: Map<string, Set<string>> = new Map(); // filePath → tags marked for deletion

	// Phase 10: Save as rule state
	saveAsRule: boolean = false;
	ruleApplyTo: 'folder' | 'subfolders' = 'subfolders';

	// UI references for updates
	listEl: HTMLElement | null = null;
	applyBtn: HTMLButtonElement | null = null;
	statsEl: HTMLElement | null = null;
	editButtonsContainer: HTMLElement | null = null;
	rightColumn: HTMLElement | null = null;

	constructor(
		app: App,
		plugin: TagForgePlugin,
		items: EnhancedPreviewItem[],
		targetDescription: string,
		targetFolder: string | null,
		inheritDepth: number,
		onConfirm: (results: Array<{ file: TFile; tagsToAdd: string[]; tagsToRemove: string[] }>) => void
	) {
		super(app);
		this.plugin = plugin;
		this.items = items;
		this.targetDescription = targetDescription;
		this.targetFolder = targetFolder;
		this.inheritDepth = inheritDepth;
		this.onConfirm = onConfirm;

		// Initialize: all files selected, levels enabled up to inheritDepth
		for (const item of items) {
			this.selectedFiles.add(item.file.path);
			const levels = item.folderTagsByLevel.length;
			if (levels > this.maxLevel) this.maxLevel = levels;
		}
		// Only enable levels up to the inheritance depth setting
		const levelsToEnable = Math.min(this.maxLevel, this.inheritDepth);
		for (let i = 1; i <= levelsToEnable; i++) {
			this.enabledLevels.add(i);
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass('bbab-tf-large-modal');
		contentEl.addClass('bbab-tf-bulk-preview-modal');

		// Header
		const header = contentEl.createDiv({ cls: 'bbab-tf-modal-header' });
		header.createEl('h2', { text: 'Preview: Bulk Tag Application' });
		header.createEl('p', {
			text: `Configuring tags for ${this.items.length} files in ${this.targetDescription}`,
			cls: 'bbab-tf-description',
		});

		// Two-column layout container
		const columnsContainer = contentEl.createDiv({ cls: 'bbab-tf-columns' });

		// LEFT COLUMN - File Tree
		const leftColumn = columnsContainer.createDiv({ cls: 'bbab-tf-column-left' });

		// Files header with stats and selection buttons
		const filesHeader = leftColumn.createDiv({ cls: 'bbab-tf-files-header' });
		this.statsEl = filesHeader.createEl('h3', { text: 'Files' });

		const selectionBtns = filesHeader.createDiv({ cls: 'bbab-tf-selection-btns' });
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

		const expandAllBtn = selectionBtns.createEl('button', { text: 'Expand All' });
		expandAllBtn.addEventListener('click', () => {
			// Get all folder paths from items
			for (const item of this.items) {
				const folderPath = this.getParentFolder(item.file.path);
				this.expandedFolders.add(folderPath);
			}
			this.renderList();
		});

		const collapseAllBtn = selectionBtns.createEl('button', { text: 'Collapse All' });
		collapseAllBtn.addEventListener('click', () => {
			this.expandedFolders.clear();
			this.renderList();
		});

		// File list (scrollable)
		this.listEl = leftColumn.createDiv({ cls: 'bbab-tf-preview' });
		this.renderList();

		// Edit mode buttons container
		this.editButtonsContainer = leftColumn.createDiv({ cls: 'bbab-tf-edit-buttons' });
		this.renderEditButtons();

		// RIGHT COLUMN - Controls
		this.rightColumn = columnsContainer.createDiv({ cls: 'bbab-tf-column-right' });

		// Folder Tags Section
		const folderSection = this.rightColumn.createDiv({ cls: 'bbab-tf-section' });
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
		const additionalSection = this.rightColumn.createDiv({ cls: 'bbab-tf-section' });
		additionalSection.createEl('h3', { text: 'Additional Tags' });

		const additionalInput = additionalSection.createEl('input', {
			type: 'text',
			placeholder: 'Tags separated by commas',
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

		// Phase 10: Save as Rule Section (only show for folder-based bulk add)
		if (this.targetFolder !== null) {
			const ruleSection = this.rightColumn.createDiv({ cls: 'bbab-tf-section bbab-tf-rule-section' });
			ruleSection.createEl('h3', { text: 'Folder Rule' });

			const ruleCheckContainer = ruleSection.createDiv({ cls: 'bbab-tf-rule-check' });
			const ruleLabel = ruleCheckContainer.createEl('label');
			const ruleCb = ruleLabel.createEl('input', { type: 'checkbox' });
			ruleCb.checked = this.saveAsRule;
			ruleLabel.createSpan({ text: ' Save as folder rule' });

			const ruleDescription = ruleSection.createEl('p', {
				text: 'When enabled, new files in this folder will automatically receive these tags.',
				cls: 'bbab-tf-rule-description setting-item-description',
			});

			const ruleOptionsContainer = ruleSection.createDiv({ cls: 'bbab-tf-rule-options' });
			ruleOptionsContainer.style.display = this.saveAsRule ? 'block' : 'none';

			const folderOnlyLabel = ruleOptionsContainer.createEl('label');
			const folderOnlyRadio = folderOnlyLabel.createEl('input', { type: 'radio', attr: { name: 'ruleApplyTo' } });
			folderOnlyRadio.checked = this.ruleApplyTo === 'folder';
			folderOnlyLabel.createSpan({ text: ' This folder only' });

			const subfoldersLabel = ruleOptionsContainer.createEl('label');
			const subfoldersRadio = subfoldersLabel.createEl('input', { type: 'radio', attr: { name: 'ruleApplyTo' } });
			subfoldersRadio.checked = this.ruleApplyTo === 'subfolders';
			subfoldersLabel.createSpan({ text: ' This folder + all subfolders' });

			ruleCb.addEventListener('change', () => {
				this.saveAsRule = ruleCb.checked;
				ruleOptionsContainer.style.display = this.saveAsRule ? 'block' : 'none';
			});

			folderOnlyRadio.addEventListener('change', () => {
				if (folderOnlyRadio.checked) this.ruleApplyTo = 'folder';
			});

			subfoldersRadio.addEventListener('change', () => {
				if (subfoldersRadio.checked) this.ruleApplyTo = 'subfolders';
			});
		}

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-button-container' });

		this.applyBtn = buttonContainer.createEl('button', {
			text: `Apply`,
			cls: 'mod-cta',
		}) as HTMLButtonElement;
		this.applyBtn.addEventListener('click', async () => {
			const results = this.computeFinalResults();
			if (results.length === 0 && !this.saveAsRule) {
				new Notice('No changes to apply');
				return;
			}

			// Phase 10: Save folder rule if requested
			if (this.saveAsRule && this.targetFolder !== null) {
				await this.saveRule();
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

		// Group items by parent folder
		const folderGroups = new Map<string, EnhancedPreviewItem[]>();
		for (const item of this.items) {
			const folderPath = this.getParentFolder(item.file.path);
			if (!folderGroups.has(folderPath)) {
				folderGroups.set(folderPath, []);
			}
			folderGroups.get(folderPath)!.push(item);
		}

		// Sort folders alphabetically
		const sortedFolders = Array.from(folderGroups.keys()).sort();

		for (const folderPath of sortedFolders) {
			const folderItems = folderGroups.get(folderPath)!;
			const isExpanded = this.expandedFolders.has(folderPath);

			// Count files with changes and selected files in this folder
			let folderChanges = 0;
			let folderSelected = 0;
			const folderTagsPreview: string[] = [];

			for (const item of folderItems) {
				const folderTags = this.computeFolderTags(item);
				const additionalTags = this.getAdditionalTagsForFile(item);
				const allNewTags = [...new Set([...folderTags, ...additionalTags])];
				const tagsToAdd = allNewTags.filter(t => !item.currentTags.includes(t));
				const deletionsForFile = this.tagsToDelete.get(item.file.path);
				const hasChanges = tagsToAdd.length > 0 || (deletionsForFile && deletionsForFile.size > 0);
				if (hasChanges) {
					folderChanges++;
					filesWithChanges++;
				}
				if (this.selectedFiles.has(item.file.path)) {
					folderSelected++;
				}
				// Collect unique tags for this folder (from first file as example)
				if (folderTagsPreview.length === 0 && folderTags.length > 0) {
					folderTagsPreview.push(...folderTags);
				}
			}

			// Folder group container
			const groupEl = this.listEl.createDiv({ cls: 'bbab-tf-tree-group' });

			// Folder header (clickable to expand/collapse)
			const headerEl = groupEl.createDiv({ cls: 'bbab-tf-tree-header' });

			// Expand/collapse toggle
			const toggleBtn = headerEl.createEl('button', {
				cls: 'bbab-tf-tree-toggle',
				text: isExpanded ? '▼' : '▶',
			});
			toggleBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.expandedFolders.has(folderPath)) {
					this.expandedFolders.delete(folderPath);
				} else {
					this.expandedFolders.add(folderPath);
				}
				this.renderList();
			});

			// Folder name
			const folderName = folderPath || '(vault root)';
			headerEl.createSpan({ text: folderName, cls: 'bbab-tf-tree-folder-name' });

			// File count badge
			headerEl.createSpan({
				text: ` — ${folderItems.length} file${folderItems.length > 1 ? 's' : ''}`,
				cls: 'bbab-tf-tree-count',
			});

			// Tags preview on folder header
			if (folderTagsPreview.length > 0 && !isExpanded) {
				const tagsPreview = headerEl.createSpan({ cls: 'bbab-tf-tree-tags-preview' });
				tagsPreview.createSpan({ text: '→ ' });
				tagsPreview.createSpan({
					text: folderTagsPreview.map(t => '#' + t).join(' '),
					cls: 'bbab-tf-tag-add',
				});
			}

			// Files container (only rendered if expanded)
			if (isExpanded) {
				const filesEl = groupEl.createDiv({ cls: 'bbab-tf-tree-files' });

				for (const item of folderItems) {
					const isSelected = this.selectedFiles.has(item.file.path);
					const folderTags = this.computeFolderTags(item);
					const additionalTags = this.getAdditionalTagsForFile(item);
					const allNewTags = [...new Set([...folderTags, ...additionalTags])];
					const tagsToAdd = allNewTags.filter(t => !item.currentTags.includes(t));

					const itemEl = filesEl.createDiv({ cls: 'bbab-tf-tree-file' });

					// Checkbox
					const checkbox = itemEl.createEl('input', { type: 'checkbox' });
					checkbox.checked = isSelected;
					checkbox.addEventListener('change', () => {
						if (checkbox.checked) {
							this.selectedFiles.add(item.file.path);
						} else {
							this.selectedFiles.delete(item.file.path);
						}
						this.renderList();
					});

					// File name (not full path)
					itemEl.createSpan({ text: item.file.name, cls: 'bbab-tf-tree-filename' });

					// Tags display
					const tagsEl = itemEl.createDiv({ cls: 'bbab-tf-tree-file-tags' });

					// Get tags marked for deletion for this file
					const deletionsForFile = this.tagsToDelete.get(item.file.path) || new Set<string>();

					if (item.currentTags.length > 0) {
						tagsEl.createSpan({ text: 'Has: ', cls: 'bbab-tf-tag-label' });

						if (this.isEditMode) {
							// Edit mode: show tags as chips
							const chipsContainer = tagsEl.createSpan({ cls: 'bbab-tf-tag-chips' });
							for (const tag of item.currentTags) {
								const isAutoTag = item.autoTags.includes(tag);
								const isMarkedForDeletion = deletionsForFile.has(tag);
								const canEdit = isAutoTag || this.allowManualTagEditing;

								const chipEl = chipsContainer.createSpan({
									cls: `bbab-tf-tag-chip ${isAutoTag ? 'bbab-tf-tag-chip-auto' : 'bbab-tf-tag-chip-manual'} ${isMarkedForDeletion ? 'bbab-tf-tag-chip-delete' : ''} ${!canEdit ? 'bbab-tf-tag-chip-locked' : ''}`,
								});
								chipEl.createSpan({ text: '#' + tag });

								if (canEdit) {
									const deleteBtn = chipEl.createSpan({
										text: '×',
										cls: 'bbab-tf-tag-delete-btn',
									});
									deleteBtn.addEventListener('click', (e) => {
										e.stopPropagation();
										this.toggleTagDeletion(item.file.path, tag);
									});
								}
							}
						} else {
							// Normal mode: show tags as text, with strikethrough for deletions
							const tagsWithStatus = item.currentTags.map(t => {
								if (deletionsForFile.has(t)) {
									return `<s>#${t}</s>`;
								}
								return '#' + t;
							});
							const tagSpan = tagsEl.createSpan({ cls: 'bbab-tf-tag-current' });
							tagSpan.innerHTML = tagsWithStatus.join(' ');
						}
					}

					// Show "Removing:" for tags marked for deletion (only in normal mode for clarity)
					if (!this.isEditMode && deletionsForFile.size > 0) {
						tagsEl.createSpan({ text: ' ' });
						tagsEl.createSpan({ text: 'Removing: ', cls: 'bbab-tf-tag-label bbab-tf-tag-label-remove' });
						tagsEl.createSpan({
							text: Array.from(deletionsForFile).map(t => '#' + t).join(' '),
							cls: 'bbab-tf-tag-remove',
						});
					}

					// Only show "Adding:" if the file is selected (checked)
					if (isSelected && tagsToAdd.length > 0) {
						if (item.currentTags.length > 0 || deletionsForFile.size > 0) tagsEl.createSpan({ text: ' ' });
						tagsEl.createSpan({ text: 'Adding: ', cls: 'bbab-tf-tag-label' });

						// Show folder tags
						const newFolderTags = folderTags.filter(t => !item.currentTags.includes(t));
						if (newFolderTags.length > 0) {
							tagsEl.createSpan({
								text: newFolderTags.map(t => '#' + t).join(' '),
								cls: 'bbab-tf-tag-add',
							});
						}

						// Show additional tags
						const newAdditionalTags = additionalTags.filter(t => !item.currentTags.includes(t) && !folderTags.includes(t));
						if (newAdditionalTags.length > 0) {
							if (newFolderTags.length > 0) tagsEl.createSpan({ text: ' ' });
							tagsEl.createSpan({
								text: newAdditionalTags.map(t => '#' + t).join(' '),
								cls: 'bbab-tf-tag-additional',
							});
						}
					} else if (!isSelected && tagsToAdd.length > 0) {
						// Show indicator that file is excluded
						if (item.currentTags.length > 0) tagsEl.createSpan({ text: ' ' });
						tagsEl.createSpan({ text: '(excluded)', cls: 'bbab-tf-no-changes' });
					} else if (item.currentTags.length === 0 && tagsToAdd.length === 0 && deletionsForFile.size === 0) {
						tagsEl.createSpan({ text: '(no changes)', cls: 'bbab-tf-no-changes' });
					}
				}
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

	renderEditButtons() {
		if (!this.editButtonsContainer) return;
		this.editButtonsContainer.empty();

		if (!this.isEditMode) {
			// Normal mode: show "Edit Existing Tags" button
			const editBtn = this.editButtonsContainer.createEl('button', {
				text: 'Edit Existing Tags',
				cls: 'bbab-tf-edit-tags-btn',
			});
			editBtn.addEventListener('click', () => {
				this.isEditMode = true;
				this.renderEditButtons();
				this.renderList();
				this.updateRightColumnState();
			});
		} else {
			// Edit mode: show "Stop Editing" and "Edit Manual Tags" buttons
			const stopBtn = this.editButtonsContainer.createEl('button', {
				text: 'Stop Editing',
				cls: 'bbab-tf-stop-editing-btn',
			});
			stopBtn.addEventListener('click', () => {
				this.isEditMode = false;
				this.allowManualTagEditing = false;
				this.renderEditButtons();
				this.renderList();
				this.updateRightColumnState();
			});

			if (!this.allowManualTagEditing) {
				const manualBtn = this.editButtonsContainer.createEl('button', {
					text: 'Edit Manual Tags',
					cls: 'bbab-tf-edit-manual-btn',
				});
				manualBtn.addEventListener('click', () => {
					this.allowManualTagEditing = true;
					this.renderEditButtons();
					this.renderList();
				});

				// Warning text
				this.editButtonsContainer.createEl('p', {
					text: 'Warning: Manual tag changes cannot be reverted by TagForge.',
					cls: 'bbab-tf-manual-warning',
				});
			} else {
				// Show indicator that manual editing is enabled
				this.editButtonsContainer.createEl('p', {
					text: 'Manual tag editing enabled. Changes cannot be reverted.',
					cls: 'bbab-tf-manual-warning bbab-tf-manual-active',
				});
			}
		}
	}

	updateRightColumnState() {
		if (!this.rightColumn) return;
		if (this.isEditMode) {
			this.rightColumn.addClass('bbab-tf-controls-disabled');
		} else {
			this.rightColumn.removeClass('bbab-tf-controls-disabled');
		}
	}

	toggleTagDeletion(filePath: string, tag: string) {
		if (!this.tagsToDelete.has(filePath)) {
			this.tagsToDelete.set(filePath, new Set());
		}
		const fileTags = this.tagsToDelete.get(filePath)!;
		if (fileTags.has(tag)) {
			fileTags.delete(tag);
			if (fileTags.size === 0) {
				this.tagsToDelete.delete(filePath);
			}
		} else {
			fileTags.add(tag);
		}
		this.renderList();
	}

	isTagMarkedForDeletion(filePath: string, tag: string): boolean {
		return this.tagsToDelete.get(filePath)?.has(tag) || false;
	}

	getParentFolder(filePath: string): string {
		const parts = filePath.split(/[/\\]/);
		parts.pop(); // Remove filename
		return parts.join('/');
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

	computeFinalResults(): Array<{ file: TFile; tagsToAdd: string[]; tagsToRemove: string[] }> {
		const results: Array<{ file: TFile; tagsToAdd: string[]; tagsToRemove: string[] }> = [];

		for (const item of this.items) {
			const folderTags = this.computeFolderTags(item);
			const additionalTags = this.getAdditionalTagsForFile(item);
			const allNewTags = [...new Set([...folderTags, ...additionalTags])];

			// Only add tags if file is selected
			const tagsToAdd = this.selectedFiles.has(item.file.path)
				? allNewTags.filter(t => !item.currentTags.includes(t))
				: [];

			// Get tags marked for removal (applies regardless of selection)
			const tagsToRemove = Array.from(this.tagsToDelete.get(item.file.path) || []);

			if (tagsToAdd.length > 0 || tagsToRemove.length > 0) {
				results.push({ file: item.file, tagsToAdd, tagsToRemove });
			}
		}

		return results;
	}

	/**
	 * Phase 10: Save the current configuration as a folder rule
	 */
	async saveRule(): Promise<void> {
		if (!this.targetFolder) return;

		// Get enabled folder tag levels (for dynamic tag computation)
		const folderTagLevels: number[] = [];
		if (!this.skipAllFolderTags) {
			for (const level of this.enabledLevels) {
				folderTagLevels.push(level);
			}
		}
		folderTagLevels.sort((a, b) => a - b);

		// Get static/additional tags (if they apply to all files)
		const staticTags: string[] = [];
		if (!this.additionalTagsToSelectedOnly && this.additionalTags.length > 0) {
			staticTags.push(...this.additionalTags);
		}

		if (folderTagLevels.length === 0 && staticTags.length === 0) {
			new Notice('No tags to save as rule');
			return;
		}

		// Determine applyDownLevels based on user selection
		const applyDownLevels: 'all' | number[] = this.ruleApplyTo === 'subfolders' ? 'all' : [0];

		// Create the rule
		const rule: FolderRule = {
			tags: staticTags,
			folderTagLevels: folderTagLevels,
			applyDownLevels: applyDownLevels,
			inheritFromAncestors: false,  // Default to false, can be changed in Rules Management later
			applyToNewFiles: true,
			createdAt: new Date().toISOString(),
			lastModified: new Date().toISOString(),
		};

		// Save to plugin data
		this.plugin.folderRules[this.targetFolder] = rule;
		await this.plugin.saveSettings();

		new Notice(`Folder rule saved for ${this.targetFolder}`);
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
		this.modalEl.addClass('bbab-tf-large-modal');
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
		this.modalEl.addClass('bbab-tf-large-modal');
		contentEl.addClass('bbab-tf-date-picker-modal');

		contentEl.createEl('h2', { text: 'Select dates to revert' });
		contentEl.createEl('p', {
			text: 'Choose which dates to remove auto-applied tags from (dates shown in UTC):',
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

interface PendingMoveOperation {
	file: TFile;
	oldPath: string;
	oldFolder: string;
	newFolder: string;
}

interface GroupedMoveResult {
	action: 'continue' | 'leave' | 'cancel';
	excludedPaths: Set<string>;  // Files to skip (user unchecked them)
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
		this.modalEl.addClass('bbab-tf-large-modal');
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
// Grouped Move Confirmation Modal (for batch folder moves)
// ============================================================================

class GroupedMoveConfirmationModal extends Modal {
	moves: PendingMoveOperation[];
	onResult: (result: GroupedMoveResult) => void;
	excludedPaths: Set<string> = new Set();
	rememberChoice: boolean = false;
	resultSent: boolean = false; // Track if user clicked a button

	constructor(
		app: App,
		moves: PendingMoveOperation[],
		onResult: (result: GroupedMoveResult) => void
	) {
		super(app);
		this.moves = moves;
		this.onResult = onResult;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass('bbab-tf-large-modal');
		contentEl.addClass('bbab-tf-grouped-move-modal');

		contentEl.createEl('h2', { text: 'Multiple Files Moved' });

		// Summary
		const summaryEl = contentEl.createDiv({ cls: 'bbab-tf-move-summary' });
		summaryEl.createEl('p', {
			text: `${this.moves.length} files are being moved. Choose how to handle their tags:`,
		});

		// Group moves by destination folder for cleaner display
		const folderGroups = new Map<string, PendingMoveOperation[]>();
		for (const move of this.moves) {
			const destFolder = move.newFolder || '(vault root)';
			if (!folderGroups.has(destFolder)) {
				folderGroups.set(destFolder, []);
			}
			folderGroups.get(destFolder)!.push(move);
		}

		// File list with checkboxes
		const listContainer = contentEl.createDiv({ cls: 'bbab-tf-grouped-move-list' });

		for (const [destFolder, groupMoves] of folderGroups) {
			// Folder group header - just show destination folder
			const groupEl = listContainer.createDiv({ cls: 'bbab-tf-move-group' });
			const groupHeader = groupEl.createDiv({ cls: 'bbab-tf-move-group-header' });

			groupHeader.createSpan({ text: destFolder, cls: 'bbab-tf-move-folder-name' });
			groupHeader.createSpan({ text: ` — ${groupMoves.length} file${groupMoves.length > 1 ? 's' : ''}`, cls: 'bbab-tf-move-count' });

			// Files in this group
			const filesEl = groupEl.createDiv({ cls: 'bbab-tf-move-group-files' });
			for (const move of groupMoves) {
				const fileEl = filesEl.createDiv({ cls: 'bbab-tf-move-file-item' });
				const checkbox = fileEl.createEl('input', { type: 'checkbox' });
				checkbox.checked = true;
				checkbox.addEventListener('change', () => {
					if (checkbox.checked) {
						this.excludedPaths.delete(move.file.path);
					} else {
						this.excludedPaths.add(move.file.path);
					}
					this.updateButtonText();
				});
				fileEl.createSpan({ text: move.file.name, cls: 'bbab-tf-move-filename' });
			}
		}

		// Explanation
		const descEl = contentEl.createDiv({ cls: 'bbab-tf-move-description' });
		descEl.createEl('p', { text: 'Choose an action for checked files:' });
		const optionsList = descEl.createEl('ul', { cls: 'bbab-tf-move-options' });
		optionsList.createEl('li', { text: 'Continue — Remove old folder tags, apply new folder tags' });
		optionsList.createEl('li', { text: 'Leave Tags — Keep current tags as-is' });
		optionsList.createEl('li', { text: 'Cancel — Move files back to original folders' });
		descEl.createEl('p', {
			text: 'Unchecked files: kept their current tags, no changes made.',
			cls: 'bbab-tf-hint',
		});

		// Remember choice checkbox
		const rememberLabel = contentEl.createEl('label', { cls: 'bbab-tf-remember-choice' });
		const rememberCb = rememberLabel.createEl('input', { type: 'checkbox' });
		rememberLabel.createSpan({ text: ' Remember my choice for future moves' });
		rememberCb.addEventListener('change', () => {
			this.rememberChoice = rememberCb.checked;
		});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-move-buttons' });

		const continueBtn = buttonContainer.createEl('button', {
			cls: 'mod-cta bbab-tf-grouped-continue-btn',
		});
		continueBtn.textContent = `Continue (${this.moves.length} files)`;
		continueBtn.addEventListener('click', () => {
			this.resultSent = true;
			this.close();
			this.onResult({
				action: 'continue',
				excludedPaths: new Set(this.excludedPaths),
				remember: this.rememberChoice,
			});
		});

		const leaveBtn = buttonContainer.createEl('button', {
			cls: 'bbab-tf-grouped-leave-btn',
		});
		leaveBtn.textContent = `Leave Tags (${this.moves.length} files)`;
		leaveBtn.addEventListener('click', () => {
			this.resultSent = true;
			this.close();
			this.onResult({
				action: 'leave',
				excludedPaths: new Set(this.excludedPaths),
				remember: this.rememberChoice,
			});
		});

		const cancelBtn = buttonContainer.createEl('button', {
			text: 'Cancel (Undo Moves)',
			cls: 'mod-warning bbab-tf-grouped-cancel-btn',
		});
		cancelBtn.addEventListener('click', () => {
			this.resultSent = true;
			this.close();
			this.onResult({
				action: 'cancel',
				excludedPaths: new Set(this.excludedPaths),
				remember: false,
			});
		});
	}

	updateButtonText() {
		const activeCount = this.moves.length - this.excludedPaths.size;
		const continueBtn = this.contentEl.querySelector('.bbab-tf-grouped-continue-btn');
		const leaveBtn = this.contentEl.querySelector('.bbab-tf-grouped-leave-btn');
		if (continueBtn) {
			continueBtn.textContent = `Continue (${activeCount} files)`;
		}
		if (leaveBtn) {
			leaveBtn.textContent = `Leave Tags (${activeCount} files)`;
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();

		// If closed without clicking a button (X or Escape), default to Cancel (undo moves)
		// Use setTimeout to defer callback until after modal is fully closed
		// Capture values before timeout to ensure they're not affected by modal cleanup
		if (!this.resultSent) {
			const capturedExcludedPaths = new Set(this.excludedPaths);
			const capturedOnResult = this.onResult;

			setTimeout(() => {
				capturedOnResult({
					action: 'cancel',
					excludedPaths: capturedExcludedPaths,
					remember: false,
				});
			}, 50); // 50ms delay to ensure modal is fully closed
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
			.setName('Enable auto-tagging')
			.setDesc('Automatically tag new files based on their folder location')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoTagEnabled)
				.onChange(async (value) => {
					this.plugin.settings.autoTagEnabled = value;
					await this.plugin.saveSettings();
				}));

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
		// Folder Rules (Phase 10)
		// -------------------------------------------------------------------------

		containerEl.createEl('h2', { text: 'Folder Rules' });
		containerEl.createEl('p', {
			text: 'Set up rules to automatically tag new files based on their folder location.',
			cls: 'bbab-tf-description',
		});

		const ruleCount = Object.keys(this.plugin.folderRules).length;
		new Setting(containerEl)
			.setName('Manage folder rules')
			.setDesc(`${ruleCount} rule${ruleCount !== 1 ? 's' : ''} configured. Click to view, create, or edit rules.`)
			.addButton(button => button
				.setButtonText('Open Rules Manager')
				.setCta()
				.onClick(() => {
					new RulesManagementModal(this.app, this.plugin).open();
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
						.map(t => t.trim().replace(/^#/, '').toLowerCase())
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
		this.modalEl.addClass('bbab-tf-large-modal');
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
		this.modalEl.addClass('bbab-tf-large-modal');
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

// ============================================================================
// Rules Management Modal (Phase 10 - Folder Rules)
// ============================================================================

class RulesManagementModal extends Modal {
	plugin: TagForgePlugin;
	selectedFolder: string | null = null;
	expandedFolders: Set<string> = new Set();

	// UI references
	treeEl: HTMLElement | null = null;
	editorEl: HTMLElement | null = null;

	constructor(app: App, plugin: TagForgePlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass('bbab-tf-large-modal');
		contentEl.addClass('bbab-tf-rules-modal');

		// Header
		const header = contentEl.createDiv({ cls: 'bbab-tf-modal-header' });
		header.createEl('h2', { text: 'Manage Folder Rules' });
		header.createEl('p', {
			text: 'Set up rules to automatically tag new files based on their folder location.',
			cls: 'bbab-tf-description',
		});

		// Stats bar
		const ruleCount = Object.keys(this.plugin.folderRules).length;
		const statsBar = header.createDiv({ cls: 'bbab-tf-rules-stats' });
		statsBar.createSpan({ text: `${ruleCount} rule${ruleCount !== 1 ? 's' : ''} configured` });

		// Two-column layout
		const columnsContainer = contentEl.createDiv({ cls: 'bbab-tf-columns' });

		// LEFT COLUMN - Folder Tree
		const leftColumn = columnsContainer.createDiv({ cls: 'bbab-tf-column-left' });
		leftColumn.createEl('h3', { text: 'Folders' });

		this.treeEl = leftColumn.createDiv({ cls: 'bbab-tf-folder-tree' });
		this.renderTree();

		// RIGHT COLUMN - Rule Editor
		const rightColumn = columnsContainer.createDiv({ cls: 'bbab-tf-column-right' });
		this.editorEl = rightColumn;
		this.renderEditor();

		// Close button
		const buttonContainer = contentEl.createDiv({ cls: 'bbab-tf-button-container' });
		const closeBtn = buttonContainer.createEl('button', { text: 'Close' });
		closeBtn.addEventListener('click', () => this.close());
	}

	renderTree() {
		if (!this.treeEl) return;
		this.treeEl.empty();

		// Get all folders in vault
		const folders: string[] = [];
		this.app.vault.getAllLoadedFiles().forEach(file => {
			if (file instanceof TFolder && file.path !== '/') {
				folders.push(file.path);
			}
		});
		folders.sort();

		// Build tree structure
		const tree = this.buildFolderTree(folders);
		this.renderTreeNode(this.treeEl, tree, '');
	}

	buildFolderTree(folders: string[]): Map<string, string[]> {
		// Map parent path -> child folder names
		const tree = new Map<string, string[]>();
		tree.set('', []); // Root

		for (const folder of folders) {
			const parts = folder.split('/');
			let currentPath = '';

			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				const parentPath = currentPath;
				currentPath = currentPath ? `${currentPath}/${part}` : part;

				if (!tree.has(parentPath)) {
					tree.set(parentPath, []);
				}

				const children = tree.get(parentPath)!;
				if (!children.includes(part)) {
					children.push(part);
				}
			}
		}

		return tree;
	}

	renderTreeNode(container: HTMLElement, tree: Map<string, string[]>, parentPath: string, depth: number = 0) {
		const children = tree.get(parentPath) || [];

		for (const childName of children.sort()) {
			const childPath = parentPath ? `${parentPath}/${childName}` : childName;
			const hasRule = this.plugin.folderRules[childPath] !== undefined;
			const hasChildren = (tree.get(childPath) || []).length > 0;
			const isExpanded = this.expandedFolders.has(childPath);
			const isSelected = this.selectedFolder === childPath;

			const itemEl = container.createDiv({
				cls: `bbab-tf-tree-item ${isSelected ? 'bbab-tf-tree-item-selected' : ''}`,
			});
			itemEl.style.paddingLeft = `${depth * 1.25}em`;

			// Expand/collapse toggle
			if (hasChildren) {
				const toggleEl = itemEl.createSpan({
					cls: 'bbab-tf-tree-toggle',
					text: isExpanded ? '▼' : '▶',
				});
				toggleEl.addEventListener('click', (e) => {
					e.stopPropagation();
					if (isExpanded) {
						this.expandedFolders.delete(childPath);
					} else {
						this.expandedFolders.add(childPath);
					}
					this.renderTree();
				});
			} else {
				itemEl.createSpan({ cls: 'bbab-tf-tree-toggle', text: ' ' });
			}

			// Folder name
			const nameEl = itemEl.createSpan({
				cls: 'bbab-tf-tree-name',
				text: childName,
			});

			// Rule indicator
			if (hasRule) {
				itemEl.createSpan({
					cls: 'bbab-tf-tree-rule-indicator',
					text: '●',
					attr: { title: 'Has rule' },
				});
			}

			// Click to select
			itemEl.addEventListener('click', () => {
				this.selectedFolder = childPath;
				this.renderTree();
				this.renderEditor();
			});

			// Render children if expanded
			if (hasChildren && isExpanded) {
				this.renderTreeNode(container, tree, childPath, depth + 1);
			}
		}
	}

	renderEditor() {
		if (!this.editorEl) return;
		this.editorEl.empty();

		this.editorEl.createEl('h3', { text: 'Rule Editor' });

		if (!this.selectedFolder) {
			this.editorEl.createEl('p', {
				text: 'Select a folder to view or create a rule.',
				cls: 'bbab-tf-description',
			});
			return;
		}

		const existingRule = this.plugin.folderRules[this.selectedFolder];

		// Folder path display
		const pathDisplay = this.editorEl.createDiv({ cls: 'bbab-tf-rule-path' });
		pathDisplay.createEl('strong', { text: 'Folder: ' });
		pathDisplay.createSpan({ text: this.selectedFolder });

		// Check for parent rules that affect this folder
		const parentRules = this.getParentRulesAffecting(this.selectedFolder);
		if (parentRules.length > 0) {
			const warningEl = this.editorEl.createDiv({ cls: 'bbab-tf-parent-rules-warning' });
			warningEl.createEl('strong', { text: '⚠ Parent rules also apply:' });
			const parentList = warningEl.createEl('ul');
			for (const pr of parentRules) {
				parentList.createEl('li', {
					text: `${pr.path}: ${pr.rule.tags.join(', ')}`,
				});
			}
		}

		// Form section
		const formEl = this.editorEl.createDiv({ cls: 'bbab-tf-rule-form' });

		// Folder-based tags section (dynamic levels based on folder structure)
		const levelSection = formEl.createDiv({ cls: 'bbab-tf-form-section' });
		levelSection.createEl('label', { text: 'Folder-based tags (dynamic)' });
		levelSection.createEl('p', {
			text: 'Check folder levels to derive tags from. These compute dynamically based on each file\'s path:',
			cls: 'bbab-tf-description',
		});

		const levelContainer = levelSection.createDiv({ cls: 'bbab-tf-level-checkboxes' });

		// Calculate the maximum depth available for this folder
		const currentFolderDepth = this.selectedFolder.split('/').length;
		const maxSubfolderDepth = this.getMaxSubfolderDepth(this.selectedFolder);
		const maxAvailableLevels = currentFolderDepth + maxSubfolderDepth;

		// Get existing folderTagLevels from rule
		const existingFolderLevels = existingRule?.folderTagLevels || [];

		for (let i = 1; i <= maxAvailableLevels; i++) {
			const levelLabel = levelContainer.createEl('label', { cls: 'bbab-tf-level-checkbox' });
			const levelCb = levelLabel.createEl('input', { type: 'checkbox' });
			levelCb.checked = existingFolderLevels.includes(i);
			levelCb.dataset.level = String(i);
			levelLabel.createSpan({ text: ` Level ${i}` });
		}

		// Additional/custom tags input (static tags)
		const tagsSection = formEl.createDiv({ cls: 'bbab-tf-form-section' });
		tagsSection.createEl('label', { text: 'Static tags (comma-separated)' });
		tagsSection.createEl('p', {
			text: 'Add fixed tags that always apply (e.g., project-type, status):',
			cls: 'bbab-tf-description',
		});
		const tagsInput = tagsSection.createEl('input', {
			type: 'text',
			cls: 'bbab-tf-rule-tags-input',
			placeholder: 'project, active, important',
		});
		// Show existing static tags
		if (existingRule) {
			tagsInput.value = existingRule.tags.join(', ');
		}

		// Apply to selector
		const applySection = formEl.createDiv({ cls: 'bbab-tf-form-section' });
		applySection.createEl('label', { text: 'Apply to' });

		const applyContainer = applySection.createDiv({ cls: 'bbab-tf-apply-options' });

		const folderOnlyLabel = applyContainer.createEl('label');
		const folderOnlyRadio = folderOnlyLabel.createEl('input', {
			type: 'radio',
			attr: { name: 'applyTo' },
		});
		folderOnlyLabel.createSpan({ text: ' This folder only' });

		const subfoldersLabel = applyContainer.createEl('label');
		const subfoldersRadio = subfoldersLabel.createEl('input', {
			type: 'radio',
			attr: { name: 'applyTo' },
		});
		subfoldersLabel.createSpan({ text: ' This folder + all subfolders' });

		// Set current value
		if (existingRule) {
			if (existingRule.applyDownLevels === 'all') {
				subfoldersRadio.checked = true;
			} else {
				folderOnlyRadio.checked = true;
			}
		} else {
			subfoldersRadio.checked = true; // Default
		}

		// Inherit from ancestors toggle
		const inheritSection = formEl.createDiv({ cls: 'bbab-tf-form-section' });
		const inheritLabel = inheritSection.createEl('label', { cls: 'bbab-tf-checkbox-label' });
		const inheritCb = inheritLabel.createEl('input', { type: 'checkbox' });
		inheritCb.checked = existingRule ? existingRule.inheritFromAncestors : false;
		inheritLabel.createSpan({ text: ' Inherit tags from parent folder rules' });

		// Apply to new files toggle
		const newFilesSection = formEl.createDiv({ cls: 'bbab-tf-form-section' });
		const newFilesLabel = newFilesSection.createEl('label', { cls: 'bbab-tf-checkbox-label' });
		const newFilesCb = newFilesLabel.createEl('input', { type: 'checkbox' });
		newFilesCb.checked = existingRule ? existingRule.applyToNewFiles : true;
		newFilesLabel.createSpan({ text: ' Apply to new files automatically' });

		// Buttons
		const buttonsEl = formEl.createDiv({ cls: 'bbab-tf-rule-buttons' });

		const saveBtn = buttonsEl.createEl('button', {
			text: existingRule ? 'Update Rule' : 'Create Rule',
			cls: 'mod-cta',
		});
		saveBtn.addEventListener('click', async () => {
			// Collect selected folder levels
			const folderTagLevels: number[] = [];
			const levelCheckboxes = formEl.querySelectorAll('.bbab-tf-level-checkbox input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
			levelCheckboxes.forEach(cb => {
				if (cb.checked && cb.dataset.level) {
					folderTagLevels.push(parseInt(cb.dataset.level, 10));
				}
			});
			folderTagLevels.sort((a, b) => a - b);

			// Collect static tags from input
			const tags = tagsInput.value
				.split(',')
				.map(t => t.trim().replace(/^#/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, ''))
				.filter(t => t.length > 0);

			if (folderTagLevels.length === 0 && tags.length === 0) {
				new Notice('Please select at least one folder level or enter a static tag');
				return;
			}

			const applyDownLevels: 'all' | number[] = subfoldersRadio.checked ? 'all' : [0];

			const rule: FolderRule = {
				tags,
				folderTagLevels,
				applyDownLevels,
				inheritFromAncestors: inheritCb.checked,
				applyToNewFiles: newFilesCb.checked,
				createdAt: existingRule?.createdAt || new Date().toISOString(),
				lastModified: new Date().toISOString(),
			};

			this.plugin.folderRules[this.selectedFolder!] = rule;
			await this.plugin.saveSettings();

			new Notice(`Rule ${existingRule ? 'updated' : 'created'} for ${this.selectedFolder}`);
			this.renderTree();
			this.renderEditor();
		});

		if (existingRule) {
			const deleteBtn = buttonsEl.createEl('button', {
				text: 'Delete Rule',
				cls: 'mod-warning',
			});
			deleteBtn.addEventListener('click', async () => {
				if (confirm(`Delete rule for ${this.selectedFolder}?`)) {
					delete this.plugin.folderRules[this.selectedFolder!];
					await this.plugin.saveSettings();
					new Notice(`Rule deleted for ${this.selectedFolder}`);
					this.renderTree();
					this.renderEditor();
				}
			});

			// Apply to existing files button
			const applyNowBtn = buttonsEl.createEl('button', {
				text: 'Apply to Existing Files',
			});
			applyNowBtn.addEventListener('click', async () => {
				await this.applyRuleToExistingFiles();
			});
		}

		// Show rule metadata if exists
		if (existingRule) {
			const metaEl = this.editorEl.createDiv({ cls: 'bbab-tf-rule-meta' });
			metaEl.createEl('small', {
				text: `Created: ${new Date(existingRule.createdAt).toLocaleDateString()}`,
			});
			metaEl.createEl('small', {
				text: ` • Modified: ${new Date(existingRule.lastModified).toLocaleDateString()}`,
			});
		}
	}

	getParentRulesAffecting(folderPath: string): Array<{ path: string; rule: FolderRule }> {
		const result: Array<{ path: string; rule: FolderRule }> = [];
		const parts = folderPath.split('/');

		// Check each ancestor
		for (let i = 1; i < parts.length; i++) {
			const ancestorPath = parts.slice(0, i).join('/');
			const rule = this.plugin.folderRules[ancestorPath];

			if (rule) {
				// Check if this rule's applyDownLevels reaches our folder
				const levelsDown = parts.length - i;

				if (rule.applyDownLevels === 'all') {
					result.push({ path: ancestorPath, rule });
				} else if (Array.isArray(rule.applyDownLevels) && rule.applyDownLevels.includes(levelsDown)) {
					result.push({ path: ancestorPath, rule });
				}
			}
		}

		return result;
	}

	getMaxSubfolderDepth(folderPath: string): number {
		// Find the maximum depth of any subfolder under this folder
		let maxDepth = 0;
		const baseParts = folderPath.split('/').length;

		this.app.vault.getAllLoadedFiles().forEach(file => {
			if (file instanceof TFolder && file.path.startsWith(folderPath + '/')) {
				const depth = file.path.split('/').length - baseParts;
				if (depth > maxDepth) {
					maxDepth = depth;
				}
			}
		});

		return maxDepth;
	}

	async applyRuleToExistingFiles() {
		if (!this.selectedFolder) return;

		const rule = this.plugin.folderRules[this.selectedFolder];
		if (!rule) return;

		// Get files in this folder (and subfolders if applicable)
		const files = this.app.vault.getMarkdownFiles().filter(file => {
			if (rule.applyDownLevels === 'all') {
				return file.path.startsWith(this.selectedFolder + '/');
			} else {
				// Only direct folder
				const fileFolder = file.path.substring(0, file.path.lastIndexOf('/'));
				return fileFolder === this.selectedFolder;
			}
		});

		if (files.length === 0) {
			new Notice('No files found to apply rule to');
			return;
		}

		let applied = 0;
		for (const file of files) {
			const existingTags = await this.plugin.getFileTags(file);
			const newTags = rule.tags.filter(t => !existingTags.includes(t));

			if (newTags.length > 0) {
				await this.plugin.applyTagsToFile(file.path, newTags);
				applied++;
			}
		}

		new Notice(`Applied rule to ${applied} files`);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
