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

## Current Version: v0.2.1

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

### v0.2.1 — Bug Fix Patch (2026-03-22)
Codex audit identified 3 architectural bugs; all fixed same session. Patch maintains 39/39 test pass rate.
1. **Ask Claude targeting hardened**: now checks window title for "claude" substring, prevents injection into arbitrary terminals
2. **Config write race eliminated**: centralized `patchConfig()` queue serializes all writes (token tracker, session saver, settings, workspace handler), last-write-wins race fixed
3. **Session restore resilient**: uses `wCfg.path` as primary key, title as fallback. Works after window renames and duplicate titles

## NEXT TASKS

### Completed This Session
- [x] Multi-instance architecture (Option A) — DONE
- [x] Workspace naming UI (modal input with validation) — DONE
- [x] Right-click handler (event propagation fixed) — DONE
- [x] Dual-screen testing — DONE
- [x] All 39 tests passing post-implementation

### Immediate Next Steps (Release Path)
- [x] Build v0.2.0 DMG (`npm run dist`) — DONE
- [x] v0.2.1 bug fixes (Ask Claude targeting, config writes, session restore) — DONE, 39/39 tests, code pushed to main
- [ ] Write README for GitHub (setup, features, shortcuts, build instructions) — Sonnet
- [ ] Attach v0.2.1 DMG to GitHub Releases (mark as latest) — Haiku
- [ ] Add to Doors of Janua Apps page — Haiku
- [ ] Plan v0.3.0 roadmap (next features after bug fixes) — Opus
- [ ] Apple notarization (deferred, not blocking) — decide in v0.3 planning

### Knowledge Architecture (Research Weaving System)
- [ ] Run weaver textual pass on vault — identify textual links between research notes and project mentions — Sonnet, 15-30m
- [ ] Design semantic pass heuristics for weaver skill — map research topics to projects (memory architecture -> Luna/Sakshi, etc.) — Opus, 1h
- [ ] Implement "Related:" tagging protocol in research capture — manual connection layer, required step in capture workflow — Sonnet, 30m
- [ ] Extend /tasks skill to surface relevant research findings — integrate research discovery into task display — Sonnet, 2h

**Context**: Session identified that research in vault doesn't automatically connect to active tasks. Solution is two-pass linking: textual (weaver, automated) + semantic (manual tagging + future heuristics). Harvest: `/Users/janua/.claude/projects/-Users-janua/memory/harvests/2026-03-22-1936-knowledge-weaving.md`

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
