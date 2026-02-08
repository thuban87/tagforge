---
tags:
  - projects
  - active
  - tagforge
  - documents
---
  ### Folder Rules System - Core Functionality
  - [x] Open Settings → Folder Rules → "Open Rules Manager" button works ✅ 2026-01-02
  - [x] Rules Manager modal displays with 2-column layout (folder tree left, editor right) ✅ 2026-01-02
  - [x] Folder tree shows all vault folders and is collapsible ✅ 2026-01-02
  - [x] Clicking a folder selects it and shows rule editor on right ✅ 2026-01-02
  - [x] Can create a new rule with static tags ✅ 2026-01-02
  - [x] Rule indicator (●) appears next to folders with rules ✅ 2026-01-02
  - [x] Can edit an existing rule ✅ 2026-01-02
  - [x] Can delete a rule ✅ 2026-01-02
  - [x] "Apply to existing files" button works and tags files correctly ✅ 2026-01-02

  ### Folder Rules - Tag Inheritance
  - [x] Rule with `applyDownLevels: 'all'` applies to all subfolders ✅ 2026-01-02
  - [x] Rule with specific levels (e.g., `[1, 2]`) only applies to those depths ✅ 2026-01-02
  - [ ] `inheritFromAncestors: true` combines parent rule tags
  - [ ] `inheritFromAncestors: false` ignores parent rules
  - [x] Multiple rules on nested folders stack additively ✅ 2026-01-02

  ### Folder Rules - Dynamic Folder Tags
  - [x] `folderTagLevels` setting derives tags from folder names at specified levels ✅ 2026-01-02
  - [x] Level 1 = first folder in path, Level 2 = second, etc. ✅ 2026-01-02
  - [x] Derived tags combine with static tags correctly ✅ 2026-01-02

  ### Folder Rules - Auto-Apply on File Creation
  - [x] Create new file in folder WITH rule + `applyToNewFiles: true` → tags applied ✅ 2026-01-02
  - [ ] Create new file in folder WITH rule + `applyToNewFiles: false` → no tags
  - [x] Create new file in folder WITHOUT rule → no tags applied ✅ 2026-01-02
  - [x] Created tags appear in frontmatter correctly ✅ 2026-01-02
  - [ ] Created tags are tracked in plugin data

  ### Bulk Add Modal - Save as Rule
  - [x] Bulk Add to folder shows "Folder Rule" section ✅ 2026-01-02
  - [x] "Save as folder rule" checkbox appears ✅ 2026-01-02
  - [x] Checking it reveals scope options ✅ 2026-01-02
  - [x] "This folder only" creates rule with appropriate applyDownLevels ✅ 2026-01-02
  - [x] "This folder + all subfolders" creates rule with `applyDownLevels: 'all'` ✅ 2026-01-02
  - [ ] Rule is saved and visible in Rules Manager after bulk add

  ### Bulk Edit Mode
  - [x] "Edit Existing Tags" button appears below file tree ✅ 2026-01-02
  - [x] Clicking enters edit mode (right controls greyed out) ✅ 2026-01-02
  - [ ] Auto-tags show as green chips with X buttons
  - [ ] Manual tags show as grey/locked chips (no X)
  - [x] Clicking X on auto-tag shows strikethrough (pending delete) ✅ 2026-01-02
  - [x] Clicking X again removes from deletion list ✅ 2026-01-02
  - [x] "Edit Manual Tags" button enables manual tag editing (with warning) ✅ 2026-01-02
  - [x] "Stop Editing" exits edit mode ✅ 2026-01-02
  - [x] Apply executes both additions AND deletions ✅ 2026-01-02
  - [x] Deleted tags removed from files correctly ✅ 2026-01-02
  - [ ] Tracking data updated after deletions

  ### Nuclear Option
  - [x] Nuclear option warns about deleting folder rules ✅ 2026-01-02
  - [x] After nuclear: all tags removed from files ✅ 2026-01-02
  - [x] After nuclear: tracking data cleared ✅ 2026-01-02
  - [ ] After nuclear: folderRules wiped (check in Rules Manager)

  ### Known Bug - X Button Folder Cleanup (Move Modal)
  - [x] Move a file to a new folder (creates folder) ✅ 2026-01-02
  - [x] Cancel via "Cancel" button → folder cleaned up ✅ 2026-01-02
  - [x] Move a file to a new folder again ✅ 2026-01-02
  - [x] Cancel via X button (top right) → folder cleaned up? ✅ 2026-01-02
  - [x] If ghost folder remains, note the behavior ✅ 2026-01-02

  ### General Regression Testing
  - [x] Manual tag command works (TAG: Manually tag current file) ✅ 2026-01-02
  - [x] Remove auto-tags command works ✅ 2026-01-02
  - [x] Undo functionality works ✅ 2026-01-02
  - [ ] Tag report dashboard displays correctly
  - [ ] Validation command runs without errors
  - [x] Ignore paths setting respected ✅ 2026-01-02
  - [ ] Protected tags not removed during operations

  ### Mobile/Responsive (if testing on mobile)
  - [ ] All modals display full-screen on mobile
  - [ ] Touch targets are adequately sized (44px+)
  - [ ] Ribbon icons appear and work
  - [ ] 2-column layout stacks vertically on narrow screens