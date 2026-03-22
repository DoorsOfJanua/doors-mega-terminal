# Feature Pack 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add token/cost tracking, keyword alerts, git branch display, session restore, per-workspace accent colors, auto-detect needs-input, and Ask Claude to the Spaceship Command Center Electron app.

**Architecture:** All terminal output processing (token parsing, keyword scanning, approval detection) is centralized in `renderer/terminal.js` via new callback params on `initTerminal`. UI integration lives in `renderer/main.js`. New IPC handler in `main.js` + `preload.js` for git-branch (uses `execFile` with array args — no shell injection risk). Config defaults in `config.js`.

**Tech Stack:** Electron, xterm.js, Vite (renderer bundler), Node.js (main process), vanilla JS, Jest (unit tests for config only)

**Spec:** `docs/superpowers/specs/2026-03-22-feature-pack-2-design.md`

---

## File Map

| File | Changes |
|------|---------|
| `renderer/terminal.js` | Extended `initTerminal` (6 params), token regex, approval/keyword scanning, `setKeywordRules`, `getLastLines` |
| `renderer/main.js` | Wire all new callbacks; all 7 feature UIs; async `saveSession`; RESTORE button |
| `renderer/index.html` | Approval CSS, budget bar CSS, accent CSS, RESTORE button HTML |
| `main.js` | `git-branch` IPC handler |
| `preload.js` | `scc.gitBranch` in contextBridge |
| `config.js` | New defaults: `tokenBudget`, `tokenMonth`, `tokenUsed`, `keywordAlerts` |
| `tests/config.test.js` | Tests for new config defaults |

---

## Task 1: terminal.js — Extended callbacks + token parsing + keyword scanning + getLastLines

**Files:**
- Modify: `renderer/terminal.js` (full replacement)

**Context:** `initTerminal` currently has 4 params. Extending to 6. Token regex parses Claude Code output format. `setKeywordRules` lets renderer push alert rules in. Approval patterns hardcoded always-on. `getLastLines` reads from xterm buffer.

- [ ] **Step 1: Replace the entire `renderer/terminal.js` with:**

```javascript
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const terminals = new Map();

const PROMPT_RE   = /[\$%#❯>]\s*$/m;
const TOKEN_RE_A  = /Tokens?:\s*([\d,]+)\s*input,\s*([\d,]+)\s*output/i;
const TOKEN_RE_B  = /Usage:\s*input=(\d+)\s+output=(\d+)/i;
const APPROVAL_RE = /(\[y\/n\]|\[Y\/n\]|\(y\/n\)|Press Enter|Continue\?|\?\s*$)/im;
const ANSI_RE     = /\x1B\[[0-9;]*[mGKHF]/g;

window.scc.onTermData(({ id, data }) => {
  const t = terminals.get(id);
  if (!t) return;
  t.term.write(data);

  t.outputLen  = (t.outputLen  || 0) + data.length;
  t.lastOutput = (t.lastOutput || '').slice(-500) + data;
  const clean  = t.lastOutput.replace(ANSI_RE, '');

  if (t.onStateChange && PROMPT_RE.test(t.lastOutput)) {
    if (t.outputLen > 50) t.onStateChange(id, 'done');
    t.lastOutput = '';
    t.outputLen  = 0;
  }

  if (t.onTokenData) {
    const mA = TOKEN_RE_A.exec(clean);
    const mB = !mA && TOKEN_RE_B.exec(clean);
    const m  = mA || mB;
    if (m) {
      const i = parseInt(m[1].replace(/,/g, ''), 10);
      const o = parseInt(m[2].replace(/,/g, ''), 10);
      if (!isNaN(i) && !isNaN(o)) t.onTokenData(id, { inputTokens: i, outputTokens: o });
    }
  }

  if (t.onKeywordMatch) {
    if (APPROVAL_RE.test(clean)) {
      const now = Date.now();
      if (!t._lastApproval || now - t._lastApproval > 3000) {
        t._lastApproval = now;
        t.onKeywordMatch(id, '__approval__');
      }
    }
    if (t.keywordRules) {
      for (const rule of t.keywordRules) {
        if (!rule.enabled) continue;
        try {
          const re = rule.regex
            ? new RegExp(rule.pattern, 'i')
            : new RegExp(rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          if (re.test(clean)) { t.onKeywordMatch(id, rule.pattern); break; }
        } catch (_) {}
      }
    }
  }
});

const DEFAULT_FONT_SIZE = 15;

function getTermTheme() {
  if (document.body.classList.contains('theme-classic')) {
    const light = window.matchMedia('(prefers-color-scheme: light)').matches;
    return light
      ? { background: '#ffffff', foreground: '#1c1c1e', cursor: '#007aff', selectionBackground: 'rgba(0,122,255,0.15)' }
      : { background: '#1c1c1e', foreground: '#f2f2f7', cursor: '#007aff', selectionBackground: 'rgba(0,122,255,0.2)' };
  }
  if (document.body.classList.contains('theme-hyperspace')) {
    return { background: '#0a0012', foreground: '#e0a0ff', cursor: '#ff00ff', selectionBackground: 'rgba(255,0,255,0.2)' };
  }
  return { background: '#000e1a', foreground: '#00ff88', cursor: '#00ffcc', selectionBackground: 'rgba(0,255,200,0.3)' };
}

export function refreshAllTermThemes() {
  const theme = getTermTheme();
  terminals.forEach(t => { t.term.options.theme = theme; });
}

export async function initTerminal(id, container, projectPath, onStateChange, onTokenData, onKeywordMatch) {
  const term = new Terminal({
    fontFamily: '"SF Mono", "Menlo", "Courier New", monospace',
    fontSize: DEFAULT_FONT_SIZE,
    theme: getTermTheme(),
    cursorBlink: true
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container);
  fit.fit();
  await window.scc.termSpawn(id, projectPath);
  window.scc.termResize(id, term.cols, term.rows);
  const resizeObserver = new ResizeObserver(() => {
    fit.fit();
    window.scc.termResize(id, term.cols, term.rows);
  });
  resizeObserver.observe(container);
  term.onData(data => {
    window.scc.termInput(id, data);
    const entry = terminals.get(id);
    if (entry) {
      entry.outputLen = 0;
      if (entry.onStateChange) entry.onStateChange(id, 'running');
    }
  });
  terminals.set(id, { term, fit, resizeObserver, onStateChange, onTokenData, onKeywordMatch, lastOutput: '', keywordRules: [] });
}

export function setKeywordRules(id, rules) {
  const t = terminals.get(id);
  if (t) t.keywordRules = rules || [];
}

export function getLastLines(id, n) {
  const t = terminals.get(id);
  if (!t) return [];
  const buf = t.term.buffer.active;
  const start = Math.max(0, buf.length - n);
  const lines = [];
  for (let i = start; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true).replace(ANSI_RE, ''));
  }
  return lines;
}

export function resizeTerminalFont(id, delta) {
  const t = terminals.get(id);
  if (!t) return;
  const newSize = Math.max(8, Math.min(32, t.term.options.fontSize + delta));
  t.term.options.fontSize = newSize;
  t.fit.fit();
  window.scc.termResize(id, t.term.cols, t.term.rows);
  return newSize;
}

export function sendTerminalInput(id, text) {
  window.scc.termInput(id, text);
}

export function destroyTerminal(id) {
  const t = terminals.get(id);
  if (!t) return;
  t.resizeObserver.disconnect();
  t.term.dispose();
  window.scc.termKill(id);
  terminals.delete(id);
}
```

