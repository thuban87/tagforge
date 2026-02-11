import { Plugin, Notice, TFile, Platform } from 'obsidian';
import {
	TagForgeSettings, TagTrackingEntry, FolderRule,
	TagOperation, TagForgeData,
	DEFAULT_SETTINGS, DEFAULT_DATA,
} from './src/types';
import { UndoHistoryModal } from './src/modals/UndoHistoryModal';
import { TagReportModal } from './src/modals/TagReportModal';
import { TagForgeSettingTab } from './src/settings';

// Services
import { TagResolver } from './src/services/TagResolver';
import { TagIO } from './src/services/TagIO';
import { HistoryService } from './src/services/HistoryService';
import { ValidationService } from './src/services/ValidationService';
import { BulkOperations } from './src/services/BulkOperations';
import { RevertService } from './src/services/RevertService';
import { MoveHandler } from './src/services/MoveHandler';

// ============================================================================
// Main Plugin Class
// ============================================================================

export default class TagForgePlugin extends Plugin {
	// --- Data fields ---
	settings: TagForgeSettings;
	tagTracking: Record<string, TagTrackingEntry>;
	operationHistory: TagOperation[];
	folderRules: Record<string, FolderRule>;  // Phase 10: Explicit folder rules

	// --- Event handler debouncing ---
	pendingTimeouts: number[] = [];
	pendingFileOps: Map<string, number> = new Map();

	// --- Services ---
	tagResolver: TagResolver;
	tagIO: TagIO;
	historyService: HistoryService;
	validationService: ValidationService;
	bulkOperations: BulkOperations;
	revertService: RevertService;
	moveHandler: MoveHandler;

	async onload() {
		// Load settings and tag tracking data
		await this.loadSettings();

		// Initialize services (order matters — later services depend on earlier ones)
		this.tagResolver = new TagResolver(this);
		this.tagIO = new TagIO(this);
		this.historyService = new HistoryService(this);
		this.validationService = new ValidationService(this);
		this.bulkOperations = new BulkOperations(this);
		this.revertService = new RevertService(this);
		this.moveHandler = new MoveHandler(this);

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
			callback: () => this.revertService.revertAllAutoTags(),
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
					this.revertService.revertAllTagsNuclear();
				},
			});
		}

		// Date-filtered remove
		this.addCommand({
			id: 'revert-auto-tags-by-date',
			name: 'REMOVE: Remove auto-tags by date',
			callback: () => this.revertService.revertAutoTagsByDate(),
		});

		// Folder-specific remove
		this.addCommand({
			id: 'revert-auto-tags-by-folder',
			name: 'REMOVE: Remove auto-tags from specific folder',
			callback: () => this.revertService.revertAutoTagsByFolder(),
		});

		// Phase 3: Bulk operations
		this.addCommand({
			id: 'bulk-apply-tags',
			name: 'BULK ADD: Apply tags to entire vault (with preview)',
			callback: () => this.bulkOperations.bulkApplyTags(),
		});

		this.addCommand({
			id: 'bulk-apply-folder',
			name: 'BULK ADD: Apply tags to specific folder (with preview)',
			callback: () => this.bulkOperations.bulkApplyToFolder(),
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
			callback: () => this.validationService.validateTags(),
		});

		// Phase 9: Ribbon icons for mobile menu
		this.addRibbonIcon('history', 'TagForge: Undo', () => {
			this.showUndoHistory();
		});

		this.addRibbonIcon('tags', 'TagForge: Bulk Add to folder', () => {
			this.bulkOperations.bulkApplyToFolder();
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
							this.moveHandler.handleFileRename(file, oldPath);
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

		// Clean up move handler pending state
		this.moveHandler.cleanup();
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
	// Thin Entry Points (delegate to services)
	// -------------------------------------------------------------------------

	/**
	 * Tag the currently active file based on folder rules.
	 */
	async tagCurrentFile() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('No active file');
			return;
		}

		// Get tags based on folder rules
		const tags = this.tagResolver.getRulesForPath(activeFile.path);
		if (tags.length === 0) {
			new Notice('No folder rules apply to this location');
			return;
		}

		// Capture state before
		const tagsBefore = await this.tagIO.getFileTags(activeFile);

		// Apply tags to the file
		await this.tagIO.applyTagsToFile(activeFile.path, tags);

		// Capture state after
		const tagsAfter = await this.tagIO.getFileTags(activeFile);

		// Record the operation
		await this.historyService.recordOperation('apply', `Tagged ${activeFile.name}`, [{
			path: activeFile.path,
			tagsBefore,
			tagsAfter,
		}]);

		new Notice(`Applied tags: ${tags.map(t => '#' + t).join(', ')}`);
	}

	/**
	 * Handle auto-tagging when a new file is created.
	 */
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
		const tags = this.tagResolver.getRulesForPath(file.path);
		if (tags.length === 0) {
			// No rules apply to this file - do nothing (fully explicit system)
			return;
		}

		// Capture state before (new files have no tags)
		const tagsBefore: string[] = [];

		// Apply tags to the file
		await this.tagIO.applyTagsToFile(file.path, tags);

		// Capture state after
		const tagsAfter = await this.tagIO.getFileTags(file);

		// Record the operation
		await this.historyService.recordOperation('apply', `Auto-tagged ${file.name}`, [{
			path: file.path,
			tagsBefore,
			tagsAfter,
		}]);
	}

	// -------------------------------------------------------------------------
	// Modal Openers
	// -------------------------------------------------------------------------

	showUndoHistory() {
		if (this.operationHistory.length === 0) {
			new Notice('No operations to undo');
			return;
		}

		new UndoHistoryModal(this.app, this.operationHistory, async (operation) => {
			await this.historyService.undoOperation(operation);
		}).open();
	}

	showTagReport() {
		new TagReportModal(this.app, this).open();
	}

	// -------------------------------------------------------------------------
	// Utility
	// -------------------------------------------------------------------------

	getParentFolder(filePath: string): string {
		const parts = filePath.split(/[/\\]/);
		parts.pop(); // Remove filename
		return parts.join('/') || '';
	}
}
