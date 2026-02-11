// src/types.ts
// All shared types, interfaces, and constants for TagForge

import { TFile } from 'obsidian';

// ============================================================================
// Settings
// ============================================================================

export interface TagForgeSettings {
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
// Tag Tracking
// ============================================================================

export interface TagTrackingEntry {
    autoTags: string[];
    lastUpdated: string;
}

// ============================================================================
// Folder Rules System (Phase 10 - Explicit Rules)
// ============================================================================

export interface FolderRule {
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

export interface OperationFileState {
    path: string;
    tagsBefore: string[];
    tagsAfter: string[];
    trackingBefore?: string[];  // Auto-tags that were tracked before the operation
}

export interface TagOperation {
    id: string;
    type: 'apply' | 'remove' | 'bulk' | 'move' | 'revert';
    description: string;
    timestamp: string;
    files: OperationFileState[];
}

// ============================================================================
// Data Structure
// ============================================================================

export interface TagForgeData {
    settings: TagForgeSettings;
    tagTracking: Record<string, TagTrackingEntry>;
    operationHistory: TagOperation[];
    folderRules: Record<string, FolderRule>;  // Phase 10: Explicit folder rules
}

// ============================================================================
// Validation (Phase 8)
// ============================================================================

export interface ValidationIssue {
    type: 'orphaned-tracking' | 'missing-tags' | 'ignored-path-tracked';
    filePath: string;
    description: string;
    tags?: string[];
}

// ============================================================================
// Bulk Preview (Phase 3+)
// ============================================================================

export interface EnhancedPreviewItem {
    file: TFile;
    currentTags: string[];        // All tags currently on the file
    autoTags: string[];           // Tags tracked by TagForge (subset of currentTags)
    folderTagsByLevel: string[][]; // Tags at each level: [[level1], [level2], ...]
}

// ============================================================================
// Move Confirmation (Phase 6)
// ============================================================================

export interface MoveConfirmationResult {
    action: 'continue' | 'leave' | 'cancel';
    remember: boolean;
}

export interface PendingMoveOperation {
    file: TFile;
    oldPath: string;
    oldFolder: string;
    newFolder: string;
}

export interface GroupedMoveResult {
    action: 'continue' | 'leave' | 'cancel';
    excludedPaths: Set<string>;  // Files to skip (user unchecked them)
    remember: boolean;
}

// ============================================================================
// Constants
// ============================================================================

export const WINDOWS_SYSTEM_FILES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);
export const MAX_HISTORY_SIZE = 50;
export const UNDO_FILE_DISPLAY_LIMIT = 40;

export const DEFAULT_SETTINGS: TagForgeSettings = {
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

export const DEFAULT_DATA: TagForgeData = {
    settings: DEFAULT_SETTINGS,
    tagTracking: {},
    operationHistory: [],
    folderRules: {},  // Phase 10: No rules by default - fully explicit
};