- [ ] **Step 2: Start app: `npm run dev`. Verify it opens without console errors.**

- [ ] **Step 3: Commit**

```bash
git add renderer/terminal.js
git commit -m "feat: terminal.js — token parsing, keyword/approval scanning, getLastLines, setKeywordRules"
```

---

## Task 2: IPC — git-branch handler

**Files:**
- Modify: `main.js`
- Modify: `preload.js`

**Context:** Uses `execFile` with argument array (not `exec` with shell string) — safe from injection. Returns empty string on any error or non-git directory. Timeout 3s prevents hang.

- [ ] **Step 1: In `main.js`, add after the `dialog:pick-image` ipcMain.handle block:**

```javascript
ipcMain.handle('git-branch', async (_e, dirPath) => {
  if (!dirPath || typeof dirPath !== 'string') return '';
  return new Promise(resolve => {
    const { execFile } = require('child_process');
    // execFile with array args: safe, no shell injection
    execFile('git', ['-C', dirPath, 'branch', '--show-current'],
      { timeout: 3000 },
      (_err, stdout) => resolve((stdout || '').trim())
    );
  });
});
```

- [ ] **Step 2: In `preload.js`, add inside the `contextBridge.exposeInMainWorld('scc', {` block, after `onClaudeStop`:**

```javascript
  gitBranch: (dirPath) => ipcRenderer.invoke('git-branch', dirPath),
```

- [ ] **Step 3: Test from DevTools console:**

```javascript
window.scc.gitBranch('/Users/janua/Projects/spaceship-command-center').then(b => console.log('branch:', b))
// Expected: "branch: main"
window.scc.gitBranch('/tmp').then(b => console.log('non-git:', b))
// Expected: "non-git: "
```

- [ ] **Step 4: Commit**

```bash
git add main.js preload.js
git commit -m "feat: git-branch IPC handler + scc.gitBranch preload"
```

---

## Task 3: config.js — New default config fields + tests

**Files:**
- Modify: `config.js`
- Modify: `tests/config.test.js`

- [ ] **Step 1: In `config.js`, update `DEFAULT_CONFIG`:**

```javascript
const DEFAULT_CONFIG = {
  welcomeSeen: false,
  claudeShortcut: 'Ctrl+Shift+C',
  theme: 'cyan-cockpit',
  soundEnabled: true,
  projects: [],
  tokenBudget: 500,
  tokenMonth: '',
  tokenUsed: 0,
  keywordAlerts: [
    { pattern: 'error',  regex: false, enabled: true },
    { pattern: 'failed', regex: false, enabled: true },
    { pattern: 'fatal',  regex: false, enabled: true },
    { pattern: 'ENOENT', regex: false, enabled: true }
  ]
};
```

