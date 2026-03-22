# Feature Pack 2 - Design Spec

## Features

### 1. Token/Cost Tracker
Parse Claude Code token summary output from the terminal stream using regex. Sample Claude Code output format: `Tokens: 1,234 input, 567 output ($0.12)` or `Usage: input=1234 output=567`. Regex targets both formats; silently no-ops on no match (graceful degradation). Store `{ inputTokens, outputTokens, model }` per window. Calculate API-equivalent cost using model rates (Haiku: $0.25/$1.25 per MTok in/out, Sonnet: $3/$15, Opus: $15/$75). Show per-window cost in ledger. Global monthly total + user-set budget displayed in command center header with a usage bar. Budget stored in `cfg.tokenBudget` (default: $500). Monthly total resets on 1st of each month (tracked via `cfg.tokenMonth`).

### 2. Keyword Alerts
User defines keyword rules (string or regex) in settings panel. Terminal output scanned per-window on each chunk. On match: flash window border, play alert sound, mark window in Task Monitor with `'alert'` state. Rules stored in `cfg.keywordAlerts` array. Default rules: `["error", "failed", "fatal", "ENOENT"]`. Toggle per-rule. Alerts dismissible by clicking window.

### 3. Git Branch in Ledger
On window open and on focus, run `git -C <path> branch --show-current` via Electron IPC (new `scc.gitBranch(path)` handler). Handler validates `path` is a non-empty string before shelling out. Show branch name in ledger row between name and model. Refresh on window focus. Empty/no-git = no branch shown. Branch display truncated to 20 chars. Requires changes to both `main.js` (new `ipcMain.handle('git-branch', ...)`) and `preload.js` (new `scc.gitBranch: (path) => ipcRenderer.invoke('git-branch', path)` entry in contextBridge).

### 4. Session Restore
The app already has `saveSession()` in `renderer/main.js` which writes to `cfg.session` with shape `{ activeWorkspace: number, workspaceWindows: [[{ title, model, path, x, y, width, height, state, zIndex }]] }`. The app already hooks `window.scc.onAppClosing()` to call `saveSession()` before destroy. `saveSession()` must call `readConfig()` fresh at the start (not spread from the stale `currentConfig` which may not reflect config changes made after load, e.g. budget or keyword rules written during the session). Session restore reads `cfg.session` on launch. Scope of restore: only the active workspace's windows are restored (index `session.activeWorkspace`); this is intentional -- restoring background workspace windows requires them to be visible, which is deferred. Manual "RESTORE" button in toolbar triggers the same active-workspace-only restore path. The data key is `cfg.session` (not a new key).

### 5. Per-Workspace Accent
Each workspace stores optional `accent` hex color. When switching workspaces, apply accent by setting CSS vars on `document.documentElement`: `--accent`, `--accent-glow` (accent at 55% opacity), `--accent-dim` (accent at 20% opacity), `--accent-faint` (accent at 7% opacity). Clearing accent reverts all four to theme defaults. Workspace accent picker: small color dot in each tab, click opens inline picker with 8 preset colors. Saved in workspace object as `_accent`. Both `saveWorkspaces()` and `saveSession()` must be updated to include `_accent` in the persisted workspace shape: `{ name, projects: [...], _accent: ws._accent || null }`. Both functions write workspaces and would otherwise strip `_accent`.

### 6. Auto-Detect Needs-Input
Parse Claude Code output per-window for patterns: lines ending in `?`, `[y/n]`, `[Y/n]`, `(y/n)`, `Press Enter`, `Continue?`. When matched, set window snake state to `'approval'` (new state - yellow pulsing border; requires a CSS rule for `[data-snake="approval"]`). Show in Task Monitor with yellow dot. Play a distinct sound (different from done sound). Resets to `'running'` on any keyboard input to that terminal.

### 7. Ask Claude
Button in panel header (`?` icon). Grabs last 50 clean lines of terminal output via a new exported function `getLastLines(id, n)` added to `terminal.js`. This function reads from the xterm buffer: compute `start = Math.max(0, term.buffer.active.length - n)` to clamp against short buffers. For each line from `start` to `term.buffer.active.length`, call `term.buffer.active.getLine(i).translateToString(true)` (the boolean trims trailing whitespace). Strip remaining ANSI escape sequences with a regex and return an array of strings. Finds or opens another panel running Claude Code in same directory. Sends pre-filled message: `Here is my terminal output:\n\n<last 50 lines>\n\nWhat is happening?` via `sendTerminalInput`. If no Claude panel exists, opens one first then sends after 1500ms delay.

## Data Model Changes

```javascript
// cfg.tokenBudget: number (default 500)
// cfg.tokenMonth: "YYYY-MM" string
// cfg.tokenUsed: number (cumulative this month, API-$ equivalent)
// cfg.keywordAlerts: [{ pattern: string, regex: bool, enabled: bool }]
// cfg.session: existing key -- { activeWorkspace: number, workspaceWindows: [[{ title, model, path, x, y, width, height, state, zIndex }]] }
// workspace._accent: string | null (must be persisted by saveWorkspaces())
```

## Architecture Notes
- Token parsing + keyword scanning: extend `initTerminal()` signature to `initTerminal(id, container, projectPath, onStateChange, onTokenData, onKeywordMatch)`. Both new callbacks are optional (check before calling). `onTokenData(id, { inputTokens, outputTokens })` fires in the pty output handler when token regex matches. `onKeywordMatch(id, pattern)` fires when a keyword rule matches. The call site in `renderer/main.js` (currently 4 args at line 457) must pass the two new callbacks.
- Git branch lookup: new `ipcMain.handle('git-branch', ...)` in `main.js` + new `scc.gitBranch` in `preload.js` contextBridge
- Session save: already wired via `window.scc.onAppClosing()` → `saveSession()` in renderer; no main.js changes needed. `saveSession()` must become `async` and call `await readConfig()` first before writing. The `onAppClosing` registration becomes `window.scc.onAppClosing(async () => { await saveSession(); })`. The main process gives 2800ms before `mainWindow.destroy()` -- sufficient for one `readConfig` + `writeConfig` round-trip.
- Approval state: new `dataset.snake` value `'approval'`; requires CSS rule `[data-snake="approval"]` with yellow pulsing border
