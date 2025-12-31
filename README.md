# TagForge

Automatic hierarchical tag management for Obsidian based on folder structure.

TagForge helps you maintain consistent tagging across your vault by automatically applying tags based on where files are located. Perfect for users building "external brain" systems who need reliable, automatic organization for graph view filtering and file discovery.

## Features

### Auto-Tagging
- **Automatic tagging on file creation** - New files are tagged based on their folder location
- **Hierarchical inheritance** - Files inherit tags from ancestor folders (configurable depth)
- **Move detection** - When files are moved, choose to retag, keep current tags, or undo the move

### Bulk Operations
- **Bulk add to entire vault** - Apply folder-based tags to all existing files
- **Bulk add to specific folder** - Target a folder and optionally include subdirectories
- **Preview before applying** - See exactly what changes will be made before committing

### Tag Management
- **Folder aliases** - Map folders to custom tag names (e.g., "Meeting Notes" → "meetings")
- **Protected tags** - Specify tags that TagForge should never touch
- **Ignored folders** - Exclude folders from auto-tagging (e.g., Templates, .obsidian)

### Undo & History
- **Operation history** - Last 50 operations are tracked
- **Undo any operation** - Revert individual tagging operations
- **Remove by date** - Remove auto-tags applied on a specific date
- **Remove by folder** - Remove auto-tags from a specific folder

### Utilities
- **Tag report dashboard** - View all TagForge-applied tags and manual tags in your vault
- **Validation checker** - Find and fix orphaned tracking, missing tags, and other issues

### Mobile Support
- Fully responsive UI for mobile devices
- Touch-friendly buttons and controls (44px minimum touch targets)
- Ribbon icons for quick access on mobile

## Installation

### From Obsidian Community Plugins (Recommended)
1. Open Obsidian Settings
2. Go to Community Plugins and disable Safe Mode
3. Click Browse and search for "TagForge"
4. Click Install, then Enable

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder called `tagforge` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into the `tagforge` folder
4. Reload Obsidian and enable the plugin in Community Plugins settings

## Usage

### Commands

Access these via the Command Palette (Ctrl/Cmd + P):

| Command | Description |
|---------|-------------|
| TAG: Manually tag current file | Apply folder-based tags to the active file |
| BULK ADD: Apply tags to entire vault | Tag all files based on folder structure |
| BULK ADD: Apply tags to specific folder | Tag files in a chosen folder |
| REMOVE: Remove all auto-applied tags | Revert all TagForge-applied tags |
| REMOVE: Remove auto-tags by date | Remove tags applied on a specific date |
| REMOVE: Remove auto-tags from specific folder | Remove tags from a chosen folder |
| REMOVE: Remove ALL tags from vault (nuclear) | Remove all tags (auto AND manual) |
| UNDO: Undo a recent tag operation | Revert a specific operation from history |
| REPORT: View tag report dashboard | See all tags in your vault |
| VALIDATE: Check for tag issues | Find and fix tracking problems |

### Settings

| Setting | Description |
|---------|-------------|
| Inheritance depth | How many folder levels to inherit tags from (default: 3) |
| Tag format | Store tags in frontmatter (default) or inline |
| When files are moved | Ask every time, always retag, or always keep current tags |
| Ignored folders | Folders to exclude from auto-tagging |
| Protected tags | Tags that TagForge should never modify |
| Folder aliases | Custom tag mappings for specific folders |

### How It Works

1. **Folder names become tags**: A file at `Health/Therapy/session.md` gets tags `#health` and `#therapy`
2. **Inheritance depth controls levels**: With depth 2, only the first 2 folder levels become tags
3. **Aliases override defaults**: If you alias "Meeting Notes" to "mtg", files get `#mtg` instead of `#meeting-notes`
4. **Tracking enables safe undo**: TagForge remembers which tags it applied, so it never touches your manual tags

## Configuration Examples

### Basic Setup
1. Set inheritance depth to 3
2. Add `Templates` and `.obsidian` to ignored folders
3. Enable auto-tagging

### With Folder Aliases
Map verbose folder names to cleaner tags:
- `Projects/Client Work` → `client`
- `Areas/Health & Wellness` → `health`
- `Resources/Reference Material` → `reference`

### Protected Tags
Add tags you manage manually that TagForge should ignore:
- `important`
- `favorite`
- `pinned`

## Compatibility

- **Obsidian version**: 1.0.0 or higher
- **Platforms**: Desktop (Windows, macOS, Linux) and Mobile (iOS, Android)
- **Obsidian Sync**: Fully compatible - enable "Plugin settings" in Sync to sync your tag tracking data

## Support

- **Issues & Feature Requests**: [GitHub Issues](https://github.com/bradsbitsandbytes/tagforge/issues)
- **Author**: [Brad's Bits and Bytes](https://bradsbitsandbytes.com)

## License

MIT License - see [LICENSE](LICENSE) for details.