- [ ] **Step 2: In `tests/config.test.js`, add after the existing tests:**

```javascript
test('readConfig returns tokenBudget default 500', () => {
  expect(cfg.readConfig().tokenBudget).toBe(500);
});

test('readConfig returns keywordAlerts with 4 default rules', () => {
  const alerts = cfg.readConfig().keywordAlerts;
  expect(alerts).toHaveLength(4);
  expect(alerts[0].pattern).toBe('error');
  expect(alerts[0].enabled).toBe(true);
});

test('writeConfig persists tokenBudget', () => {
  cfg.writeConfig({ ...cfg.readConfig(), tokenBudget: 200 });
  expect(cfg.readConfig().tokenBudget).toBe(200);
});
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add config.js tests/config.test.js
git commit -m "feat: add tokenBudget, tokenMonth, tokenUsed, keywordAlerts config defaults + tests"
```

---

## Task 4: CSS — Approval state, alert state, budget bar, accent, Ask Claude button

**Files:**
- Modify: `renderer/index.html`

- [ ] **Step 1: In `renderer/index.html`, find the last snake CSS rule (around line 140):**
```css
body.no-snake .panel[data-snake="done"] { animation: none; ... }
```
Add immediately after it:

```css
        /* Approval state: yellow pulsing border */
        .panel[data-snake="approval"] {
            border: 2px solid #ffd60a !important;
            animation: approval-pulse 1s ease-in-out infinite;
            box-shadow: 0 0 12px rgba(255,214,10,0.7);
        }
        body.no-snake .panel[data-snake="approval"] { animation: none; box-shadow: none; }
        @keyframes approval-pulse {
            0%, 100% { box-shadow: 0 0 8px rgba(255,214,10,0.5); }
            50%       { box-shadow: 0 0 20px rgba(255,214,10,0.9); }
        }

        /* Alert state: red flashing border */
        .panel[data-snake="alert"] {
            border: 2px solid #ff453a !important;
            animation: alert-flash 0.5s ease-in-out infinite;
            box-shadow: 0 0 14px rgba(255,69,58,0.6);
        }
        body.no-snake .panel[data-snake="alert"] { animation: none; box-shadow: none; }
        @keyframes alert-flash {
            0%, 100% { box-shadow: 0 0 6px rgba(255,69,58,0.4); }
            50%       { box-shadow: 0 0 18px rgba(255,69,58,0.8); }
        }

        /* Task Monitor dots for new states */
        .tm-dot.approval { background: #ffd60a; box-shadow: 0 0 4px #ffd60a; }
        .tm-dot.alert    { background: #ff453a; box-shadow: 0 0 4px #ff453a; }

        /* Token budget bar in toolbar */
        .token-budget-wrap { display:flex; align-items:center; gap:4px; font-size:9px; color:var(--accent); opacity:0.7; padding:0 6px; }
        .token-budget-label { white-space:nowrap; letter-spacing:0.04em; }
        .token-budget-bar { width:60px; height:5px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden; }
        .token-budget-fill { height:100%; border-radius:3px; background:var(--accent); transition:width 0.3s ease; }
        .token-budget-fill.warn { background:#ff9f0a; }
        .token-budget-fill.over { background:#ff453a; }

        /* Per-workspace accent dot */
        .ws-accent-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; margin-left:4px; border:1px solid rgba(255,255,255,0.3); cursor:pointer; position:relative; }
        .ws-accent-dot.no-accent { background:transparent; }
        .accent-picker { position:absolute; top:100%; left:0; margin-top:4px; background:var(--panel-bg); border:1px solid var(--panel-border); border-radius:6px; padding:6px; display:none; flex-wrap:wrap; gap:4px; width:100px; z-index:9999; }
        .accent-picker.show { display:flex; }
        .accent-preset { width:16px; height:16px; border-radius:50%; cursor:pointer; border:1px solid rgba(255,255,255,0.2); transition:transform 0.1s; }
        .accent-preset:hover { transform:scale(1.2); }
        .accent-preset.clear { background:transparent !important; border:1px dashed rgba(255,255,255,0.4); }

        /* Ask Claude button in panel header */
        .ph-ask-btn { font-size:10px; padding:1px 5px; border-radius:3px; cursor:pointer; background:rgba(255,214,10,0.15); border:1px solid rgba(255,214,10,0.4); color:#ffd60a; font-family:var(--font-ui); transition:background 0.15s; }
        .ph-ask-btn:hover { background:rgba(255,214,10,0.3); }

        /* Ledger branch + cost */
        .lr-branch { font-size:9px; color:var(--accent); opacity:0.6; letter-spacing:0.04em; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .lr-cost   { font-size:9px; opacity:0.5; letter-spacing:0.04em; }
```

- [ ] **Step 2: Find the toolbar button row (around line 788). Add RESTORE button before the TASKS button:**

Find:
```html
                    <button class="tool-btn" id="taskMonitorBtn" title="Task Monitor">TASKS</button>
```
Replace with:
```html
                    <button class="tool-btn" id="restoreBtn" title="Restore last session">RESTORE</button>
                    <button class="tool-btn" id="taskMonitorBtn" title="Task Monitor">TASKS</button>
```

