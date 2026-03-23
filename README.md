# Doors Mega Terminal

A floating multi-window terminal manager for builders. Run Claude Code across multiple projects simultaneously with workspace management, live agent monitoring, and a cockpit aesthetic.

![Cyan Cockpit theme](screenshots/spaceship-theme.png)

---

## What it does

DMT gives you a command center for your terminals. Launch multiple Claude Code sessions side-by-side, track what each agent is doing, get notified when it needs your input, and see git diffs without leaving the app.

**Core:**
- Multiple floating terminal windows per workspace, tiled or free-floating
- Workspaces with per-workspace accent colors
- Command center ledger showing all windows at a glance
- 3 themes: Cyan Cockpit, Classic (auto day/night), Hyperspace

**For Claude Code specifically:**
- Agent status detection: THINKING (blue pulse) / WRITING (purple pulse) / WAITING (yellow) / DONE
- Auto-detect needs-input: yellow border + sound when Claude is waiting for `[y/n]` or Enter
- Git worktree isolation: each window gets its own isolated copy of the repo
- Git diff panel: `G` to toggle, auto-refreshes when you switch windows
- Ask Claude: grab last 50 terminal lines and send to Claude panel
- Claude stop signal: snake animation + sound when Claude finishes
- Token/cost tracker per window with monthly budget bar

**Quality of life:**
- Keyword alerts with regex support — red flash border + sound
- Git branch shown per window in ledger
- Session restore
- Shortcut center (`` ` `` to toggle)

---

## Screenshots

| Cyan Cockpit | Classic | Hyperspace |
|---|---|---|
| ![](screenshots/spaceship-theme.png) | ![](screenshots/classic-theme.png) | ![](screenshots/hyperspace-theme.png) |

---

## Install

Download the latest DMG from [Releases](https://github.com/DoorsOfJanua/doors-mega-terminal/releases).

macOS arm64 only (Apple Silicon). Open DMG, drag to Applications.

> **Note:** The app is unsigned. On first launch: right-click → Open → Open anyway.

---

## Build from source

```bash
git clone https://github.com/DoorsOfJanua/doors-mega-terminal
cd doors-mega-terminal
npm install
npm start          # dev
npm run dist       # build DMG
```

Node 18+ required.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `` ` `` | Open/close Shortcut Center |
| `G` | Toggle git diff panel |
| `Cmd+N` | New window in current workspace |
| `Cmd+W` | Close focused window |
| `Cmd+T` | Tile windows (grid) |
| `Cmd+[` / `Cmd+]` | Previous / next window |
| `Cmd+L` | Toggle command center ledger |
| `Cmd+M` | Toggle task monitor |

Full list in the Shortcut Center (`` ` ``).

---

## Claude Code hooks

Add to `~/.claude/settings.json` to get the stop signal (snake animation + sound):

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "afplay /System/Library/Sounds/Glass.aiff 2>/dev/null; touch ~/.spaceship/.claude-done" }] }]
  }
}
```

---

## Version history

- **v0.3.0** — Git worktree isolation, agent status detection (THINKING/WRITING), git diff panel
- **v0.2.1** — Bug fixes: Ask Claude targeting, config write race, session restore resilience
- **v0.2.0** — Token/cost tracker, keyword alerts, git branch in ledger, session restore, per-workspace accent, auto-detect needs-input, Ask Claude
- **v0.1.0** — Initial release: 3 themes, workspace management, font control, tiling modes, task monitor, Claude stop signal

---

## License

MIT
