# spaceship-command-center CLAUDE.md
# (GitHub repo: DoorsOfJanua/doors-mega-terminal)

## Project Purpose
Doors Mega Terminal — floating multi-window terminal manager for builders. Workspace management, snake animations, live snake game, 3 themes (Cyan Cockpit, Classic, Hyperspace), customizable theming.

## Key Architecture
- **main.js**: Electron main process — workspace CRUD, IPC handlers (pty spawn/resize/kill, config read/write, git-branch, dialog, claude-done watcher)
- **preload.js**: contextBridge (`window.scc.*`) — all renderer↔main communication
- **renderer/terminal.js**: xterm.js wrapper — 6-param `initTerminal`, token parsing, keyword/approval scanning, `getLastLines`, `setKeywordRules`
- **renderer/main.js**: All UI logic — workspaces, windows, ledger, task monitor, settings panels
- **renderer/index.html**: CSS + HTML shell
- **config.js**: Config read/write with defaults
- **pty-manager.js**: node-pty process management

## Current Version: v0.2.0

## Shipped Features (complete)

### v0.1.0 baseline
- 3 themes: Cyan Cockpit, Classic (auto day/night), Hyperspace
- Workspace management (add/rename/delete with confirmation)
- Font size control (8–32px)
- Shortcut Center modal (backtick toggle)
- Tiling modes: Grid / Horizontal / Vertical
- Cross-workspace tab glow + Task Monitor panel
- Claude stop signal detection (file watcher → snake animation + sound)
- Ledger: online/offline indicator, model sync, inline rename

### v0.2.0 — Feature Pack 2 (2026-03-22)
1. **Token/Cost Tracker**: parses Claude Code terminal output (`Tokens: N input, N output`), calculates API-equivalent cost (Haiku/Sonnet/Opus rates), per-window cost in ledger, monthly budget bar in toolbar with warn/over states
2. **Keyword Alerts**: settings panel (add/toggle/delete rules, regex support), scans terminal output, red flash border + sound, default rules: error/failed/fatal/ENOENT
3. **Git Branch in Ledger**: IPC via `execFile` (no shell injection), shown per window, refreshed on open and focus
4. **Session Restore**: async `saveSession` (reads config fresh), RESTORE button in toolbar, `_accent` persisted
5. **Per-Workspace Accent**: 8 preset colors, CSS var injection (`--accent`, `--accent-glow`, `--accent-dim`, `--accent-faint`), color dot per workspace tab
6. **Auto-Detect Needs-Input**: yellow pulsing border + distinct sound on `[y/n]`/`?`/`Press Enter`/`Continue?`, resets on keyboard input
7. **Ask Claude button**: grabs last 50 clean terminal lines, sends to existing Claude panel in same dir (or opens new one)

## NEXT TASKS
- [ ] Build v0.2.0 DMG (`npm run dist`)
- [ ] Write README for GitHub
- [ ] Attach DMG to GitHub Releases
- [ ] Add to Doors of Janua Apps page
- [ ] Consider renaming local folder `spaceship-command-center` → `doors-mega-terminal` (needs path migration)

## Deferred (explicitly acknowledged, don't build yet)
- Split pane (equivalent effort to all other features combined)
- Command history search (global across windows)
- Terminal tabs inside panel
- Broadcast mode
- Command macros
- Workspace layout presets

## Notes
- Tests: 14/14 passing (`npm test`)
- Git history clean, repo safe for public distribution
- Local path: `/Users/janua/Projects/spaceship-command-center`
- GitHub: `https://github.com/DoorsOfJanua/doors-mega-terminal`