- [ ] **Step 3: `npm run dev`. Verify app opens with no CSS errors.**

- [ ] **Step 4: Commit**

```bash
git add renderer/index.html
git commit -m "feat: CSS for approval/alert states, budget bar, accent picker, ask claude btn"
```

---

## Task 5: Token/Cost Tracker — Wire onTokenData + per-window cost + budget bar

**Files:**
- Modify: `renderer/main.js`

**Context:** Wire the `onTokenData` callback. Store cost per window in `winTokens` Map. Maintain monthly total in `tokenUsed`. Display cost in ledger rows. Show monthly total vs budget bar in toolbar.

- [ ] **Step 1: Update the import at top of `renderer/main.js`:**

Find:
```javascript
import { initTerminal, destroyTerminal, resizeTerminalFont, refreshAllTermThemes, sendTerminalInput } from './terminal.js';
```
Replace with:
```javascript
import { initTerminal, destroyTerminal, resizeTerminalFont, refreshAllTermThemes, sendTerminalInput, setKeywordRules, getLastLines } from './terminal.js';
```

- [ ] **Step 2: Add token tracker globals after `const DONE_SOUNDS = [...]`:**

```javascript
const APPROVAL_SOUND = 'done-notification.wav';

// ── TOKEN TRACKER ─────────────────────────────────────────
const winTokens = new Map(); // id → { inputTokens, outputTokens, cost }
const winBranch = new Map(); // id → branch string (for Task 7)

const COST_RATES = {
  Haiku:  { in: 0.25,  out: 1.25  },
  Sonnet: { in: 3.0,   out: 15.0  },
  Opus:   { in: 15.0,  out: 75.0  }
};

function calcCost(inputTokens, outputTokens, model) {
  const r = COST_RATES[model] || COST_RATES.Sonnet;
  return (inputTokens / 1_000_000) * r.in + (outputTokens / 1_000_000) * r.out;
}

let tokenBudget = 500;
let tokenMonth  = '';
let tokenUsed   = 0;

function updateBudgetBar() {
  const wrap = document.getElementById('tokenBudgetWrap');
  if (!wrap) return;
  const fill  = wrap.querySelector('.token-budget-fill');
  const label = wrap.querySelector('.token-budget-label');
  const pct = tokenBudget > 0 ? Math.min(1, tokenUsed / tokenBudget) : 0;
  fill.style.width = (pct * 100).toFixed(1) + '%';
  fill.className = 'token-budget-fill' + (pct >= 1 ? ' over' : pct >= 0.8 ? ' warn' : '');
  label.textContent = '$' + tokenUsed.toFixed(2) + ' / $' + tokenBudget;
}

async function addTokenCost(winId, model, inputTokens, outputTokens) {
  const cost = calcCost(inputTokens, outputTokens, model);
  winTokens.set(winId, { inputTokens, outputTokens, cost });
  const nowMonth = new Date().toISOString().slice(0, 7);
  const cfg = await window.scc.readConfig();
  if ((cfg.tokenMonth || '') !== nowMonth) { tokenUsed = 0; tokenMonth = nowMonth; }
  else { tokenUsed = cfg.tokenUsed || 0; }
  tokenBudget = cfg.tokenBudget || 500;
  tokenUsed += cost;
  await window.scc.writeConfig({ ...cfg, tokenUsed, tokenMonth: nowMonth });
  updateBudgetBar();
  refreshLedger();
}

// ── KEYWORD ALERTS ────────────────────────────────────────
let keywordAlerts = [
  { pattern: 'error',  regex: false, enabled: true },
  { pattern: 'failed', regex: false, enabled: true },
  { pattern: 'fatal',  regex: false, enabled: true },
  { pattern: 'ENOENT', regex: false, enabled: true }
];
```

- [ ] **Step 3: In `mkWin`, find the `requestAnimationFrame(() => {` block that contains the `initTerminal` call (around line 456). The entire block currently reads `requestAnimationFrame(() => { initTerminal(...).catch(...); });`. Replace the inner `initTerminal(...).catch(...)` with the new 6-arg version, keeping the `requestAnimationFrame` wrapper. The result should be:**

