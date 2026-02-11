import { Plugin, Notice, TFile, Platform } from 'obsidian';
import {
	TagForgeSettings, TagTrackingEntry, FolderRule,
	TagOperation, TagForgeData,
	DEFAULT_SETTINGS, DEFAULT_DATA,
} from './src/types';
import { UndoHistoryModal } from './src/modals/UndoHistoryModal';
import { TagReportModal } from './src/modals/TagReportModal';
import { TagForgeMenuModal } from './src/modals/TagForgeMenuModal';
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
		await this.loadSettings();
		this.initializeServices();
		this.addSettingTab(new TagForgeSettingTab(this.app, this));
		this.registerCommands();
		this.registerRibbonIcons();
		this.registerEventHandlers();
	}

	// -------------------------------------------------------------------------
	// Initialization Helpers
	// -------------------------------------------------------------------------

	/** Initialize all service instances. Order matters — later services depend on earlier ones. */
	private initializeServices() {
		this.tagResolver = new TagResolver(this);
		this.tagIO = new TagIO(this);
		this.historyService = new HistoryService(this);
		this.validationService = new ValidationService(this);
		this.bulkOperations = new BulkOperations(this);
		this.revertService = new RevertService(this);
		this.moveHandler = new MoveHandler(this);
	}

	/** Register all plugin commands in the command palette. */
	private registerCommands() {
		this.addCommand({
			id: 'tagforge-menu',
			name: 'TagForge Menu',
			callback: () => new TagForgeMenuModal(this.app, this).open(),
		});

		this.addCommand({
			id: 'tag-current-file',
			name: 'TAG: Manually tag current file',
			callback: () => this.tagCurrentFile(),
		});

		this.addCommand({
			id: 'revert-all-auto-tags',
			name: 'REMOVE: Undo all TagForge-applied tags (keeps manual)',
			callback: () => this.revertService.revertAllAutoTags(),
		});

		// Nuclear remove — desktop only
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

		this.addCommand({
			id: 'revert-auto-tags-by-date',
			name: 'REMOVE: Remove auto-tags by date',
			callback: () => this.revertService.revertAutoTagsByDate(),
		});

		this.addCommand({
			id: 'revert-auto-tags-by-folder',
			name: 'REMOVE: Remove auto-tags from specific folder',
			callback: () => this.revertService.revertAutoTagsByFolder(),
		});

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

		this.addCommand({
			id: 'undo-operation',
			name: 'UNDO: Undo a recent tag operation',
			callback: () => this.showUndoHistory(),
		});

		this.addCommand({
			id: 'tag-report',
			name: 'REPORT: View tag report dashboard',
			callback: () => this.showTagReport(),
		});

		this.addCommand({
			id: 'validate-tags',
			name: 'VALIDATE: Check for tag issues',
			callback: () => this.validationService.validateTags(),
		});
	}

	/** Register ribbon icons for mobile/sidebar access. */
	private registerRibbonIcons() {
		this.addRibbonIcon('history', 'TagForge: Undo', () => {
			this.showUndoHistory();
		});

		this.addRibbonIcon('tags', 'TagForge: Bulk Add to folder', () => {
			this.bulkOperations.bulkApplyToFolder();
		});
	}

	/** Register vault event handlers (file create + rename/move). */
	private registerEventHandlers() {
		this.app.workspace.onLayoutReady(() => {
			// Watch for new file creation → auto-tag
			this.registerEvent(
				this.app.vault.on('create', (file) => {
					if (file instanceof TFile) {
						const existingTimeout = this.pendingFileOps.get(file.path);
						if (existingTimeout) {
							window.clearTimeout(existingTimeout);
							this.pendingTimeouts = this.pendingTimeouts.filter(id => id !== existingTimeout);
						}

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

			// Watch for file moves/renames → re-tag
			this.registerEvent(
				this.app.vault.on('rename', (file, oldPath) => {
					if (file instanceof TFile) {
						const existingTimeout = this.pendingFileOps.get(file.path);
						if (existingTimeout) {
							window.clearTimeout(existingTimeout);
							this.pendingTimeouts = this.pendingTimeouts.filter(id => id !== existingTimeout);
						}
						const oldPathTimeout = this.pendingFileOps.get(oldPath);
						if (oldPathTimeout) {
							window.clearTimeout(oldPathTimeout);
							this.pendingTimeouts = this.pendingTimeouts.filter(id => id !== oldPathTimeout);
							this.pendingFileOps.delete(oldPath);
						}

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
