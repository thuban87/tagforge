import { App, Plugin, Notice, TFile, TFolder, Platform } from 'obsidian';
import {
	TagForgeSettings, TagTrackingEntry, FolderRule, OperationFileState,
	TagOperation, TagForgeData, ValidationIssue, EnhancedPreviewItem,
	MoveConfirmationResult, PendingMoveOperation, GroupedMoveResult,
	WINDOWS_SYSTEM_FILES, MAX_HISTORY_SIZE, UNDO_FILE_DISPLAY_LIMIT,
	DEFAULT_SETTINGS, DEFAULT_DATA,
} from './src/types';
import { FolderPickerModal } from './src/modals/FolderPickerModal';
import { DatePickerModal } from './src/modals/DatePickerModal';
import { UndoHistoryModal } from './src/modals/UndoHistoryModal';
import { MoveConfirmationModal } from './src/modals/MoveConfirmationModal';
import { GroupedMoveConfirmationModal } from './src/modals/GroupedMoveConfirmationModal';
import { ValidationResultsModal } from './src/modals/ValidationResultsModal';
import { TagReportModal } from './src/modals/TagReportModal';
import { BulkPreviewModal } from './src/modals/BulkPreviewModal';
import { RulesManagementModal } from './src/modals/RulesManagementModal';
import { TagForgeSettingTab } from './src/settings';