```javascript
        requestAnimationFrame(() => {
        initTerminal(
            id, termContainer, path || '',
            (winId, snakeState) => {
                let targetWsIdx = null, targetWin = null;
                for (let i = 0; i < workspaces.length; i++) {
                    const wsWins = i === activeWsIdx ? wins : (workspaces[i]._wins || []);
                    const found = wsWins.find(w => w.id === winId);
                    if (found) { targetWsIdx = i; targetWin = found; break; }
                }
                if (!targetWin) return;
                targetWin.snakeState = snakeState;
                if (targetWin.element) targetWin.element.dataset.snake = snakeState;
                if (snakeState === 'done') {
                    playSound(DONE_SOUNDS[Math.floor(Math.random() * DONE_SOUNDS.length)], 0.55);
                    if (targetWsIdx !== null && targetWsIdx !== activeWsIdx) {
                        workspaces[targetWsIdx]._hasAlert = true;
                        renderWorkspaceTabs();
                    }
                    updateTaskMonitor();
                }
                if (snakeState === 'running') updateTaskMonitor();
            },
            (winId, { inputTokens, outputTokens }) => {
                const entry = getAllWinsWithWs().find(e => e.win.id === winId);
                const model = entry ? entry.win.model : 'Sonnet';
                addTokenCost(winId, model, inputTokens, outputTokens);
            },
            (winId, pattern) => {
                let targetWin = null;
                for (let i = 0; i < workspaces.length; i++) {
                    const wsWins = i === activeWsIdx ? wins : (workspaces[i]._wins || []);
                    const found = wsWins.find(w => w.id === winId);
                    if (found) { targetWin = found; break; }
                }
                if (!targetWin) return;
                if (pattern === '__approval__') {
                    targetWin.snakeState = 'approval';
                    if (targetWin.element) targetWin.element.dataset.snake = 'approval';
                    playSound(APPROVAL_SOUND, 0.7);
                    updateTaskMonitor();
                } else {
                    targetWin.snakeState = 'alert';
                    if (targetWin.element) {
                        targetWin.element.dataset.snake = 'alert';
                        clearTimeout(targetWin._alertTimer);
                        targetWin._alertTimer = setTimeout(() => {
                            if (targetWin.snakeState === 'alert') {
                                targetWin.snakeState = 'running';
                                if (targetWin.element) targetWin.element.dataset.snake = 'running';
                                updateTaskMonitor();
                            }
                        }, 8000);
                    }
                    playSound('done-notification.wav', 0.5);
                    updateTaskMonitor();
                }
            }
        ).then(() => {
            setKeywordRules(id, keywordAlerts);
        }).catch(err => console.error('[scc] terminal init failed for', id, err));
        }); // end requestAnimationFrame
```

- [ ] **Step 4: In `refreshLedger()`, after `const msg=document.createElement('div'); msg.className='lr-msg';` add:**

```javascript
        const costEl = document.createElement('div'); costEl.className = 'lr-cost';
        const tokenData = win ? winTokens.get(win.id) : null;
        setTxt(costEl, tokenData ? '$' + tokenData.cost.toFixed(4) : '');

        const branchEl = document.createElement('div'); branchEl.className = 'lr-branch';
        branchEl.id = 'lr-branch-' + (win ? win.id : proj.title.replace(/\W/g,'_'));
        setTxt(branchEl, win ? (winBranch.get(win.id) || '') : '');
```

Then find `row.append(status,name,msg,mwrap,actions)` and add the new elements:
```javascript
        row.append(status, name, branchEl, costEl, msg, mwrap, actions);
```

- [ ] **Step 5: In the init IIFE (`(async () => {`), after `currentConfig = cfg;`, add:**

```javascript
    tokenBudget = cfg.tokenBudget || 500;
    const _nowMonth = new Date().toISOString().slice(0, 7);
    tokenUsed = cfg.tokenMonth === _nowMonth ? (cfg.tokenUsed || 0) : 0;
    tokenMonth = _nowMonth;

    const _tasksBtn = document.getElementById('taskMonitorBtn');
    if (_tasksBtn) {
        const _bwrap = document.createElement('div');
        _bwrap.id = 'tokenBudgetWrap'; _bwrap.className = 'token-budget-wrap';
        _bwrap.title = 'Monthly API cost vs budget — click to set budget';
        const _blbl = document.createElement('div'); _blbl.className = 'token-budget-label';
        const _bbar = document.createElement('div'); _bbar.className = 'token-budget-bar';
        const _bfil = document.createElement('div'); _bfil.className = 'token-budget-fill';
        _bbar.appendChild(_bfil); _bwrap.append(_blbl, _bbar);
        _tasksBtn.parentNode.insertBefore(_bwrap, _tasksBtn);
        updateBudgetBar();
    }
```

- [ ] **Step 6: Load keyword alerts in the init block. After `if (cfg.shortcuts) Object.assign(shortcuts, cfg.shortcuts);`, add:**

```javascript
    if (cfg.keywordAlerts) keywordAlerts = cfg.keywordAlerts;
```

- [ ] **Step 7: `npm run dev`. The toolbar should show `$0.00 / $500` budget bar. Open a window, no console errors. Run a command in a Claude Code session to trigger a token line — cost should appear in the ledger.**

- [ ] **Step 8: Commit**

```bash
git add renderer/main.js
git commit -m "feat: token/cost tracker + keyword alerts wired — per-window cost, budget bar, approval/alert states"
```

---

## Task 6: Keyword Alerts Settings Panel

**Files:**
- Modify: `renderer/main.js`

**Context:** Settings panel in the settings dropdown. Shows current rules with toggles, add new rules, delete rules. Changes persisted to config and pushed to all open terminals.

- [ ] **Step 1: Add `openKeywordSettings()` and `saveKeywordAlerts()` functions in `renderer/main.js` (near other panel-open functions like `openShortcutCenter`):**

```javascript
function openKeywordSettings() {
    const existing = document.getElementById('kwSettingsOverlay');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div'); overlay.className = 'modal-overlay'; overlay.id = 'kwSettingsOverlay';
    const box = document.createElement('div'); box.className = 'modal-box';
    box.style.minWidth = '280px';

    const h3 = document.createElement('h3');
    h3.style.cssText = 'margin:0 0 12px;font-size:13px;letter-spacing:0.08em;';
    h3.textContent = 'Keyword Alerts';

    const list = document.createElement('div'); list.id = 'kwRuleList';

    function renderRules() {
        while (list.firstChild) list.removeChild(list.firstChild);
        keywordAlerts.forEach((rule, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
            const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = rule.enabled;
            chk.addEventListener('change', () => { rule.enabled = chk.checked; saveKeywordAlerts(); });
            const lbl = document.createElement('span');
            lbl.textContent = (rule.regex ? '/' : '') + rule.pattern + (rule.regex ? '/i' : '');
            lbl.style.cssText = 'flex:1;font-size:11px;font-family:monospace;';
            const del = document.createElement('button'); del.className = 'modal-btn'; del.textContent = '✕';
            del.style.cssText = 'padding:1px 6px;font-size:10px;';
            del.addEventListener('click', () => { keywordAlerts.splice(i, 1); saveKeywordAlerts(); renderRules(); });
            row.append(chk, lbl, del);
            list.appendChild(row);
        });
    }

    const addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;gap:6px;margin-top:10px;align-items:center;';
    const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'pattern';
    inp.style.cssText = 'flex:1;padding:4px 6px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:inherit;border-radius:3px;font-size:11px;';
    const regLbl = document.createElement('label'); regLbl.style.cssText = 'font-size:10px;display:flex;align-items:center;gap:3px;';
    const regChk = document.createElement('input'); regChk.type = 'checkbox';
    regLbl.append(regChk, 'regex');
    const addBtn = document.createElement('button'); addBtn.className = 'modal-btn'; addBtn.textContent = 'ADD';
    addBtn.addEventListener('click', () => {
        const p = inp.value.trim(); if (!p) return;
        keywordAlerts.push({ pattern: p, regex: regChk.checked, enabled: true });
        inp.value = ''; saveKeywordAlerts(); renderRules();
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
    addRow.append(inp, regLbl, addBtn);

    const closeBtn = document.createElement('button'); closeBtn.className = 'modal-btn'; closeBtn.textContent = 'CLOSE';
    closeBtn.style.marginTop = '12px';
    closeBtn.addEventListener('click', () => overlay.remove());

    box.append(h3, list, addRow, closeBtn);
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    renderRules();
}

async function saveKeywordAlerts() {
    const cfg = await window.scc.readConfig();
    await window.scc.writeConfig({ ...cfg, keywordAlerts });
    getAllWinsWithWs().forEach(({ win }) => setKeywordRules(win.id, keywordAlerts));
}
```

- [ ] **Step 2: Wire the keyword alerts button in the init IIFE. After the shortcut center button wiring (`document.getElementById('shortcutsBtn')?.addEventListener(...)`), add:**

```javascript
    const _kwBtn = document.createElement('button');
    _kwBtn.className = 'tdm-item'; _kwBtn.textContent = 'KEYWORD ALERTS';
    _kwBtn.addEventListener('click', () => {
        document.getElementById('settingsMenu')?.classList.remove('show');
        openKeywordSettings();
    });
    const _settingsMenu = document.getElementById('settingsMenu');
    const _guideBtn = document.getElementById('guideBtn');
    if (_settingsMenu && _guideBtn) _settingsMenu.insertBefore(_kwBtn, _guideBtn);
```

- [ ] **Step 3: Test keyword alerts. Open settings → KEYWORD ALERTS. Toggle "error" off, add a new pattern "DONE". Verify the rule list updates. Open a terminal, type `echo "fatal error"` — panel should flash red with a sound.**

- [ ] **Step 4: Commit**

```bash
git add renderer/main.js
git commit -m "feat: keyword alerts settings panel — add/toggle/delete rules, persisted and live-pushed to terminals"
```

---

## Task 7: Git Branch in Ledger

**Files:**
- Modify: `renderer/main.js`

**Context:** `winBranch` Map already declared in Task 5. `fetchBranch` calls `scc.gitBranch`. Called on window create and focus. Ledger branch element already added in Task 5.

- [ ] **Step 1: Add `fetchBranch` helper after the `mClass`/`nextModel` helpers:**

```javascript
async function fetchBranch(win) {
    if (!win || !win.path) return;
    const branch = await window.scc.gitBranch(win.path);
    const trimmed = (branch || '').slice(0, 20);
    winBranch.set(win.id, trimmed);
    const el = document.getElementById('lr-branch-' + win.id);
    if (el) setTxt(el, trimmed);
}
```

- [ ] **Step 2: In `mkWin`, after `wins.push(data);`, add:**

```javascript
    fetchBranch(data);
```

- [ ] **Step 3: Find the `function focus(win)` function in `renderer/main.js`. Add inside it (after existing logic):**

```javascript
    fetchBranch(win);
```

- [ ] **Step 4: `npm run dev`. Open a terminal in a git repo. The ledger row should show the branch name (e.g. `main`). Click into another window (focus it) — branch should refresh.**

- [ ] **Step 5: Commit**