// Node.js modules (loaded at runtime in Electron)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodePath = require('path') as typeof import('path');

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

		// Remove auto-applied tags (keeps manual tags intact)
		this.addCommand({
			id: 'revert-all-auto-tags',
			name: 'REMOVE: Undo all TagForge-applied tags (keeps manual)',
			callback: () => this.revertAllAutoTags(),
		});

		// Nuclear remove - clear ALL tags (desktop only)
		if (!Platform.isMobile) {
			this.addCommand({
				id: 'revert-all-tags-nuclear',
				name: 'REMOVE: Remove ALL tags from vault (nuclear option)',
				callback: () => {
					if (Platform.isMobile) {
						new Notice('Nuclear option is not available on mobile');
						return;
					}
					this.revertAllTagsNuclear();
				},
			});
		}

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

		// Get tags based on folder rules
		const tags = this.getRulesForPath(activeFile.path);
		if (tags.length === 0) {
			new Notice('No folder rules apply to this location');
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
				this,  // Pass plugin for rule checking
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
				this.app,
				this,  // Pass plugin for rule checking
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

		// Step 2: Apply new tags based on new location's folder rules
		const newTags = this.getRulesForPath(file.path);
		if (newTags.length > 0) {
			await this.applyTagsToFile(file.path, newTags);
			new Notice(`Retagged with: ${newTags.map(t => '#' + t).join(', ')}`);
		} else {
			await this.saveSettings();
			new Notice('Auto-tags removed (new location has no folder rules)');
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

				// Filter out protected tags - they should NOT be removed
				const protectedLower = this.settings.protectedTags.map(t => t.toLowerCase());
				const tagsToRemove = tracking.autoTags.filter(t => !protectedLower.includes(t.toLowerCase()));
				const protectedAutoTags = tracking.autoTags.filter(t => protectedLower.includes(t.toLowerCase()));

				if (tagsToRemove.length > 0) {
					await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
						if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
							// Remove only non-protected auto-applied tags
							frontmatter.tags = frontmatter.tags.filter(
								(tag: string) => !tagsToRemove.includes(tag)
							);
							// Remove empty tags array
							if (frontmatter.tags.length === 0) {
								delete frontmatter.tags;
							}
						}
					});
				}

				// Capture state after
				const tagsAfter = await this.getFileTags(file);
				operationFiles.push({
					path: filePath,
					tagsBefore,
					tagsAfter,
					trackingBefore: [...tracking.autoTags]  // Save tracking for undo
				});

				// Keep tracking for protected tags that weren't removed
				if (protectedAutoTags.length > 0) {
					this.tagTracking[filePath] = {
						autoTags: protectedAutoTags,
						lastUpdated: tracking.lastUpdated
					};
				}

				reverted++;
			} catch (e) {
				console.error(`TagForge: Failed to revert ${filePath}`, e);
				errors++;
			}

			// Every 50 files, yield to UI and show progress
			if (i > 0 && i % 50 === 0) {
				new Notice(`Removing: ${i}/${trackedFiles.length}...`);
				await new Promise(resolve => setTimeout(resolve, 10));
			}
		}

		// Record the revert operation
		if (operationFiles.length > 0) {
			await this.recordOperation('revert', `Removed auto-tags from ${reverted} files`, operationFiles);
		}

		// Clear tracking data for files that had all tags removed
		// (files with protected tags were already handled above)
		for (const filePath of trackedFiles) {
			const tracking = this.tagTracking[filePath];
			if (tracking) {
				const protectedLower = this.settings.protectedTags.map(t => t.toLowerCase());
				const hasProtected = tracking.autoTags.some(t => protectedLower.includes(t.toLowerCase()));
				if (!hasProtected) {
					delete this.tagTracking[filePath];
				}
			}
		}
		await this.saveSettings();

		new Notice(`Reverted ${reverted} files. ${errors > 0 ? `${errors} errors.` : ''}`);
	}

	async revertAllTagsNuclear() {
		const files = this.app.vault.getMarkdownFiles();
		const ruleCount = Object.keys(this.folderRules).length;

		const confirmed = confirm(
			`âš ï¸ NUCLEAR OPTION âš ï¸\n\nThis will:\nâ€¢ Remove ALL tags (auto AND manual) from ALL ${files.length} markdown files\nâ€¢ Delete ALL folder rules (${ruleCount} rules)\nâ€¢ Clear all tracking data\n\nThis cannot be undone. Continue?`
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

				// Filter out protected tags - they should NOT be removed
				const protectedLower = this.settings.protectedTags.map(t => t.toLowerCase());
				const tagsToRemove = tracking.autoTags.filter(t => !protectedLower.includes(t.toLowerCase()));
				const protectedAutoTags = tracking.autoTags.filter(t => protectedLower.includes(t.toLowerCase()));

				if (tagsToRemove.length > 0) {
					await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
						if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
							frontmatter.tags = frontmatter.tags.filter(
								(tag: string) => !tagsToRemove.includes(tag)
							);
							if (frontmatter.tags.length === 0) {
								delete frontmatter.tags;
							}
						}
					});
				}

				// Capture state after
				const tagsAfter = await this.getFileTags(file);
				operationFiles.push({
					path: filePath,
					tagsBefore,
					tagsAfter,
					trackingBefore: [...tracking.autoTags]  // Save tracking for undo
				});

				// Update tracking: keep protected tags, remove others
				if (protectedAutoTags.length > 0) {
					this.tagTracking[filePath] = {
						autoTags: protectedAutoTags,
						lastUpdated: tracking.lastUpdated
					};
				} else {
					delete this.tagTracking[filePath];
				}
				reverted++;
			} catch (e) {
				console.error(`TagForge: Failed to revert ${filePath}`, e);
				errors++;
			}

			// Every 50 files, yield to UI and show progress
			if (i > 0 && i % 50 === 0) {
				new Notice(`Removing: ${i}/${filesToRevert.length}...`);
				await new Promise(resolve => setTimeout(resolve, 10));
			}
		}

		// Record the revert operation
		if (operationFiles.length > 0) {
			await this.recordOperation('revert', `Removed auto-tags from ${reverted} files (by date)`, operationFiles);
		}

		await this.saveSettings();
		new Notice(`Removed auto-tags from ${reverted} files from ${selectedDates.length} date(s). ${errors > 0 ? `${errors} errors.` : ''}`);
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

					// Filter out protected tags - they should NOT be removed
					const protectedLower = this.settings.protectedTags.map(t => t.toLowerCase());
					const tagsToRemove = tracking.autoTags.filter(t => !protectedLower.includes(t.toLowerCase()));
					const protectedAutoTags = tracking.autoTags.filter(t => protectedLower.includes(t.toLowerCase()));

					if (tagsToRemove.length > 0) {
						await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
							if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
								frontmatter.tags = frontmatter.tags.filter(
									(tag: string) => !tagsToRemove.includes(tag)
								);
								if (frontmatter.tags.length === 0) {
									delete frontmatter.tags;
								}
							}
						});
					}

					const tagsAfter = await this.getFileTags(file);
					operationFiles.push({
						path: filePath,
						tagsBefore,
						tagsAfter,
						trackingBefore: [...tracking.autoTags]  // Save tracking for undo
					});

					// Update tracking: keep protected tags, remove others
					if (protectedAutoTags.length > 0) {
						this.tagTracking[filePath] = {
							autoTags: protectedAutoTags,
							lastUpdated: tracking.lastUpdated
						};
					} else {
						delete this.tagTracking[filePath];
					}
					reverted++;
				} catch (e) {
					console.error(`TagForge: Failed to revert ${filePath}`, e);
					errors++;
				}

				// Every 50 files, yield to UI and show progress
				if (i > 0 && i % 50 === 0) {
					new Notice(`Removing: ${i}/${filesToRevert.length}...`);
					await new Promise(resolve => setTimeout(resolve, 10));
				}
			}

			if (operationFiles.length > 0) {
				await this.recordOperation('revert', `Removed auto-tags from ${reverted} files in ${selectedFolder}`, operationFiles);
			}

			await this.saveSettings();
			new Notice(`Removed auto-tags from ${reverted} files in ${selectedFolder}. ${errors > 0 ? `${errors} errors.` : ''}`);
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
	 * - A rule's `inheritFromAncestors` controls whether it receives tags from parent rules
	 *   When set to false, it acts as a "barrier" - ancestor rules won't apply to this folder or below
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

		// First, find the deepest folder with inheritFromAncestors: false
		// This acts as a "barrier" - ancestors above this point won't contribute tags
		let inheritanceBarrierLevel = -1;  // -1 means no barrier, include all ancestors
		for (let i = pathParts.length; i >= 1; i--) {
			const folderPath = pathParts.slice(0, i).join('/');
			const rule = this.folderRules[folderPath];
			if (rule && rule.inheritFromAncestors === false) {
				inheritanceBarrierLevel = i;
				break;  // Found the deepest barrier, stop looking
			}
		}

		// Collect all applicable rules, respecting the inheritance barrier
		for (let i = 0; i <= pathParts.length; i++) {
			const ancestorPath = i === 0 ? '' : pathParts.slice(0, i).join('/');
			const rule = this.folderRules[ancestorPath];

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

		// Note: Protected tags are NOT filtered during application - they CAN be added.
		// Protection only applies to removal (see removeAutoTagsFromFile and removeTagsFromFile).
		await this.applyFrontmatterTags(filePath, tags);

		// Track the tags we applied - MERGE with existing tracking, don't replace
		const existingTracking = this.tagTracking[filePath];
		const existingAutoTags = existingTracking?.autoTags || [];
		const mergedAutoTags = [...new Set([...existingAutoTags, ...tags])];

		this.tagTracking[filePath] = {
			autoTags: mergedAutoTags,
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

				// Restore tracking if we have it saved from the operation
				if (fileState.trackingBefore && fileState.trackingBefore.length > 0) {
					// Restore the tracking that was saved before the revert
					this.tagTracking[fileState.path] = {
						autoTags: [...fileState.trackingBefore],
						lastUpdated: new Date().toISOString()
					};
				} else {
					// Legacy behavior: Update tracking if we're reverting to having no auto-tags
					const trackedAutoTags = this.tagTracking[fileState.path]?.autoTags || [];
					const restoredHasAutoTags = trackedAutoTags.some(t => fileState.tagsBefore.includes(t));
					if (!restoredHasAutoTags) {
						delete this.tagTracking[fileState.path];
					}
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