```bash
git add renderer/main.js
git commit -m "feat: git branch display in ledger — refreshed on open and focus"
```

---

## Task 8: Session Restore — async saveSession + RESTORE button + _accent in saves

**Files:**
- Modify: `renderer/main.js`

- [ ] **Step 1: Replace `saveSession()` with the async version:**

Find the entire `function saveSession() {` block and replace it with:

```javascript
async function saveSession() {
    const cfg = await window.scc.readConfig();
    const session = workspaces.map((ws, i) => {
        const wsWins = (i === activeWsIdx) ? wins : (ws._wins || []);
        return {
            name: ws.name,
            _accent: ws._accent || null,
            projects: ws.projects.map(p => ({ title: p.title, path: p.path || '', model: p.model })),
            openWindows: wsWins.map(w => ({
                title: w.title, model: w.model, path: w.path || '',
                x: w.x, y: w.y, width: w.width, height: w.height,
                state: w.state, zIndex: w.zIndex
            }))
        };
    });
    await window.scc.writeConfig({
        ...cfg,
        workspaces: session.map(s => ({ name: s.name, projects: s.projects, _accent: s._accent })),
        session: { activeWorkspace: activeWsIdx, workspaceWindows: session.map(s => s.openWindows) }
    });
}
```

- [ ] **Step 2: Make the `onAppClosing` handler async:**

Find:
```javascript
window.scc.onAppClosing(() => {
    saveSession();
});
```
Replace with:
```javascript
window.scc.onAppClosing(async () => {
    await saveSession();
});
```

- [ ] **Step 3: Update `saveWorkspaces()` to include `_accent`:**

Find inside `saveWorkspaces`:
```javascript
    cfg.workspaces = workspaces.map(ws => ({
        name: ws.name,
        projects: ws.projects.map(p => ({ title: p.title, path: p.path || '', model: p.model }))
    }));
```
Replace with:
```javascript
    cfg.workspaces = workspaces.map(ws => ({
        name: ws.name,
        _accent: ws._accent || null,
        projects: ws.projects.map(p => ({ title: p.title, path: p.path || '', model: p.model }))
    }));
```

- [ ] **Step 4: In the workspace loading section of the init block, preserve `_accent`:**

Find:
```javascript
        workspaces = cfg.workspaces.map(ws => ({
            name: ws.name,
            projects: ws.projects || [],
            _wins: []
        }));
```
Replace with:
```javascript
        workspaces = cfg.workspaces.map(ws => ({
            name: ws.name,
            _accent: ws._accent || null,
            projects: ws.projects || [],
            _wins: []
        }));
```

- [ ] **Step 5: Wire RESTORE button in init block (add after `taskMonitorBtn` event listener):**

```javascript
    document.getElementById('restoreBtn')?.addEventListener('click', async () => {
        // Read config fresh so we get the most recently saved session
        const latestCfg = await window.scc.readConfig();
        const savedSession = latestCfg.session;
        if (!savedSession?.workspaceWindows) return;
        const wsWins = savedSession.workspaceWindows[activeWsIdx] || [];
        wsWins.forEach(wCfg => {
            const proj = projects.find(p => p.title === wCfg.title);
            if (proj && !wins.find(w => w.title === wCfg.title)) {
                mkWin({
                    title: wCfg.title, model: wCfg.model,
                    path: wCfg.path || proj.path,
                    x: wCfg.x, y: wCfg.y,
                    width: wCfg.width, height: wCfg.height,
                    state: wCfg.state, zIndex: wCfg.zIndex
                });
            }
        });
        refreshLedger();
    });
```

- [ ] **Step 6: Test: open some windows, quit app, relaunch. Verify windows restore automatically. Click RESTORE when no windows are open — they should come back.**

- [ ] **Step 7: Commit**

```bash
git add renderer/main.js
git commit -m "feat: async saveSession (readConfig fresh), RESTORE button, _accent persisted in both save functions"
```

---

## Task 9: Per-Workspace Accent

**Files:**
- Modify: `renderer/main.js`

- [ ] **Step 1: Add accent helpers after the token tracker block:**

```javascript
// ── PER-WORKSPACE ACCENT ─────────────────────────────────
const ACCENT_PRESETS = ['#00ff88','#007aff','#ff2d55','#ff9f0a','#30d158','#ff00ff','#5ac8fa','#ffd60a'];

function hexToRgba(hex, a) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
}

function applyWorkspaceAccent(hex) {
    const root = document.documentElement;
    if (!hex) {
        root.style.removeProperty('--accent');
        root.style.removeProperty('--accent-glow');
        root.style.removeProperty('--accent-dim');
        root.style.removeProperty('--accent-faint');
        return;
    }
    root.style.setProperty('--accent',       hex);
    root.style.setProperty('--accent-glow',  hexToRgba(hex, 0.55));
    root.style.setProperty('--accent-dim',   hexToRgba(hex, 0.20));
    root.style.setProperty('--accent-faint', hexToRgba(hex, 0.07));
}
```

- [ ] **Step 2: In `switchWorkspace(idx)`, after the `renderWorkspaceTabs()` call, add:**

```javascript
    applyWorkspaceAccent(workspaces[idx]._accent || null);
```

- [ ] **Step 3: In `renderWorkspaceTabs()`, after `tab.appendChild(nameSpan)`, add the accent dot:**

```javascript
        const accentDot = document.createElement('div');
        accentDot.className = 'ws-accent-dot' + (ws._accent ? '' : ' no-accent');
        accentDot.style.background = ws._accent || 'transparent';
        accentDot.title = 'Set accent color';
        const accentPicker = document.createElement('div');
        accentPicker.className = 'accent-picker';
        ACCENT_PRESETS.forEach(color => {
            const sw = document.createElement('div');
            sw.className = 'accent-preset'; sw.style.background = color; sw.title = color;
            sw.addEventListener('click', ev => {
                ev.stopPropagation();
                ws._accent = color;
                if (i === activeWsIdx) applyWorkspaceAccent(color);
                accentPicker.classList.remove('show');
                renderWorkspaceTabs(); saveWorkspaces();
            });
            accentPicker.appendChild(sw);
        });
        const clearSw = document.createElement('div');
        clearSw.className = 'accent-preset clear'; clearSw.title = 'Theme default';
        clearSw.addEventListener('click', ev => {
            ev.stopPropagation();
            ws._accent = null;
            if (i === activeWsIdx) applyWorkspaceAccent(null);
            accentPicker.classList.remove('show');
            renderWorkspaceTabs(); saveWorkspaces();
        });
        accentPicker.appendChild(clearSw);
        accentDot.appendChild(accentPicker);
        accentDot.addEventListener('click', e => {
            e.stopPropagation();
            document.querySelectorAll('.accent-picker').forEach(p => p.classList.remove('show'));
            accentPicker.classList.toggle('show');
        });
        // Note: close-on-outside-click is handled by the global click handler that
        // closes all .accent-pickers. Add it once in init, not per-tab.
        tab.appendChild(accentDot);
```

- [ ] **Step 4: In the init block, after `renderWorkspaceTabs()`, apply active accent and wire the global picker close handler:**

```javascript
    applyWorkspaceAccent(workspaces[activeWsIdx]?._accent || null);
    // Close any open accent picker when clicking outside
    document.addEventListener('click', () => {
        document.querySelectorAll('.accent-picker.show').forEach(p => p.classList.remove('show'));
    });
```

- [ ] **Step 5: Test: click the dot on a workspace tab, pick a color. Verify CSS vars update immediately (accent color changes in UI). Switch workspaces — each should have independent accent. Quit and relaunch — accent persists.**

- [ ] **Step 6: Commit**

```bash
git add renderer/main.js
git commit -m "feat: per-workspace accent colors — inline picker, CSS var application, persistence"
```

---

## Task 10: Ask Claude button

**Files:**
- Modify: `renderer/main.js`

- [ ] **Step 1: In `mkWin`, find `const claudeBtn = document.createElement('button');` and add the Ask Claude button construction immediately after the `claudeBtn.addEventListener` block:**

```javascript
    const askBtn = document.createElement('button');
    askBtn.className = 'ph-ask-btn';
    askBtn.textContent = '?';
    askBtn.title = 'Ask Claude about this terminal output';
    askBtn.addEventListener('click', e => {
        e.stopPropagation();
        const lines = getLastLines(id, 50);
        const context = lines.filter(l => l.trim()).join('\n');
        const prompt = `Here is my terminal output:\n\n${context}\n\nWhat is happening?\n`;

        const allWins = getAllWinsWithWs().map(e => e.win);
        const claudeWin = allWins.find(w => w.id !== id && w.path === path);

        if (claudeWin) {
            focus(claudeWin);
            sendTerminalInput(claudeWin.id, prompt);
        } else {
            const newWin = mkWin({
                title: title + ' (claude)', model: 'Sonnet',
                path, x: x + 40, y: y + 40, width, height
            });
            // Wait for terminal to spawn, then start claude, then send prompt
            setTimeout(() => sendTerminalInput(newWin.id, 'claude\n'), 500);
            setTimeout(() => sendTerminalInput(newWin.id, prompt), 1500);
        }
    });
```

- [ ] **Step 2: Find `btns.append(claudeBtn, fontDn, fontUp, minBtn, maxBtn, closeBtn)` and add `askBtn`:**

```javascript
    btns.append(claudeBtn, askBtn, fontDn, fontUp, minBtn, maxBtn, closeBtn);
```

- [ ] **Step 3: Test: open a terminal, run some commands. Click `?`. Verify it sends the last lines to an existing Claude panel, or opens a new one and sends after delay.**

- [ ] **Step 4: Commit**

```bash
git add renderer/main.js
git commit -m "feat: Ask Claude button — grabs last 50 terminal lines and sends to Claude panel"
```

---

## Final: Version bump + dist

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update version in `package.json` to `"0.2.0"`**

- [ ] **Step 2: Build DMG**

```bash
npm run dist
```

Expected: dist/ contains the .dmg file, no build errors.

- [ ] **Step 3: Commit + tag**

```bash
git add package.json
git commit -m "chore: bump to v0.2.0 — Feature Pack 2"
git tag v0.2.0
git push && git push --tags
```
