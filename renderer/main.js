import { initTerminal, destroyTerminal, resizeTerminalFont, refreshAllTermThemes, sendTerminalInput, setKeywordRules, getLastLines } from './terminal.js';

// ── SOUND ─────────────────────────────────────────────────
const DONE_SOUNDS = ['done-boing.wav', 'done-notification.wav', 'done-coin.wav'];
const APPROVAL_SOUND = 'done-notification.wav';

// ── CONFIG WRITE QUEUE (prevents concurrent read-modify-write clobber) ────
let _cfgQ = Promise.resolve();
function patchConfig(patchFn) {
    _cfgQ = _cfgQ.then(async () => {
        const cfg = await window.scc.readConfig();
        await window.scc.writeConfig(patchFn(cfg));
    });
    return _cfgQ;
}

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
  if (!fill || !label) return;
  const pct = tokenBudget > 0 ? Math.min(1, tokenUsed / tokenBudget) : 0;
  fill.style.width = (pct * 100).toFixed(1) + '%';
  fill.className = 'token-budget-fill' + (pct >= 1 ? ' over' : pct >= 0.8 ? ' warn' : '');
  label.textContent = '$' + tokenUsed.toFixed(2) + ' / $' + tokenBudget;
}

async function addTokenCost(winId, model, inputTokens, outputTokens) {
  const cost = calcCost(inputTokens, outputTokens, model);
  winTokens.set(winId, { inputTokens, outputTokens, cost });
  const nowMonth = new Date().toISOString().slice(0, 7);
  // Accumulate in-memory first (JS single-threaded, no race within sync block)
  if (tokenMonth !== nowMonth) { tokenUsed = 0; tokenMonth = nowMonth; }
  tokenUsed += cost;
  const _month = nowMonth, _used = tokenUsed;
  await patchConfig(cfg => {
    tokenBudget = cfg.tokenBudget || 500;
    return { ...cfg, tokenUsed: _used, tokenMonth: _month };
  });
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

let soundEnabled = true;

function playSound(file, volume = 0.65) {
    if (!soundEnabled) return;
    try {
        const audio = new Audio(`file://${window.scc.assetsPath}/sounds/${file}`);
        audio.volume = volume;
        audio.play().catch(() => {});
    } catch (_) {}
}

// ── STARFIELD ─────────────────────────────────────────────
(() => {
    const c = document.getElementById('stars'), ctx = c.getContext('2d');
    const resize = () => { c.width = innerWidth; c.height = innerHeight; };
    resize(); addEventListener('resize', resize);

    const stars = Array.from({length:800}, () => ({
        x: Math.random()*innerWidth, y: Math.random()*innerHeight,
        r: Math.random()*1.3+0.1,
        b: Math.random()*0.5+0.2,
        p: Math.random()*Math.PI*2,
        s: 0.003+Math.random()*0.006,
        vx: (Math.random()-0.5)*0.04,
        vy: (Math.random()-0.5)*0.04
    }));

    (function draw() {
        ctx.clearRect(0,0,c.width,c.height);
        stars.forEach(s => {
            s.x += s.vx; s.y += s.vy; s.p += s.s;
            if (s.x < 0) s.x = c.width; if (s.x > c.width) s.x = 0;
            if (s.y < 0) s.y = c.height; if (s.y > c.height) s.y = 0;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
            ctx.fillStyle = `rgba(180,210,255,${s.b*(0.6+0.4*Math.sin(s.p))})`; ctx.fill();
        });
        requestAnimationFrame(draw);
    })();
})();

// ── THEME SYSTEM ──────────────────────────────────────────
const THEMES = ['spaceship', 'classic', 'hyperspace'];
const THEME_LABELS = { 'spaceship': 'SPACESHIP', 'classic': 'CLASSIC', 'hyperspace': 'HYPERSPACE' };

let currentTheme = 'spaceship';

// ── CLASSIC DAY/NIGHT ─────────────────────────────────────
// Light: 06:00-19:59. Dark: 20:00-05:59. Override: null=auto, true=light, false=dark
let classicDayNightOverride = null;

function applyClassicDayNight(forceLight) {
    if (!document.body.classList.contains('theme-classic')) {
        document.body.classList.remove('theme-classic-light');
        return;
    }
    let isLight;
    if (forceLight !== undefined) {
        classicDayNightOverride = forceLight;
        isLight = forceLight;
    } else if (classicDayNightOverride !== null) {
        isLight = classicDayNightOverride;
    } else {
        const h = new Date().getHours();
        isLight = h >= 6 && h < 20;
    }
    document.body.classList.toggle('theme-classic-light', isLight);
    const btn = document.getElementById('classicDayNightBtn');
    if (btn) btn.textContent = classicDayNightOverride === null ? 'AUTO' : (isLight ? 'LIGHT' : 'DARK');
}

function updateClassicDayNightRow() {
    const row = document.getElementById('classicDayNightRow');
    if (row) row.style.display = document.body.classList.contains('theme-classic') ? '' : 'none';
}

setInterval(() => { if (classicDayNightOverride === null) applyClassicDayNight(); }, 60_000);

function applyTheme(theme) {
    // Preserve non-theme classes (no-scanlines, no-snake, etc.)
    const keepClasses = [];
    document.body.classList.forEach(c => { if (!c.startsWith('theme-')) keepClasses.push(c); });
    document.body.className = keepClasses.join(' ');
    if (theme !== 'spaceship') {
        document.body.classList.add('theme-' + theme);
    }
    currentTheme = theme;
    // DMT background
    const ap = window.scc.assetsPath;
    if (theme === 'spaceship') {
        document.body.style.backgroundImage = `url('file://${ap}/images/backgrounds/falcon-cockpit-view.jpg')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
    } else if (theme === 'hyperspace') {
        document.body.style.backgroundImage = `url('file://${ap}/images/dmt-bg.jpg')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
    } else {
        document.body.style.backgroundImage = '';
        document.body.style.backgroundSize = '';
        document.body.style.backgroundPosition = '';
    }
    // Side panel backgrounds: only show images in spaceship/hyperspace, plain in classic
    const nL = document.getElementById('nanoLeft');
    const nR = document.getElementById('nanoRight');
    if (theme === 'classic') {
        nL.style.backgroundImage = 'none';
        nR.style.backgroundImage = 'none';
    } else {
        nL.style.backgroundImage = `url('file://${ap}/images/nano-left.jpg')`;
        nR.style.backgroundImage = `url('file://${ap}/images/nano-right.jpg')`;
    }
    // Switch panel animation mode per theme
    if (nanoControllers.nanoLeft && nanoControllers.nanoRight) {
        if (theme === 'hyperspace') {
            nanoControllers.nanoLeft.setMode('fractal');
            nanoControllers.nanoRight.setMode('fractal');
        } else if (theme === 'spaceship') {
            nanoControllers.nanoLeft.setMode('panel');
            nanoControllers.nanoRight.setMode('panel');
        } else {
            // classic: panels are plain, keep whatever mode but hide canvas
            nanoControllers.nanoLeft.setMode('panel');
            nanoControllers.nanoRight.setMode('panel');
        }
    }
    refreshAllTermThemes();
    applyClassicDayNight();
    updateClassicDayNightRow();
}

document.getElementById('soundBtn').addEventListener('click', async (e) => {
    e.stopPropagation();
    soundEnabled = !soundEnabled;
    appSettings.sounds = soundEnabled;
    document.getElementById('soundBtn').textContent = soundEnabled ? 'SFX ON' : 'SFX OFF';
    await saveAppSettings();
});

// ── DROPDOWN MENUS ──────────────────────────────────────
function toggleDropdown(menuId) {
    const menu = document.getElementById(menuId);
    const wasOpen = menu.classList.contains('open');
    // Close all dropdowns first
    document.querySelectorAll('.tool-dropdown-menu').forEach(m => m.classList.remove('open'));
    if (!wasOpen) menu.classList.add('open');
}

document.getElementById('settingsMenuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown('settingsMenu');
});

// ── CONFIG ───────────────────────────────────────────────
const SIZES = { S:{w:260,h:170}, M:{w:420,h:280}, L:{w:640,h:440} };

const MODELS = ['Haiku','Sonnet','Opus'];

// ── WORKSPACES ──────────────────────────────────────────
let workspaces  = [{ name: 'ALL', projects: [] }];
let activeWsIdx = 0;

// ── STATE ────────────────────────────────────────────────
let wins        = [];   // terminal windows for current workspace
let projects    = [];   // pointer to active workspace's project list
let zTop        = 10;
let idSeq       = 1;
let dragCtx     = null; // { type:'move'|'resize', data, handle, sx,sy,ox,oy,ow,oh }

// Each workspace stores: { name, projects:[], winIds:[] }
function syncProjects() { projects = workspaces[activeWsIdx]?.projects || []; }

// ── TASK MONITOR (hoisted to module scope so mkWin can call updateTaskMonitor) ──
let taskMonitorOpen = false;

function openTaskMonitor()  { taskMonitorOpen = true;  document.getElementById('taskMonitor').style.display = 'flex'; updateTaskMonitor(); }
function closeTaskMonitor() { taskMonitorOpen = false; document.getElementById('taskMonitor').style.display = 'none'; }

function getAllWinsWithWs() {
    const all = [];
    workspaces.forEach((ws, wsIdx) => {
        const wsWins = wsIdx === activeWsIdx ? wins : (ws._wins || []);
        wsWins.forEach(w => all.push({ win: w, wsIdx, wsName: ws.name }));
    });
    return all;
}

function updateTaskMonitor() {
    if (!taskMonitorOpen) return;
    const list = document.getElementById('taskMonitorList');
    while (list.firstChild) list.removeChild(list.firstChild);
    const all = getAllWinsWithWs();

    if (!all.length) {
        const empty = document.createElement('div'); empty.className = 'tm-empty';
        empty.textContent = 'No windows open';
        list.appendChild(empty);
        return;
    }

    all.forEach(({ win, wsIdx, wsName }) => {
        const state = win.snakeState || win.element?.dataset?.snake || 'running';
        const row  = document.createElement('div'); row.className = 'tm-row';
        const dot  = document.createElement('div'); dot.className = 'tm-dot ' + state;
        const info = document.createElement('div'); info.className = 'tm-info';
        const name = document.createElement('div'); name.className = 'tm-name';
        name.textContent = win.title || win.id;
        const ws = document.createElement('div'); ws.className = 'tm-ws';
        ws.textContent = wsName + (wsIdx === activeWsIdx ? ' (current)' : '');
        info.append(name, ws);
        row.append(dot, info);
        row.addEventListener('click', () => {
            switchWorkspace(wsIdx);
            closeTaskMonitor();
            const w = wins.find(w2 => w2.id === win.id);
            if (w) w.element.style.zIndex = ++zTop;
        });
        list.appendChild(row);
    });
}

function renderWorkspaceTabs() {
    const container = document.getElementById('workspaceTabs');
    while (container.firstChild) container.removeChild(container.firstChild);

    workspaces.forEach((ws, i) => {
        const tab = document.createElement('button');
        tab.className = 'ws-tab' + (i === activeWsIdx ? ' active' : '');
        if (ws._hasAlert) tab.classList.add('ws-alert');

        const nameSpan = document.createElement('span');
        nameSpan.textContent = ws.name;
        tab.appendChild(nameSpan);

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
        tab.appendChild(accentDot);

        if (workspaces.length > 1) {
            const closeX = document.createElement('button');
            closeX.className = 'ws-tab-close';
            closeX.textContent = '\u2715';
            closeX.title = 'Remove workspace';
            closeX.addEventListener('click', (e) => {
                e.stopPropagation();
                confirmRemoveWorkspace(i);
            });
            tab.appendChild(closeX);
        }

        tab.addEventListener('click', () => switchWorkspace(i));
        tab.addEventListener('dblclick', () => renameWorkspace(i));
        container.appendChild(tab);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'ws-tab-add';
    addBtn.textContent = '+';
    addBtn.title = 'New workspace';
    addBtn.addEventListener('click', addWorkspace);
    container.appendChild(addBtn);
}

function switchWorkspace(idx) {
    workspaces[idx]._hasAlert = false;
    // Hide current workspace's windows
    wins.forEach(w => { if (w.element) w.element.style.display = 'none'; });
    workspaces[activeWsIdx]._wins = wins;

    activeWsIdx = idx;
    wins = workspaces[idx]._wins || [];
    syncProjects();

    // Show this workspace's windows
    wins.forEach(w => { if (w.element) w.element.style.display = ''; });

    renderWorkspaceTabs();
    applyWorkspaceAccent(workspaces[idx]._accent || null);
    refreshLedger();
}

function addWorkspace() {
    const count = workspaces.length + 1;
    const name = 'WORKSPACE ' + count;
    workspaces.push({ name, projects: [], _wins: [] });
    switchWorkspace(workspaces.length - 1);
    saveWorkspaces();
    renderWorkspaceTabs();
}

function renameWorkspace(idx) {
    const tabs = document.querySelectorAll('.ws-tab');
    const tab = tabs[idx];
    if (!tab) return;
    tab.contentEditable = true;
    tab.focus();
    const range = document.createRange();
    range.selectNodeContents(tab);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const finish = () => {
        tab.contentEditable = false;
        const name = tab.textContent.trim();
        if (name) workspaces[idx].name = name;
        renderWorkspaceTabs();
        saveWorkspaces();
    };
    tab.addEventListener('blur', finish, { once: true });
    tab.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); tab.blur(); }
    }, { once: true });
}

function removeWorkspace(idx) {
    if (workspaces.length <= 1) return;
    // Kill all terminals in this workspace
    const wsWins = workspaces[idx]._wins || (idx === activeWsIdx ? wins : []);
    wsWins.forEach(w => { destroyTerminal(w.id); if (w.element) w.element.remove(); });
    workspaces.splice(idx, 1);
    if (activeWsIdx >= workspaces.length) activeWsIdx = workspaces.length - 1;
    wins = workspaces[activeWsIdx]._wins || [];
    syncProjects();
    renderWorkspaceTabs();
    refreshLedger();
    saveWorkspaces();
}

function confirmRemoveWorkspace(idx) {
    const modal = document.getElementById('wsDeleteModal');
    modal.style.display = 'flex';
    const cleanup = () => modal.removeEventListener('click', onBg);
    const onConfirm = () => { cleanup(); modal.style.display = 'none'; removeWorkspace(idx); };
    const onCancel  = () => { cleanup(); modal.style.display = 'none'; };
    const onBg      = (e) => { if (e.target === modal) onCancel(); };
    document.getElementById('wsDeleteConfirm').addEventListener('click', onConfirm, { once: true });
    document.getElementById('wsDeleteCancel').addEventListener('click', onCancel,  { once: true });
    modal.addEventListener('click', onBg, { once: true });
}

function saveWorkspaces() {
    const snapshot = workspaces.map(ws => ({
        name: ws.name,
        _accent: ws._accent || null,
        projects: ws.projects.map(p => ({ title: p.title, path: p.path || '', model: p.model, useWorktree: p.useWorktree || false }))
    }));
    return patchConfig(cfg => ({ ...cfg, workspaces: snapshot }));
}

// ── HELPERS ──────────────────────────────────────────────
function setTxt(el,v) { el.textContent = String(v); }
function mClass(m)    { return { Haiku:'haiku', Sonnet:'sonnet', Opus:'opus' }[m]||'sonnet'; }
function nextModel(m) { const i = MODELS.indexOf(m); return MODELS[(i+1)%MODELS.length]; }
async function fetchBranch(win) {
    if (!win || !win.path) return;
    const branch = await window.scc.gitBranch(win.path);
    const trimmed = (branch || '').slice(0, 20);
    winBranch.set(win.id, trimmed);
    const el = document.getElementById('lr-branch-' + win.id);
    if (el) setTxt(el, trimmed);
}

// ── CREATE WINDOW ────────────────────────────────────────
function mkWin(cfg) {
    const id     = cfg.id     || ('w'+(idSeq++));
    const title  = cfg.title  || 'Untitled';
    const model  = cfg.model  || 'Sonnet';
    const log    = cfg.logFile|| '';
    const path   = cfg.path   || '';
    const x      = cfg.x      ?? scatter();
    const y      = cfg.y      ?? scatter(true);
    const width  = cfg.width  || SIZES.M.w;
    const height = cfg.height || SIZES.M.h;
    const state  = cfg.state  || 'normal';
    const zi     = cfg.zIndex || (++zTop);

    const el = document.createElement('div');
    el.className = 'panel';
    el.id = id;
    el.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${zi}`;

    // Header
    const hdr = document.createElement('div'); hdr.className = 'panel-header';

    const dot = document.createElement('div'); dot.className = 'ph-dot';

    const titleEl = document.createElement('div'); titleEl.className = 'ph-title'; setTxt(titleEl, title);

    // Model badge — clickable
    const modelWrap = document.createElement('div'); modelWrap.style.position = 'relative';
    const modelBadge = document.createElement('div');
    modelBadge.className = 'ph-model ' + mClass(model);
    setTxt(modelBadge, model);

    const picker = document.createElement('div'); picker.className = 'model-picker';
    MODELS.forEach(m => {
        const btn = document.createElement('button');
        btn.className = 'mp-opt ' + mClass(m); setTxt(btn, m);
        btn.addEventListener('click', e => {
            e.stopPropagation();
            setModel(data, m);
            picker.classList.remove('show');
        });
        picker.appendChild(btn);
    });
    modelWrap.append(modelBadge, picker);

    modelBadge.addEventListener('click', e => {
        e.stopPropagation();
        document.querySelectorAll('.model-picker').forEach(p => p.classList.remove('show'));
        picker.classList.toggle('show');
    });

    // Claude button — types 'claude' + Enter into the terminal
    const claudeBtn = document.createElement('button');
    claudeBtn.className = 'pb claude-btn';
    claudeBtn.textContent = 'Claude';
    claudeBtn.title = 'Open Claude Code';
    claudeBtn.addEventListener('click', e => {
        e.stopPropagation();
        sendTerminalInput(id, 'claude\n');
    });

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
        const claudeWin = allWins.find(w => w.id !== id && w.path === path && /claude/i.test(w.title));

        if (claudeWin) {
            focus(claudeWin);
            sendTerminalInput(claudeWin.id, prompt);
        } else {
            const newWin = mkWin({
                title: title + ' (claude)', model: 'Sonnet',
                path, x: x + 40, y: y + 40, width, height
            });
            setTimeout(() => sendTerminalInput(newWin.id, 'claude\n'), 500);
            setTimeout(() => sendTerminalInput(newWin.id, prompt), 1500);
        }
    });

    const btns = document.createElement('div'); btns.className = 'ph-btns';
    const fontDn   = mkPB('−','pb font-dn','Smaller font');
    const fontUp   = mkPB('+','pb font-up','Bigger font');
    const minBtn   = mkPB('_','pb min','Minimise');
    const maxBtn   = mkPB('□','pb max','Fullscreen');
    const closeBtn = mkPB('✕','pb close','Close');
    btns.append(claudeBtn, askBtn, fontDn, fontUp, minBtn, maxBtn, closeBtn);
    hdr.append(dot, titleEl, modelWrap, btns);

    // Body
    const body    = document.createElement('div'); body.className = 'panel-body';

    // Footer
    const footer = document.createElement('div'); footer.className = 'panel-footer';
    const pathEl = document.createElement('div'); pathEl.className = 'pf-path'; setTxt(pathEl, '~/logs/'+(log||'—'));
    const dotEl  = document.createElement('div'); dotEl.className  = 'pf-dot no'; setTxt(dotEl, '●');
    footer.append(pathEl, dotEl);

    // Resize handles
    ['n','s','e','w','nw','ne','sw','se'].forEach(dir => {
        const h = document.createElement('div');
        h.className = `resize-handle rh-${dir}`;
        h.dataset.dir = dir;
        el.appendChild(h);
    });

    el.append(hdr, body, footer);
    if (state === 'minimized')  el.classList.add('minimized');
    if (state === 'fullscreen') applyFS(el, true);

    // Snake border: start in running state
    el.dataset.snake = 'running';

    document.body.appendChild(el);

    // Clear any existing children safely and mount terminal
    while (body.firstChild) body.removeChild(body.firstChild);
    const termContainer = document.createElement('div');
    termContainer.style.cssText = 'width:100%;height:100%;';
    body.appendChild(termContainer);

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
                    if (targetWin.element) targetWin.element.dataset.snake = 'alert';
                    clearTimeout(targetWin._alertTimer);
                    targetWin._alertTimer = setTimeout(() => {
                        if (targetWin.snakeState === 'alert') {
                            targetWin.snakeState = 'running';
                            if (targetWin.element) targetWin.element.dataset.snake = 'running';
                            updateTaskMonitor();
                        }
                    }, 8000);
                    playSound('done-notification.wav', 0.5);
                    updateTaskMonitor();
                }
            }
        ).then(() => {
            setKeywordRules(id, keywordAlerts);
        }).catch(err => console.error('[scc] terminal init failed for', id, err));
    }); // end requestAnimationFrame

    const data = {
        id, title, model, logFile:log, path,
        x, y, width, height, state, zIndex:zi,
        element:el, message:'', lastLines:cfg.lastLines||[], _sig:'',
    };
    wins.push(data);
    fetchBranch(data);
    bindWin(data);
    refreshLedger();
    return data;
}

function mkPB(lbl,cls,title) {
    const b=document.createElement('button'); b.className=cls; b.title=title; setTxt(b,lbl); return b;
}

function scatter(vert) {
    const n = wins.length;
    return vert ? 50 + (n%5)*28 : 50 + (n%7)*32;
}

// ── MODEL SWITCH ─────────────────────────────────────────
function setModel(data, model) {
    data.model = model;
    const badge = data.element.querySelector('.ph-model');
    badge.className = 'ph-model ' + mClass(model);
    setTxt(badge, model);
    // Send /model command to the terminal
    sendTerminalInput(data.id, '/model ' + model.toLowerCase() + '\n');
    // Update matching project entry
    const proj = projects.find(p => p.title === data.title);
    if (proj) proj.model = model;
    refreshLedger();
}

// ── WINDOW EVENTS ─────────────────────────────────────────
function bindWin(data) {
    const el  = data.element;
    const hdr = el.querySelector('.panel-header');

    // Move drag (header only)
    hdr.addEventListener('mousedown', e => {
        if (e.target.closest('.ph-btns') || e.target.closest('.model-picker') || e.target.closest('.ph-model')) return;
        focus(data);
        if (data.state === 'fullscreen') return;
        dragCtx = { type:'move', data, sx:e.clientX, sy:e.clientY, ox:data.x, oy:data.y };
        e.preventDefault();
    });

    // Double-click header → fullscreen
    hdr.addEventListener('dblclick', e => {
        if (e.target.closest('.ph-btns') || e.target.closest('.ph-model')) return;
        toggleFS(data);
    });

    el.addEventListener('mousedown', e => {
        // Resize handle
        const rh = e.target.closest('.resize-handle');
        if (rh) {
            focus(data);
            if (data.state !== 'normal') return;
            dragCtx = {
                type:'resize', data, handle:rh.dataset.dir,
                sx:e.clientX, sy:e.clientY,
                ox:data.x, oy:data.y, ow:data.width, oh:data.height,
            };
            e.preventDefault(); e.stopPropagation(); return;
        }
        focus(data);
    });

    el.querySelector('.pb.font-dn').addEventListener('click', e => { e.stopPropagation(); resizeTerminalFont(data.id, -2); });
    el.querySelector('.pb.font-up').addEventListener('click', e => { e.stopPropagation(); resizeTerminalFont(data.id, 2); });
    el.querySelector('.pb.min').addEventListener('click', e => { e.stopPropagation(); toggleMin(data); });
    el.querySelector('.pb.max').addEventListener('click', e => { e.stopPropagation(); toggleFS(data); });
    el.querySelector('.pb.close').addEventListener('click', e => { e.stopPropagation(); rmWin(data.id); });
}

function focus(data) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('focused'));
    data.element.classList.add('focused');
    data.zIndex = ++zTop; data.element.style.zIndex = data.zIndex;
    refreshLedger();
    fetchBranch(data);
}

function toggleMin(data) {
    if (data.state==='minimized') {
        data.state='normal'; data.element.classList.remove('minimized'); restoreGeo(data);
    } else {
        if (data.state==='fullscreen') applyFS(data.element,false);
        data.state='minimized'; data.element.classList.add('minimized');
    }
    refreshLedger();
}

function toggleFS(data) {
    if (data.state==='fullscreen') {
        data.state='normal'; applyFS(data.element,false); restoreGeo(data);
    } else {
        data.state='fullscreen'; data.element.classList.remove('minimized'); applyFS(data.element,true);
    }
    refreshLedger();
}

function applyFS(el, on) {
    if (on) {
        el.style.cssText += ';left:0;top:0;width:100vw;height:100vh;border-radius:0;z-index:500';
    } else {
        el.style.borderRadius=''; el.style.zIndex = zTop;
    }
}

function restoreGeo(data) {
    const s=data.element.style;
    s.left=data.x+'px'; s.top=data.y+'px'; s.width=data.width+'px'; s.height=data.height+'px';
}

function resizeWin(data, size) {
    if (size==='XL') { toggleFS(data); return; }
    if (data.state!=='normal') { if(data.state==='fullscreen')applyFS(data.element,false); data.element.classList.remove('minimized'); data.state='normal'; }
    data.width=SIZES[size].w; data.height=SIZES[size].h; restoreGeo(data);
}

function rmWin(id) {
    const idx=wins.findIndex(w=>w.id===id); if(idx<0) return;
    destroyTerminal(id);
    wins[idx].element.remove(); wins.splice(idx,1);
    refreshLedger();
}

// ── DRAG / RESIZE ─────────────────────────────────────────
const MIN_W=200, MIN_H=120;

document.addEventListener('mousemove', e => {
    if (!dragCtx) return;
    const dx = e.clientX-dragCtx.sx, dy = e.clientY-dragCtx.sy;

    if (dragCtx.type==='move') {
        dragCtx.data.element.style.left = (dragCtx.ox+dx)+'px';
        dragCtx.data.element.style.top  = (dragCtx.oy+dy)+'px';
    }

    if (dragCtx.type==='resize') {
        const { handle, ox, oy, ow, oh } = dragCtx;
        let nx=ox, ny=oy, nw=ow, nh=oh;

        if (handle.includes('e')) nw = Math.max(MIN_W, ow+dx);
        if (handle.includes('s')) nh = Math.max(MIN_H, oh+dy);
        if (handle.includes('w')) { nw=Math.max(MIN_W,ow-dx); nx=ox+ow-nw; }
        if (handle.includes('n')) { nh=Math.max(MIN_H,oh-dy); ny=oy+oh-nh; }

        const s = dragCtx.data.element.style;
        s.left=nx+'px'; s.top=ny+'px'; s.width=nw+'px'; s.height=nh+'px';
    }
});

document.addEventListener('mouseup', () => {
    if (!dragCtx) return;
    if (dragCtx.type==='move') {
        const el=dragCtx.data.element;
        dragCtx.data.x=parseInt(el.style.left)||0;
        dragCtx.data.y=parseInt(el.style.top)||0;
        if (dragCtx.data.state==='fullscreen') { dragCtx.data.state='normal'; applyFS(el,false); restoreGeo(dragCtx.data); }
    }
    if (dragCtx.type==='resize') {
        const d=dragCtx.data, el=d.element;
        d.x=parseInt(el.style.left)||0; d.y=parseInt(el.style.top)||0;
        d.width=parseInt(el.style.width)||MIN_W; d.height=parseInt(el.style.height)||MIN_H;
    }
    dragCtx=null;
});

// Close any open model picker or dropdown on outside click
document.addEventListener('click', () => {
    document.querySelectorAll('.model-picker').forEach(p => p.classList.remove('show'));
    document.querySelectorAll('.tool-dropdown-menu').forEach(m => m.classList.remove('open'));
});

// ── LOG RENDERING ─────────────────────────────────────────
function renderLines(data,lines) {
    const el=data.element.querySelector('.panel-content'); if(!el) return;
    while(el.firstChild) el.removeChild(el.firstChild);
    for (const line of lines) {
        const d=document.createElement('div'); d.className='log-line';
        if(/error|Error|ERROR/.test(line)) d.classList.add('error');
        else if(/warn|Warn|WARN/.test(line)) d.classList.add('warn');
        else if(/\binfo\b|INFO/.test(line)) d.classList.add('info');
        d.textContent=line; el.appendChild(d);
    }
    el.scrollTop=el.scrollHeight;
}

// ── LEDGER ────────────────────────────────────────────────
function refreshLedger() {
    const ledger=document.getElementById('ledger');
    while(ledger.firstChild) ledger.removeChild(ledger.firstChild);

    projects.forEach(proj => {
        const win = wins.find(w=>w.title===proj.title);

        const row=document.createElement('div');
        row.className='ledger-row'+(win&&win.element.classList.contains('focused')?' active':'');

        // Status
        const status=document.createElement('div');
        status.className='lr-status ' + (win ? 'online' : 'offline');
        setTxt(status, win ? 'ONLINE' : 'OFFLINE');

        // Name — double-click to rename
        const name=document.createElement('div'); name.className='lr-name'; setTxt(name,proj.title);
        name.title = 'Double-click to rename';
        name.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            name.contentEditable = true;
            name.focus();
            const range = document.createRange();
            range.selectNodeContents(name);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            const finish = () => {
                name.contentEditable = false;
                const newTitle = name.textContent.trim();
                if (newTitle) {
                    proj.title = newTitle;
                    if (win) win.title = newTitle;
                    if (win) {
                        const titleEl = win.element.querySelector('.ph-title');
                        if (titleEl) setTxt(titleEl, newTitle);
                    }
                    saveWorkspaces();
                }
                setTxt(name, proj.title);
            };
            name.addEventListener('blur', finish, { once: true });
            name.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); name.blur(); }
                if (ev.key === 'Escape') { name.textContent = proj.title; name.blur(); }
            }, { once: true });
        });

        // Last message
        const msg=document.createElement('div'); msg.className='lr-msg';
        setTxt(msg, win?win.message||'open':'click model to launch');

        const costEl = document.createElement('div'); costEl.className = 'lr-cost';
        const tokenData = win ? winTokens.get(win.id) : null;
        setTxt(costEl, tokenData ? '$' + tokenData.cost.toFixed(4) : '');

        const branchEl = document.createElement('div'); branchEl.className = 'lr-branch';
        branchEl.id = 'lr-branch-' + (win ? win.id : proj.title.replace(/\W/g,'_'));
        setTxt(branchEl, win ? (winBranch.get(win.id) || '') : '');

        // Model picker
        const mwrap=document.createElement('div'); mwrap.className='lr-model-wrap';
        const mbtn=document.createElement('button');
        mbtn.className='lr-model-btn '+mClass(proj.model);
        setTxt(mbtn,proj.model);

        const mpick=document.createElement('div'); mpick.className='model-picker';
        mpick.style.right='auto'; mpick.style.left='0';
        MODELS.forEach(m=>{
            const b=document.createElement('button'); b.className='mp-opt '+mClass(m); setTxt(b,m);
            b.addEventListener('click',e=>{
                e.stopPropagation();
                proj.model=m;
                mbtn.className='lr-model-btn '+mClass(m); setTxt(mbtn,m);
                if(win) setModel(win,m);
                mpick.classList.remove('show');
                // If no window open, opening one now
                if(!win) openProjectWindow(proj);
            });
            mpick.appendChild(b);
        });
        mwrap.append(mbtn,mpick);
        mbtn.addEventListener('click',e=>{
            e.stopPropagation();
            document.querySelectorAll('.model-picker').forEach(p=>p.classList.remove('show'));
            mpick.classList.toggle('show');
            // If offline and no window, hint to pick a model
        });

        // Size actions (only if window is open)
        const actions=document.createElement('div'); actions.className='lr-actions';
        if (win) {
            ['S','M','L','⛶'].forEach((lbl,si)=>{
                const b=document.createElement('button'); b.className='la-btn'; setTxt(b,lbl);
                b.addEventListener('click',e=>{
                    e.stopPropagation();
                    resizeWin(win,['S','M','L','XL'][si]);
                    focus(win);
                });
                actions.appendChild(b);
            });
            const cx=document.createElement('button'); cx.className='la-btn close'; setTxt(cx,'✕');
            cx.addEventListener('click',e=>{ e.stopPropagation(); rmWin(win.id); });
            actions.appendChild(cx);
        } else {
            // No window open — show OPEN button
            const openBtn=document.createElement('button'); openBtn.className='la-btn'; setTxt(openBtn,'OPEN');
            openBtn.addEventListener('click',e=>{ e.stopPropagation(); openProjectWindow(proj); });
            actions.appendChild(openBtn);
        }

        row.append(status, name, branchEl, costEl, msg, mwrap, actions);
        row.addEventListener('click',()=>{
            if(win){ if(win.state==='minimized') toggleMin(win); focus(win); }
            else openProjectWindow(proj);
        });
        ledger.appendChild(row);
    });
}

function openProjectWindow(proj) {
    const existing=wins.find(w=>w.title===proj.title);
    if(existing){ focus(existing); return; }
    const w=mkWin({
        title:proj.title, model:proj.model,
        logFile:proj.logFile, path:proj.path,
    });
    focus(w);
}

// ── TILE ──────────────────────────────────────────────────
function tileWindows(mode) {
    const visible = wins.filter(w => w.state !== 'minimized');
    const n = visible.length;
    if (!n) return;
    const PAD = 12, W = innerWidth, H = innerHeight - 240;

    if (mode === 'horizontal') {
        const cw = Math.floor((W - PAD * (n + 1)) / n);
        const ch = H - PAD * 2;
        visible.forEach((w, i) => {
            if (w.state === 'fullscreen') applyFS(w.element, false);
            w.state = 'normal';
            w.x = PAD + i * (cw + PAD); w.y = PAD;
            w.width = cw; w.height = ch;
            restoreGeo(w);
        });
    } else if (mode === 'vertical') {
        const cw = W - PAD * 2;
        const ch = Math.floor((H - PAD * (n + 1)) / n);
        visible.forEach((w, i) => {
            if (w.state === 'fullscreen') applyFS(w.element, false);
            w.state = 'normal';
            w.x = PAD; w.y = PAD + i * (ch + PAD);
            w.width = cw; w.height = ch;
            restoreGeo(w);
        });
    } else {
        // grid (default)
        const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
        const cw = Math.floor((W - PAD * (cols + 1)) / cols);
        const ch = Math.floor((H - PAD * (rows + 1)) / rows);
        visible.forEach((w, i) => {
            const col = i % cols, row = Math.floor(i / cols);
            if (w.state === 'fullscreen') applyFS(w.element, false);
            w.state = 'normal';
            w.x = PAD + col * (cw + PAD); w.y = PAD + row * (ch + PAD);
            w.width = cw; w.height = ch;
            restoreGeo(w);
        });
    }
}

document.getElementById('tileBtn').addEventListener('click', () => {
    tileWindows(appSettings.tileMode || 'grid');
});

document.getElementById('tileModeBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('tileModeMenu');
    const rect = e.currentTarget.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top  = (rect.top - 4) + 'px';
    menu.style.transform = 'translateY(-100%)';
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    menu.querySelectorAll('.tile-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === appSettings.tileMode);
    });
});

document.getElementById('tileModeMenu').addEventListener('click', async (e) => {
    const btn = e.target.closest('.tile-opt');
    if (!btn) return;
    appSettings.tileMode = btn.dataset.mode;
    document.getElementById('tileModeMenu').style.display = 'none';
    tileWindows(appSettings.tileMode);
    await saveAppSettings();
});

document.addEventListener('click', () => {
    const menu = document.getElementById('tileModeMenu');
    if (menu) menu.style.display = 'none';
});

// ── COMMAND CENTER TOGGLE ─────────────────────────────────
function toggleCmd() { document.getElementById('cmdBar').classList.toggle('collapsed'); }
document.getElementById('cmdHandle').addEventListener('click',toggleCmd);

// ── COMMAND CENTER FONT SIZE ─────────────────────────────
// Scales font/padding in the center ledger. Layout reflows naturally, no overflow.
let cmdFontSize = 12;
function applyCmdFont() {
    cmdFontSize = Math.max(8, Math.min(36, cmdFontSize));
    document.getElementById('cmdCenter').style.fontSize = cmdFontSize + 'px';
}
document.getElementById('cmdFontDn').addEventListener('click', () => {
    cmdFontSize--;
    applyCmdFont();
});
document.getElementById('cmdFontUp').addEventListener('click', () => {
    cmdFontSize++;
    applyCmdFont();
});

// ── QUICK TOOLBAR BUTTONS ────────────────────────────────
// Theme cycle
document.getElementById('quickThemeBtn').addEventListener('click', async () => {
    const idx = (THEMES.indexOf(currentTheme) + 1) % THEMES.length;
    applyTheme(THEMES[idx]);
    document.getElementById('quickThemeBtn').textContent = THEME_LABELS[THEMES[idx]];
    const cfg = await window.scc.readConfig();
    cfg.theme = THEMES[idx];
    await window.scc.writeConfig(cfg);
});

// Color cycle (cycles through current theme's accent colors)
let colorIdx = 0;
document.getElementById('quickColorBtn').addEventListener('click', () => {
    const colors = ACCENT_COLORS[currentTheme] || [];
    if (!colors.length) return;
    colorIdx = (colorIdx + 1) % colors.length;
    applyAccentColor(colors[colorIdx]);
    document.getElementById('quickColorBtn').textContent = colors[colorIdx].name;
});

// SFX toggle
document.getElementById('quickSfxBtn').addEventListener('click', async () => {
    soundEnabled = !soundEnabled;
    appSettings.sounds = soundEnabled;
    document.getElementById('quickSfxBtn').textContent = soundEnabled ? 'SFX' : 'MUTE';
    document.getElementById('soundBtn').textContent = soundEnabled ? 'SFX ON' : 'SFX OFF';
    await saveAppSettings();
});

// ── KEYBOARD ──────────────────────────────────────────────
// ── SHORTCUTS ─────────────────────────────────────────────
const DEFAULT_SHORTCUTS = {
    cmdToggle:  { display: 'Toggle Command Center', key: 'Backquote', mod: '' },
    claudeOpen: { display: 'Open Claude in panel',  key: 'C',         mod: 'Ctrl+Shift' },
};
let shortcuts = JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));

function matchShortcut(e, s) {
    if (!s) return false;
    return e.ctrlKey  === s.mod.includes('Ctrl')  &&
           e.shiftKey === s.mod.includes('Shift') &&
           e.altKey   === s.mod.includes('Alt')   &&
           e.code === s.key;
}

// ── SIDE PANEL TOGGLE ────────────────────────────────────
let sidePanelsVisible = true;
document.getElementById('togglePanelsBtn').addEventListener('click', () => {
    sidePanelsVisible = !sidePanelsVisible;
    document.querySelectorAll('.nano-side').forEach(el => {
        el.style.display = sidePanelsVisible ? '' : 'none';
    });
});

// ── BACKGROUND CYCLE ─────────────────────────────────────
const BG_LIST = [
    { file: null,                                    label: 'STARS' },
    { file: 'dmt-bg.jpg',                           label: 'DMT' },
    { file: 'backgrounds/falcon-cockpit-view.jpg',   label: 'FALCON VIEW' },
    { file: 'backgrounds/falcon-cockpit-leak.webp',  label: 'FALCON INT' },
    { file: 'backgrounds/falcon-controls.avif',      label: 'CONTROLS' },
    { file: 'backgrounds/falcon-switches.avif',      label: 'SWITCHES' },
    { file: 'backgrounds/falcon-panel-blue.avif',    label: 'BLUE PANEL' },
    { file: 'backgrounds/falcon-panel-red.avif',     label: 'RED PANEL' },
    { file: 'backgrounds/falcon-levers.avif',        label: 'LEVERS' },
];
let bgIdx = 0;
document.getElementById('bgCycleBtn').addEventListener('click', () => {
    bgIdx = (bgIdx + 1) % BG_LIST.length;
    const bg = BG_LIST[bgIdx];
    if (bg.file) {
        const ap = window.scc.assetsPath;
        document.body.style.backgroundImage = `url('file://${ap}/images/${bg.file}')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
    } else {
        document.body.style.backgroundImage = '';
        document.body.style.backgroundSize = '';
        document.body.style.backgroundPosition = '';
    }
    document.getElementById('bgCycleBtn').textContent = bg.label;
});

document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.isContentEditable) return;
    if (matchShortcut(e, shortcuts.cmdToggle))  { e.preventDefault(); toggleCmd(); return; }
    if (matchShortcut(e, shortcuts.claudeOpen)) {
        e.preventDefault();
        const focused = wins.find(w => w.element && w.element.classList.contains('focused'));
        if (focused) window.scc.termInput(focused.id, 'claude\n');
        return;
    }
    if (e.key === 'Escape') {
        wins.filter(w => w.state === 'fullscreen').forEach(w => toggleFS(w));
        if (typeof closeAbout === 'function') closeAbout();
        if (typeof closeShortcutCenter === 'function') closeShortcutCenter();
    }
});

// ── SHORTCUT CENTER ───────────────────────────────────────
function openShortcutCenter()  { renderShortcutList(); document.getElementById('shortcutCenter').style.display = 'flex'; }
function closeShortcutCenter() {
    const el = document.getElementById('shortcutCenter');
    if (el) el.style.display = 'none';
}

function formatShortcutDisplay(s) {
    const parts = [];
    if (s.mod.includes('Ctrl'))  parts.push('Ctrl');
    if (s.mod.includes('Shift')) parts.push('Shift');
    if (s.mod.includes('Alt'))   parts.push('Alt');
    const keyLabel = s.key === 'Backquote' ? '`' : s.key === 'Space' ? 'Space' : s.key;
    parts.push(keyLabel);
    return parts.join('+');
}

function renderShortcutList() {
    const list = document.getElementById('shortcutList');
    while (list.firstChild) list.removeChild(list.firstChild);
    Object.entries(shortcuts).forEach(([id, s]) => {
        const row = document.createElement('div'); row.className = 'shortcut-row';
        const label = document.createElement('span'); label.className = 'shortcut-label';
        label.textContent = s.display;
        const keyBtn = document.createElement('button'); keyBtn.className = 'shortcut-key';
        keyBtn.textContent = formatShortcutDisplay(s);
        keyBtn.addEventListener('click', () => captureShortcut(id, keyBtn));
        row.append(label, keyBtn);
        list.appendChild(row);
    });
}

function captureShortcut(id, btn) {
    btn.textContent = 'Press key...';
    btn.classList.add('capturing');
    const onKey = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') {
            btn.classList.remove('capturing');
            renderShortcutList();
            document.removeEventListener('keydown', onKey, true);
            return;
        }
        const mod = [e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt'].filter(Boolean).join('+');
        shortcuts[id] = { ...shortcuts[id], key: e.code, mod };
        document.removeEventListener('keydown', onKey, true);
        btn.classList.remove('capturing');
        saveShortcuts();
        renderShortcutList();
    };
    document.addEventListener('keydown', onKey, true);
}

async function saveShortcuts() {
    const cfg = await window.scc.readConfig();
    cfg.shortcuts = shortcuts;
    await window.scc.writeConfig(cfg);
}

document.getElementById('shortcutCenter').addEventListener('click', (e) => {
    if (e.target === document.getElementById('shortcutCenter')) closeShortcutCenter();
});
document.getElementById('shortcutClose').addEventListener('click', closeShortcutCenter);
document.getElementById('shortcutReset').addEventListener('click', async () => {
    shortcuts = JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
    await saveShortcuts(); renderShortcutList();
});
document.getElementById('shortcutsBtn').addEventListener('click', openShortcutCenter);

// ── KEYWORD ALERTS SETTINGS ───────────────────────────────
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

function saveKeywordAlerts() {
    const snapshot = keywordAlerts.slice();
    getAllWinsWithWs().forEach(({ win }) => setKeywordRules(win.id, snapshot));
    return patchConfig(cfg => ({ ...cfg, keywordAlerts: snapshot }));
}

{
    const _kwBtn = document.createElement('button');
    _kwBtn.className = 'tdm-item'; _kwBtn.textContent = 'KEYWORD ALERTS';
    _kwBtn.addEventListener('click', () => {
        document.getElementById('settingsMenu')?.classList.remove('show');
        openKeywordSettings();
    });
    const _settingsMenu = document.getElementById('settingsMenu');
    const _guideBtn = document.getElementById('guideBtn');
    if (_settingsMenu && _guideBtn) _settingsMenu.insertBefore(_kwBtn, _guideBtn);
}

// ── ADD PROJECT MODAL ─────────────────────────────────────
document.getElementById('addBtn').addEventListener('click',()=>{
    document.getElementById('modal').classList.add('show');
    setTimeout(()=>document.getElementById('mName').focus(),40);
});
document.getElementById('mCancel').addEventListener('click',closeModal);
document.getElementById('modal').addEventListener('click',e=>{ if(e.target===document.getElementById('modal')) closeModal(); });
document.getElementById('mOk').addEventListener('click',confirmModal);
document.getElementById('mName').addEventListener('keydown',e=>{ if(e.key==='Enter') confirmModal(); if(e.key==='Escape') closeModal(); });
document.getElementById('mBrowse').addEventListener('click', async () => {
    const folder = await window.scc.pickFolder();
    if (folder) {
        document.getElementById('mPath').value = folder;
        document.getElementById('mWorktree').checked = true;
        if (!document.getElementById('mName').value.trim()) {
            document.getElementById('mName').value = folder.split('/').pop();
        }
    }
});
document.getElementById('mPath').addEventListener('input', () => {
    if (!document.getElementById('mPath').value.trim())
        document.getElementById('mWorktree').checked = false;
});

// ── SHORTCUTS MODAL (static cheat sheet) ──────────────────
document.getElementById('shortcutsClose').addEventListener('click',()=>{
    document.getElementById('shortcutsModal').classList.remove('show');
});
document.getElementById('shortcutsModal').addEventListener('click',e=>{
    if(e.target===document.getElementById('shortcutsModal'))
        document.getElementById('shortcutsModal').classList.remove('show');
});

// ── APPEARANCE MODAL ─────────────────────────────────────
let appSettings = {
    scanlines: true, starfield: true, sounds: true, snake: true, nanoZones: true,
    fontFamily: "'SF Mono', 'Menlo', monospace", fontSize: 15,
    tileMode: 'grid'
};

document.getElementById('appearanceBtn').addEventListener('click', () => {
    openAppearance();
});
document.getElementById('appearanceClose').addEventListener('click', () => {
    document.getElementById('appearanceModal').classList.remove('show');
});
document.getElementById('appearanceModal').addEventListener('click', e => {
    if (e.target === document.getElementById('appearanceModal'))
        document.getElementById('appearanceModal').classList.remove('show');
});

function openAppearance() {
    // Sync theme buttons
    document.querySelectorAll('#themePicker .app-theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === currentTheme);
    });
    // Sync font
    document.getElementById('appFontFamily').value = appSettings.fontFamily;
    document.getElementById('appFontSize').value = appSettings.fontSize;
    updateFontPreview();
    // Sync toggles
    syncToggle('toggleScanlines', appSettings.scanlines);
    syncToggle('toggleStarfield', appSettings.starfield);
    syncToggle('toggleSounds', appSettings.sounds);
    syncToggle('toggleSnake', appSettings.snake);
    syncToggle('toggleNano', appSettings.nanoZones);

    document.getElementById('appearanceModal').classList.add('show');
}

function syncToggle(id, val) {
    document.getElementById(id).classList.toggle('on', val);
}

// Theme picker buttons
document.querySelectorAll('#themePicker .app-theme-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const theme = btn.dataset.theme;
        applyTheme(theme);
        document.querySelectorAll('#themePicker .app-theme-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const cfg = await window.scc.readConfig();
        cfg.theme = theme;
        await window.scc.writeConfig(cfg);
    });
});

// Font family
document.getElementById('appFontFamily').addEventListener('change', async (e) => {
    appSettings.fontFamily = e.target.value;
    updateFontPreview();
    applyAppFont();
    await saveAppSettings();
});

// Font size
document.getElementById('appFontSize').addEventListener('change', async (e) => {
    appSettings.fontSize = parseInt(e.target.value);
    updateFontPreview();
    applyAppFont();
    await saveAppSettings();
});

function updateFontPreview() {
    const preview = document.getElementById('fontPreview');
    preview.style.fontFamily = appSettings.fontFamily;
    preview.style.fontSize = appSettings.fontSize + 'px';
}

function applyAppFont() {
    // Update CSS custom property used by future terminals
    document.documentElement.style.setProperty('--font-mono', appSettings.fontFamily);
}

// Toggle handlers
function setupToggle(id, key, applyFn) {
    document.getElementById(id).addEventListener('click', async () => {
        appSettings[key] = !appSettings[key];
        syncToggle(id, appSettings[key]);
        if (applyFn) applyFn(appSettings[key]);
        await saveAppSettings();
    });
}

setupToggle('toggleScanlines', 'scanlines', (on) => {
    document.body.style.setProperty('--scanline-display', on ? 'block' : 'none');
    // Apply via class
    document.body.classList.toggle('no-scanlines', !on);
});

setupToggle('toggleStarfield', 'starfield', (on) => {
    const c = document.getElementById('stars');
    if (c) c.style.display = on ? '' : 'none';
});

setupToggle('toggleSounds', 'sounds', (on) => {
    soundEnabled = on;
    document.getElementById('soundBtn').textContent = on ? 'SFX ON' : 'SFX OFF';
});

setupToggle('toggleSnake', 'snake', () => {
    // snake CSS will check this via body class
    document.body.classList.toggle('no-snake', !appSettings.snake);
});

setupToggle('toggleNano', 'nanoZones', (on) => {
    document.querySelectorAll('.nano-side').forEach(el => {
        el.style.display = on ? '' : 'none';
    });
});

document.getElementById('classicDayNightBtn').addEventListener('click', () => {
    const isLight = document.body.classList.contains('theme-classic-light');
    applyClassicDayNight(!isLight);
});

function saveAppSettings() {
    const appearance = {
        fontFamily: appSettings.fontFamily,
        fontSize: appSettings.fontSize,
        scanlines: appSettings.scanlines,
        starfield: appSettings.starfield,
        sounds: appSettings.sounds,
        snake: appSettings.snake,
        nanoZones: appSettings.nanoZones,
        tileMode: appSettings.tileMode
    };
    return patchConfig(cfg => ({ ...cfg, appearance }));
}

// ── ABOUT MODAL ───────────────────────────────────────────
const ABOUT_JOKES = [
    'Why do developers prefer dark mode?\nLight attracts bugs.',
    'A QA engineer walks into a bar.\nOrders 0 beers. Orders 999999 beers. Orders -1 beers.',
    'git commit -m "fix"\ngit commit -m "fix2"\ngit commit -m "PLEASE WORK"',
    'It works on my machine.\n[ ships machine to client ]',
    'sudo make me a sandwich.\n-- Every developer at 2am',
    'There are 10 types of people:\nthose who get binary and those who do not.',
    'Senior dev tip:\nif it is stupid but it works, it is still stupid and you got lucky.',
    'The cloud is just someone else computer.\nAnd that computer is also someone else computer.'
];

const MANIFESTO =
    'Built for developers who run too many projects at once.\n' +
    'Because your terminal deserves to look like a cockpit.\n' +
    'Free forever. No VC. No ads. Just vibes and code.\n' +
    '-- Janua';

function openAbout() {
    document.getElementById('aboutJoke').textContent =
        ABOUT_JOKES[Math.floor(Math.random() * ABOUT_JOKES.length)];
    document.getElementById('aboutManifesto').textContent = MANIFESTO;
    document.getElementById('aboutModal').classList.add('show');
}

function closeAbout() {
    document.getElementById('aboutModal').classList.remove('show');
}

document.getElementById('aboutBtn').addEventListener('click', openAbout);
document.getElementById('aboutClose').addEventListener('click', closeAbout);
document.getElementById('aboutModal').addEventListener('click', e => {
    if (e.target === document.getElementById('aboutModal')) closeAbout();
});

// ── GUIDE MODAL ──────────────────────────────────────────
document.getElementById('guideBtn').addEventListener('click', () => {
    document.getElementById('guideModal').classList.add('show');
});
document.getElementById('guideClose').addEventListener('click', () => {
    document.getElementById('guideModal').classList.remove('show');
});
document.getElementById('guideModal').addEventListener('click', e => {
    if (e.target === document.getElementById('guideModal'))
        document.getElementById('guideModal').classList.remove('show');
});

// ── COLOR SYSTEM ─────────────────────────────────────────
// Parse hex to RGB, then derive all CSS variables from a single accent color
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return {r,g,b};
}
function applyAccentColor(c) {
    const {r,g,b} = hexToRgb(c.accent);
    const root = document.documentElement.style;
    root.setProperty('--accent', c.accent);
    root.setProperty('--accent-glow', c.glow);
    root.setProperty('--accent-dim', `rgba(${r},${g},${b},0.2)`);
    root.setProperty('--accent-faint', `rgba(${r},${g},${b},0.07)`);
    root.setProperty('--text', c.text);
    const tr = hexToRgb(c.text);
    root.setProperty('--text-dim', `rgba(${tr.r},${tr.g},${tr.b},0.55)`);
    root.setProperty('--text-faint', `rgba(${tr.r},${tr.g},${tr.b},0.28)`);
    root.setProperty('--glow', `0 0 18px rgba(${r},${g},${b},0.22)`);
    root.setProperty('--snake-color', c.accent);
    root.setProperty('--snake-glow', `rgba(${r},${g},${b},0.6)`);
}

const ACCENT_COLORS = {
    spaceship: [
        { name: 'CYAN',       accent: '#00ffff', glow: 'rgba(0,255,255,0.55)',   text: '#00e5ff' },
        { name: 'AMBER',      accent: '#ffb300', glow: 'rgba(255,179,0,0.55)',   text: '#ffc107' },
        { name: 'SOLARIZED',  accent: '#859900', glow: 'rgba(133,153,0,0.55)',   text: '#b5bd68' },
        { name: 'RED ALERT',  accent: '#ff3333', glow: 'rgba(255,51,51,0.55)',   text: '#ff6666' },
    ],
    classic: [
        { name: 'BLUE',   accent: '#007aff', glow: 'rgba(0,122,255,0.4)',  text: '#007aff' },
        { name: 'GREEN',  accent: '#34c759', glow: 'rgba(52,199,89,0.4)',  text: '#30d158' },
        { name: 'GRAY',   accent: '#8e8e93', glow: 'rgba(142,142,147,0.4)',text: '#8e8e93' },
    ],
    hyperspace: [
        { name: 'MAGENTA', accent: '#ff00ff', glow: 'rgba(255,0,255,0.55)', text: '#e8b0ff' },
        { name: 'PURPLE',  accent: '#8b5cf6', glow: 'rgba(139,92,246,0.55)',text: '#c4b5fd' },
        { name: 'CRIMSON', accent: '#ef4444', glow: 'rgba(239,68,68,0.55)', text: '#fca5a5' },
    ],
};

function buildColorSubmenu() {
    const sub = document.getElementById('colorSubmenu');
    while (sub.firstChild) sub.removeChild(sub.firstChild);
    const colors = ACCENT_COLORS[currentTheme] || [];
    colors.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'color-opt';
        btn.textContent = c.name;
        btn.style.borderLeft = '3px solid ' + c.accent;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            applyAccentColor(c);
            sub.classList.remove('open');
            document.querySelectorAll('.tool-dropdown-menu').forEach(m => m.classList.remove('open'));
        });
        sub.appendChild(btn);
    });
}

document.getElementById('colorBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    buildColorSubmenu();
    document.getElementById('colorSubmenu').classList.toggle('open');
});

async function confirmModal() {
    const name = document.getElementById('mName').value.trim();
    if (!name) { document.getElementById('mName').focus(); return; }
    const projPath = document.getElementById('mPath').value.trim();
    const proj = {
        title:      name,
        model:      document.getElementById('mModel').value,
        logFile:    document.getElementById('mLog').value.trim(),
        path:       projPath,
        useWorktree: document.getElementById('mWorktree').checked && !!projPath,
    };
    projects.push(proj);
    await openProjectWindow(proj);
    closeModal();
    saveWorkspaces();
}

function closeModal(){
    document.getElementById('modal').classList.remove('show');
    ['mName','mLog','mPath'].forEach(id=>{ document.getElementById(id).value=''; });
    document.getElementById('mWorktree').checked = false;
}

// Apply nano background image from CSS variable
(() => {
    const nanoBg = getComputedStyle(document.documentElement).getPropertyValue('--nano-bg').trim();
    if (nanoBg && nanoBg !== 'none') {
        document.getElementById('cmdContent').style.backgroundImage = nanoBg;
    }
})();

// ── NANO ZONE ANIMATIONS (click to cycle, right-click to cycle background) ──
// Registry: allows applyTheme to control panel modes externally
const nanoControllers = {};

const ANIM_MODES = ['panel', 'warp', 'cockpit', 'nebula', 'matrix', 'radar', 'fractal'];
const ANIM_LABELS = { panel:'PANEL', warp:'WARP', cockpit:'COCKPIT', nebula:'NEBULA', matrix:'MATRIX', radar:'RADAR', fractal:'FRACTAL' };
const customImages = {};
let customCount = 0;

// Background gallery for PANEL mode
const PANEL_BACKGROUNDS = [
    { file: 'nano-left.jpg',  label: 'COCKPIT LEFT' },
    { file: 'nano-right.jpg', label: 'COCKPIT RIGHT' },
    { file: 'backgrounds/falcon-cockpit-view.jpg', label: 'FALCON VIEW' },
    { file: 'backgrounds/falcon-cockpit-leak.webp', label: 'FALCON INTERIOR' },
    { file: 'backgrounds/falcon-controls.avif', label: 'FALCON CONTROLS' },
    { file: 'backgrounds/falcon-switches.avif', label: 'FALCON SWITCHES' },
    { file: 'backgrounds/falcon-panel-blue.avif', label: 'BLUE PANEL' },
    { file: 'backgrounds/falcon-panel-red.avif', label: 'RED PANEL' },
    { file: 'backgrounds/falcon-levers.avif', label: 'FALCON LEVERS' },
    { file: 'backgrounds/falcon-manual-control.png', label: 'MANUAL CONTROL' },
];

function createNanoAnimation(zoneId, modeLabel, startMode) {
    const zone = document.getElementById(zoneId);
    const label = document.getElementById(modeLabel);
    const wc = document.createElement('canvas');
    wc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    wc.width = 520; wc.height = 200;
    zone.appendChild(wc);
    const ctx = wc.getContext('2d');
    const W = 520, H = 200, CX = W/2, CY = H/2;

    let mode = startMode;
    let t = 0;
    label.textContent = mode === 'panel' ? PANEL_BACKGROUNDS[zoneId === 'nanoLeft' ? 0 : 1].label : ANIM_LABELS[mode];

    // Register external control so applyTheme can switch modes
    nanoControllers[zoneId] = {
        setMode(newMode) {
            mode = newMode;
            if (mode === 'panel') {
                label.textContent = PANEL_BACKGROUNDS[bgIdx].label;
            } else {
                label.textContent = ANIM_LABELS[mode] || mode.toUpperCase();
            }
            ctx.clearRect(0,0,W,H);
            initMode();
        }
    };

    zone.addEventListener('click', (e) => {
        if (e.button !== 0) return;
        const idx = (ANIM_MODES.indexOf(mode) + 1) % ANIM_MODES.length;
        mode = ANIM_MODES[idx];
        if (mode === 'panel') {
            label.textContent = PANEL_BACKGROUNDS[bgIdx].label;
        } else {
            label.textContent = ANIM_LABELS[mode] || mode.toUpperCase();
        }
        ctx.clearRect(0,0,W,H);
        initMode();
    });

    // Right-click to cycle background image (visible in PANEL mode)
    let bgIdx = zoneId === 'nanoLeft' ? 0 : 1; // left starts on cockpit-left, right on cockpit-right
    zone.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (currentTheme === 'classic') return; // no background images in classic mode
        bgIdx = (bgIdx + 1) % PANEL_BACKGROUNDS.length;
        const bg = PANEL_BACKGROUNDS[bgIdx];
        const ap = window.scc.assetsPath;
        zone.style.backgroundImage = `url('file://${ap}/images/${bg.file}')`;
        if (mode === 'panel') label.textContent = bg.label;
    });

    // ── WARP state ──
    const MESSAGES = [
        'ADHD MODE', 'ACTIVATED',
        'HYPERFOCUS', 'ENGAGED',
        'CHAOS ENGINE', 'RUNNING',
        'SUPERSONIC', 'BRAIN ONLINE',
        'TURBO CORTEX', 'UNLEASHED',
        'DMT HYPERSPACE', 'INITIATED'
    ];
    let msgIdx = 0, msgTimer = 0, msgPulse = 0;
    let warpStars = [];
    function resetWarpStar(s){ s.x=(Math.random()-0.5)*W; s.y=(Math.random()-0.5)*H; s.z=W; s.pz=s.z; }
    function initWarp() {
        warpStars = Array.from({length:120}, () => {
            const s = { x:(Math.random()-0.5)*W, y:(Math.random()-0.5)*H, z:Math.random()*W, pz:0 };
            s.pz = s.z; return s;
        });
        msgIdx = 0; msgTimer = 0; msgPulse = 0;
    }

    // ── COCKPIT state ──
    const leds = Array.from({length:16}, (_, i) => ({
        x: 18 + i*30, y: 16,
        color: ['#0f0','#0f0','#ff0','#f80','#f00','#0f0','#0ff','#0f0',
                '#f00','#ff0','#0f0','#0f0','#f80','#0ff','#f00','#0f0'][i],
        phase: Math.random()*Math.PI*2, rate: 0.04 + Math.random()*0.08
    }));
    const counters = [
        { x:20, y:40, label:'PWR', val:0, speed:7, max:9999 },
        { x:195, y:40, label:'FREQ', val:0, speed:13, max:9999 },
        { x:370, y:40, label:'VEC', val:0, speed:3, max:9999 }
    ];
    const toggles = [
        { x:30, y:115, label:'THRUST', state:1, flip:0, rate:320 },
        { x:110, y:115, label:'SHIELD', state:1, flip:0, rate:480 },
        { x:190, y:115, label:'HYPDRV', state:1, flip:0, rate:190 },
        { x:270, y:115, label:'NAVCOMP', state:0, flip:0, rate:560 },
        { x:350, y:115, label:'COMMS', state:1, flip:0, rate:410 },
        { x:430, y:115, label:'LIFE-SP', state:1, flip:0, rate:700 }
    ];
    const gauge = { x:460, y:110, r:32, val:0.6, target:0.6, label:'FLUX' };
    const wave = { points: Array(80).fill(0), phase:0 };

    // ── NEBULA state ──
    let nebPhase = 0;

    // ── MATRIX state ──
    let matCols = [];
    function initMatrix() {
        const colW = 12;
        matCols = Array.from({length: Math.ceil(W/colW)}, (_, i) => ({
            x: i * colW, y: Math.random()*H*2 - H,
            speed: 2 + Math.random()*5, chars: []
        }));
        matCols.forEach(c => {
            const len = 8 + Math.floor(Math.random()*14);
            c.chars = Array.from({length:len}, () => String.fromCharCode(0x30A0 + Math.floor(Math.random()*96)));
        });
    }

    // ── RADAR state ──
    let radarAngle = 0;
    let radarBlips = [];
    function initRadar() {
        radarBlips = Array.from({length:8}, () => ({
            a: Math.random()*Math.PI*2, d: 20+Math.random()*70, age:0, maxAge:120+Math.random()*100
        }));
    }

    // ── FRACTAL state ──
    let fractalPhase = 0;
    let fractalCx = -0.745, fractalCy = 0.186;
    const fractalBuf = ctx.createImageData(W, H);

    function drawFractal() {
        fractalPhase += 0.003;
        // Smooth ping-pong: zoom in then back out using sine wave
        const wave = (Math.sin(fractalPhase) + 1) / 2; // 0..1..0..1
        const fractalZoom = Math.exp(wave * 11); // 1 to ~60000 and back
        const scale = 3.0 / fractalZoom;
        const ox = fractalCx - scale / 2;
        const oy = fractalCy - scale * (H / W) / 2;
        const data = fractalBuf.data;
        const step = Math.max(1, Math.floor(3 / Math.min(fractalZoom, 3))); // skip pixels when zoomed out for speed
        const maxIter = Math.min(80, 30 + Math.floor(fractalZoom * 0.5));

        for (let py = 0; py < H; py += step) {
            for (let px = 0; px < W; px += step) {
                const x0 = ox + (px / W) * scale;
                const y0 = oy + (py / H) * scale * (H / W);
                let x = 0, y = 0, iter = 0;
                while (x * x + y * y <= 4 && iter < maxIter) {
                    const xt = x * x - y * y + x0;
                    y = 2 * x * y + y0;
                    x = xt;
                    iter++;
                }
                const idx = (py * W + px) * 4;
                if (iter === maxIter) {
                    data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
                } else {
                    const t = iter / maxIter;
                    const hue = (t * 360 + fractalZoom * 2) % 360;
                    const s = 0.9, v = t < 0.05 ? t * 20 : 1;
                    const hi = Math.floor(hue / 60) % 6;
                    const f = hue / 60 - Math.floor(hue / 60);
                    const p = v * (1 - s), q = v * (1 - f * s), tt = v * (1 - (1 - f) * s);
                    let r, g, b;
                    if (hi === 0) { r = v; g = tt; b = p; }
                    else if (hi === 1) { r = q; g = v; b = p; }
                    else if (hi === 2) { r = p; g = v; b = tt; }
                    else if (hi === 3) { r = p; g = q; b = v; }
                    else if (hi === 4) { r = tt; g = p; b = v; }
                    else { r = v; g = p; b = q; }
                    data[idx] = r * 255; data[idx + 1] = g * 255; data[idx + 2] = b * 255; data[idx + 3] = 255;
                    // Fill skipped pixels
                    if (step > 1) {
                        for (let sy = 0; sy < step && py + sy < H; sy++) {
                            for (let sx = 0; sx < step && px + sx < W; sx++) {
                                if (sy === 0 && sx === 0) continue;
                                const si = ((py + sy) * W + px + sx) * 4;
                                data[si] = data[idx]; data[si+1] = data[idx+1]; data[si+2] = data[idx+2]; data[si+3] = 255;
                            }
                        }
                    }
                }
            }
        }
        ctx.putImageData(fractalBuf, 0, 0);
    }

    function initMode() {
        if (mode === 'warp') initWarp();
        if (mode === 'matrix') initMatrix();
        if (mode === 'radar') initRadar();
        if (mode === 'fractal') fractalPhase = 0;
    }

    // ── DRAW FUNCTIONS ──

    function drawWarp() {
        ctx.fillStyle = 'rgba(0,4,14,0.22)';
        ctx.fillRect(0,0,W,H);
        warpStars.forEach(s => {
            s.pz = s.z; s.z -= 7;
            if (s.z <= 0) { resetWarpStar(s); return; }
            const sx = (s.x/s.z)*W+CX, sy = (s.y/s.z)*H+CY;
            const px = (s.x/s.pz)*W+CX, py = (s.y/s.pz)*H+CY;
            if (sx<0||sx>W||sy<0||sy>H) { resetWarpStar(s); return; }
            const f = 1-s.z/W;
            const bright = Math.floor(f*255);
            ctx.strokeStyle = `rgba(${bright},${Math.floor(bright*0.7)},255,${f})`;
            ctx.lineWidth = Math.max(0.4, f*2.2);
            ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(sx,sy); ctx.stroke();
        });
        msgPulse += 0.04;
        const glow = ctx.createRadialGradient(CX,CY,8,CX,CY,60);
        glow.addColorStop(0, `rgba(0,200,255,${0.12+0.06*Math.sin(msgPulse)})`);
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(CX,CY,60,0,Math.PI*2); ctx.fill();
        msgTimer++;
        if (msgTimer > 220) { msgTimer = 0; msgIdx = (msgIdx+2) % MESSAGES.length; }
        const alpha = msgTimer < 30 ? msgTimer/30 : msgTimer > 190 ? (220-msgTimer)/30 : 1;
        ctx.save();
        ctx.shadowColor = '#0cf'; ctx.shadowBlur = 18;
        ctx.textAlign = 'center'; ctx.fillStyle = `rgba(0,230,255,${alpha})`;
        ctx.font = 'bold 13px "Orbitron", monospace';
        ctx.letterSpacing = '4px';
        ctx.fillText(MESSAGES[msgIdx], CX, CY-10);
        ctx.font = 'bold 11px "Orbitron", monospace';
        ctx.fillStyle = `rgba(180,240,255,${alpha*0.8})`;
        ctx.fillText(MESSAGES[msgIdx+1], CX, CY+10);
        ctx.restore();
    }

    function drawCockpit() {
        ctx.clearRect(0,0,W,H);
        ctx.fillStyle = 'rgba(4,8,18,0.92)'; ctx.fillRect(0,0,W,H);
        ctx.strokeStyle = 'rgba(0,60,100,0.18)'; ctx.lineWidth = 0.5;
        for(let i=0;i<W;i+=20){ ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,H);ctx.stroke(); }
        for(let j=0;j<H;j+=20){ ctx.beginPath();ctx.moveTo(0,j);ctx.lineTo(W,j);ctx.stroke(); }
        leds.forEach(led => {
            const on = 0.5 + 0.5*Math.sin(led.phase + t*led.rate);
            ctx.beginPath(); ctx.arc(led.x, led.y, 5, 0, Math.PI*2);
            ctx.fillStyle = on > 0.4 ? led.color : '#111';
            ctx.shadowColor = led.color; ctx.shadowBlur = on > 0.4 ? 8 : 0;
            ctx.fill(); ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.5; ctx.stroke();
        });
        counters.forEach(c => {
            c.val = (c.val + c.speed) % (c.max+1);
            const str = String(Math.floor(c.val)).padStart(4,'0');
            ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.strokeStyle = 'rgba(0,255,100,0.3)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(c.x, c.y, 115, 36, 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = 'rgba(0,200,80,0.45)'; ctx.font = '7px "Orbitron",monospace';
            ctx.textAlign = 'left'; ctx.fillText(c.label, c.x+4, c.y+10);
            ctx.fillStyle = '#0f0'; ctx.font = 'bold 19px "Courier New",monospace';
            ctx.shadowColor = '#0f0'; ctx.shadowBlur = 6; ctx.fillText(str, c.x+10, c.y+30); ctx.shadowBlur = 0;
        });
        toggles.forEach(tog => {
            tog.flip++;
            if (tog.flip > tog.rate) { tog.state = 1 - tog.state; tog.flip = 0; }
            const on = tog.state === 1, bx = tog.x, by = tog.y;
            ctx.fillStyle = '#1a1a1a'; ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(bx, by, 48, 52, 3); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#0a0a0a'; ctx.beginPath(); ctx.roundRect(bx+17, by+4, 14, 34, 4); ctx.fill();
            const ly = on ? by+6 : by+22;
            const lg = ctx.createLinearGradient(bx+16, ly, bx+32, ly+14);
            lg.addColorStop(0, on ? '#aaa' : '#888'); lg.addColorStop(1, on ? '#555' : '#333');
            ctx.fillStyle = lg; ctx.beginPath(); ctx.roundRect(bx+16, ly, 16, 14, 3); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
            ctx.beginPath(); ctx.arc(bx+24, by+44, 4, 0, Math.PI*2);
            ctx.fillStyle = on ? '#0f0' : '#500'; ctx.shadowColor = on ? '#0f0' : '#f00';
            ctx.shadowBlur = on ? 7 : 3; ctx.fill(); ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(200,220,255,0.3)'; ctx.font = '5.5px "Orbitron",monospace';
            ctx.textAlign = 'center'; ctx.fillText(tog.label, bx+24, by+62);
        });
        // gauge
        gauge.target = 0.3 + 0.5*Math.sin(t*0.007) + 0.1*Math.sin(t*0.023);
        gauge.val += (gauge.target - gauge.val) * 0.02;
        const startA = Math.PI*0.75, endA = Math.PI*2.25, sweep = startA + gauge.val*(endA-startA);
        ctx.beginPath(); ctx.arc(gauge.x, gauge.y, gauge.r, startA, endA);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 5; ctx.stroke();
        const gc = ctx.createLinearGradient(gauge.x-gauge.r, gauge.y, gauge.x+gauge.r, gauge.y);
        gc.addColorStop(0,'#0f0'); gc.addColorStop(0.6,'#ff0'); gc.addColorStop(1,'#f00');
        ctx.beginPath(); ctx.arc(gauge.x, gauge.y, gauge.r, startA, sweep);
        ctx.strokeStyle = gc; ctx.lineWidth = 5; ctx.stroke();
        const nx = gauge.x + Math.cos(sweep)*gauge.r*0.7, ny = gauge.y + Math.sin(sweep)*gauge.r*0.7;
        ctx.beginPath(); ctx.moveTo(gauge.x,gauge.y); ctx.lineTo(nx,ny);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(gauge.x,gauge.y,4,0,Math.PI*2); ctx.fillStyle = '#ccc'; ctx.fill();
        ctx.fillStyle = 'rgba(200,220,255,0.4)'; ctx.font = '7px "Orbitron",monospace';
        ctx.textAlign = 'center'; ctx.fillText(gauge.label, gauge.x, gauge.y+gauge.r+12);
        // waveform
        wave.phase += 0.08; wave.points.shift();
        wave.points.push(Math.sin(wave.phase)*14 + Math.sin(wave.phase*2.3)*6 + (Math.random()-0.5)*3);
        const wx = 20, wy = 175, ww = 480, wh = 20;
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.roundRect(wx, wy-wh, ww, wh*2, 2); ctx.fill();
        ctx.beginPath();
        wave.points.forEach((p,i) => {
            const px = wx + (i/wave.points.length)*ww, py = wy + p;
            i===0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
        });
        ctx.strokeStyle = 'rgba(0,255,180,0.7)'; ctx.lineWidth = 1.2;
        ctx.shadowColor = '#0fb'; ctx.shadowBlur = 4; ctx.stroke(); ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(0,255,180,0.3)'; ctx.font = '6px "Orbitron",monospace';
        ctx.textAlign = 'left'; ctx.fillText('SIG', wx+2, wy-wh+8);
    }

    function drawNebula() {
        nebPhase += 0.008;
        ctx.fillStyle = 'rgba(0,0,8,0.06)'; ctx.fillRect(0,0,W,H);
        for (let i = 0; i < 5; i++) {
            const cx = W * (0.2 + 0.15*Math.sin(nebPhase*(0.7+i*0.3) + i*1.2));
            const cy = H * (0.3 + 0.2*Math.cos(nebPhase*(0.5+i*0.2) + i*0.8));
            const r = 50 + 30*Math.sin(nebPhase*0.4 + i);
            const hue = (nebPhase*20 + i*60) % 360;
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, `hsla(${hue},80%,60%,0.08)`);
            g.addColorStop(0.5, `hsla(${hue+30},70%,40%,0.04)`);
            g.addColorStop(1, 'transparent');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
        }
        // floating particles
        for (let i = 0; i < 20; i++) {
            const px = (W * (0.1*i + Math.sin(nebPhase*0.5 + i*0.7)*0.4 + 0.5)) % W;
            const py = (H * (0.1*i + Math.cos(nebPhase*0.3 + i*1.1)*0.3 + 0.5)) % H;
            const hue = (nebPhase*15 + i*40) % 360;
            ctx.beginPath(); ctx.arc(px, py, 1 + Math.sin(nebPhase+i)*0.8, 0, Math.PI*2);
            ctx.fillStyle = `hsla(${hue},90%,70%,${0.3+0.2*Math.sin(nebPhase*2+i)})`;
            ctx.shadowColor = `hsl(${hue},90%,60%)`; ctx.shadowBlur = 6;
            ctx.fill(); ctx.shadowBlur = 0;
        }
        // center text
        const a = 0.3 + 0.15*Math.sin(nebPhase*2);
        ctx.save(); ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(200,180,255,${a})`; ctx.font = 'bold 11px "Orbitron",monospace';
        ctx.shadowColor = '#a080ff'; ctx.shadowBlur = 12;
        ctx.fillText('COSMIC DRIFT', CX, CY); ctx.restore();
    }

    function drawMatrix() {
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0,0,W,H);
        ctx.font = '11px "Courier New",monospace';
        ctx.shadowColor = '#0f0'; ctx.shadowBlur = 3;
        matCols.forEach(col => {
            col.y += col.speed;
            if (col.y > H + col.chars.length*14) {
                col.y = -col.chars.length*14;
                col.speed = 2 + Math.random()*5;
                col.chars = col.chars.map(() => String.fromCharCode(0x30A0 + Math.floor(Math.random()*96)));
            }
            col.chars.forEach((ch, i) => {
                const cy = col.y + i*14;
                if (cy < -14 || cy > H+14) return;
                const isHead = i === col.chars.length-1;
                ctx.fillStyle = isHead ? '#fff' : `rgba(0,255,70,${0.9 - (i/col.chars.length)*0.7})`;
                ctx.fillText(ch, col.x, cy);
            });
            // randomly mutate chars
            if (Math.random() < 0.03) {
                const ri = Math.floor(Math.random()*col.chars.length);
                col.chars[ri] = String.fromCharCode(0x30A0 + Math.floor(Math.random()*96));
            }
        });
        ctx.shadowBlur = 0;
    }

    function drawRadar() {
        ctx.fillStyle = 'rgba(0,4,2,0.08)'; ctx.fillRect(0,0,W,H);
        const rcx = CX, rcy = CY, rr = 85;
        radarAngle += 0.025;
        // rings
        ctx.strokeStyle = 'rgba(0,200,80,0.15)'; ctx.lineWidth = 0.5;
        [0.33, 0.66, 1].forEach(f => {
            ctx.beginPath(); ctx.arc(rcx, rcy, rr*f, 0, Math.PI*2); ctx.stroke();
        });
        // cross
        ctx.beginPath(); ctx.moveTo(rcx-rr,rcy); ctx.lineTo(rcx+rr,rcy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rcx,rcy-rr); ctx.lineTo(rcx,rcy+rr); ctx.stroke();
        // sweep
        const sx = rcx + Math.cos(radarAngle)*rr, sy = rcy + Math.sin(radarAngle)*rr;
        const sg = ctx.createLinearGradient(rcx, rcy, sx, sy);
        sg.addColorStop(0, 'rgba(0,255,100,0.4)'); sg.addColorStop(1, 'rgba(0,255,100,0)');
        ctx.strokeStyle = sg; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(rcx,rcy); ctx.lineTo(sx,sy); ctx.stroke();
        // sweep arc trail
        const arcG = ctx.createConicGradient(radarAngle - 0.5, rcx, rcy);
        arcG.addColorStop(0, 'transparent'); arcG.addColorStop(0.12, 'rgba(0,255,100,0.08)');
        arcG.addColorStop(0.15, 'transparent');
        ctx.fillStyle = arcG; ctx.beginPath(); ctx.arc(rcx, rcy, rr, 0, Math.PI*2); ctx.fill();
        // blips
        radarBlips.forEach(b => {
            b.age++;
            if (b.age > b.maxAge) { b.a = Math.random()*Math.PI*2; b.d = 20+Math.random()*70; b.age = 0; }
            const bx = rcx + Math.cos(b.a)*b.d, by = rcy + Math.sin(b.a)*b.d;
            const ba = Math.max(0, 1 - b.age/b.maxAge);
            ctx.beginPath(); ctx.arc(bx, by, 2.5, 0, Math.PI*2);
            ctx.fillStyle = `rgba(0,255,100,${ba*0.8})`; ctx.shadowColor = '#0f0'; ctx.shadowBlur = 6;
            ctx.fill(); ctx.shadowBlur = 0;
        });
        // label
        ctx.fillStyle = 'rgba(0,200,80,0.35)'; ctx.font = '7px "Orbitron",monospace';
        ctx.textAlign = 'center'; ctx.fillText('SCAN ACTIVE', rcx, rcy+rr+14);
    }

    // ── CUSTOM IMAGE state ──
    let customImg = null;
    let customPulse = 0;

    function drawCustom() {
        const imgSrc = customImages[mode];
        if (!imgSrc) return;
        if (!customImg || customImg._src !== imgSrc) {
            customImg = new Image();
            customImg._src = imgSrc;
            customImg.src = 'file://' + imgSrc;
        }
        ctx.clearRect(0,0,W,H);
        ctx.fillStyle = 'rgba(0,4,14,0.95)'; ctx.fillRect(0,0,W,H);
        if (customImg.complete && customImg.naturalWidth) {
            // draw centered, cover
            const ar = customImg.naturalWidth / customImg.naturalHeight;
            let dw = W, dh = H;
            if (ar > W/H) { dh = H; dw = H * ar; } else { dw = W; dh = W / ar; }
            ctx.globalAlpha = 0.7;
            ctx.drawImage(customImg, (W-dw)/2, (H-dh)/2, dw, dh);
            ctx.globalAlpha = 1;
        }
        // subtle scanline overlay
        customPulse += 0.02;
        for (let y = 0; y < H; y += 3) {
            ctx.fillStyle = `rgba(0,0,0,${0.15 + 0.05*Math.sin(customPulse + y*0.1)})`;
            ctx.fillRect(0, y, W, 1);
        }
    }

    initMode();

    function loop() {
        t++;
        if (mode === 'panel') {
            // No canvas overlay, just the background image
            wc.style.display = 'none';
        } else {
            wc.style.display = '';
            if (mode === 'warp') drawWarp();
            else if (mode === 'cockpit') drawCockpit();
            else if (mode === 'nebula') drawNebula();
            else if (mode === 'matrix') drawMatrix();
            else if (mode === 'radar') drawRadar();
            else if (mode === 'fractal') drawFractal();
            else if (mode.startsWith('custom-')) drawCustom();
        }
        requestAnimationFrame(loop);
    }
    loop();
}

createNanoAnimation('nanoLeft', 'nanoLeftMode', 'panel');
createNanoAnimation('nanoRight', 'nanoRightMode', 'panel');

// ── SESSION SAVE/RESTORE ─────────────────────────────────
function saveSession() {
    const snapshot = workspaces.map((ws, i) => {
        const wsWins = (i === activeWsIdx) ? wins : (ws._wins || []);
        return {
            name: ws.name,
            _accent: ws._accent || null,
            projects: ws.projects.map(p => ({ title: p.title, path: p.path || '', model: p.model, useWorktree: p.useWorktree || false })),
            openWindows: wsWins.map(w => ({
                title: w.title, model: w.model, path: w.path || '',
                x: w.x, y: w.y, width: w.width, height: w.height,
                state: w.state, zIndex: w.zIndex
            }))
        };
    });
    const _activeWsIdx = activeWsIdx;
    return patchConfig(cfg => ({
        ...cfg,
        workspaces: snapshot.map(s => ({ name: s.name, projects: s.projects, _accent: s._accent })),
        session: { activeWorkspace: _activeWsIdx, workspaceWindows: snapshot.map(s => s.openWindows) }
    }));
}

let currentConfig = {};

// ── APP CLOSING ──────────────────────────────────────────
window.scc.onAppClosing(async () => {
    await saveSession();
});

// ── INIT ──────────────────────────────────────────────────
(async () => {
    const ap = window.scc.assetsPath;
    document.getElementById('nanoLeft').style.backgroundImage  = `url('file://${ap}/images/nano-left.jpg')`;
    document.getElementById('nanoRight').style.backgroundImage = `url('file://${ap}/images/nano-right.jpg')`;
    const cfg = await window.scc.readConfig();
    currentConfig = cfg;

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

    if (cfg.theme) {
        applyTheme(cfg.theme);
        document.getElementById('quickThemeBtn').textContent = THEME_LABELS[cfg.theme] || 'THEME';
        applyClassicDayNight();
    }

    // Restore appearance settings
    if (cfg.appearance) {
        const a = cfg.appearance;
        if (a.fontFamily) appSettings.fontFamily = a.fontFamily;
        if (a.fontSize)   appSettings.fontSize = a.fontSize;
        if (a.scanlines === false)  { appSettings.scanlines = false;  document.body.classList.add('no-scanlines'); }
        if (a.starfield === false)  { appSettings.starfield = false;  const c = document.getElementById('stars'); if (c) c.style.display = 'none'; }
        if (a.sounds === false)     { appSettings.sounds = false; soundEnabled = false; }
        if (a.snake === false)      { appSettings.snake = false; document.body.classList.add('no-snake'); }
        if (a.nanoZones === false)   { appSettings.nanoZones = false; document.querySelectorAll('.nano-side').forEach(el => el.style.display = 'none'); }
        if (a.tileMode) appSettings.tileMode = a.tileMode;
        applyAppFont();
    }

    // Legacy sound setting
    if (cfg.soundEnabled === false) {
        soundEnabled = false;
        appSettings.sounds = false;
    }
    const soundBtnEl = document.getElementById('soundBtn');
    if (soundBtnEl) soundBtnEl.textContent = soundEnabled ? 'SFX ON' : 'SFX OFF';

    if (cfg.shortcuts) Object.assign(shortcuts, cfg.shortcuts);
    if (cfg.keywordAlerts) keywordAlerts = cfg.keywordAlerts;

    // Load workspaces from config (fall back to legacy projects format)
    if (cfg.workspaces && cfg.workspaces.length) {
        workspaces = cfg.workspaces.map(ws => ({
            name: ws.name,
            _accent: ws._accent || null,
            projects: ws.projects || [],
            _wins: []
        }));
    } else if (cfg.projects && cfg.projects.length) {
        workspaces = [{ name: 'ALL', projects: [...cfg.projects], _wins: [] }];
    }

    // Restore session: which workspace was active + open windows
    const session = cfg.session;
    if (session && session.activeWorkspace != null) {
        activeWsIdx = Math.min(session.activeWorkspace, workspaces.length - 1);
    } else {
        activeWsIdx = 0;
    }

    wins = workspaces[activeWsIdx]._wins;
    syncProjects();
    renderWorkspaceTabs();
    applyWorkspaceAccent(workspaces[activeWsIdx]?._accent || null);
    document.addEventListener('click', () => {
        document.querySelectorAll('.accent-picker.show').forEach(p => p.classList.remove('show'));
    });
    refreshLedger();

    // Restore open windows for current workspace
    if (session && session.workspaceWindows && session.workspaceWindows[activeWsIdx]) {
        session.workspaceWindows[activeWsIdx].forEach(wCfg => {
            const resolvedPath = wCfg.path || projects.find(p => p.title === wCfg.title)?.path;
            if (!resolvedPath) return;
            mkWin({
                title: wCfg.title, model: wCfg.model, path: resolvedPath,
                x: wCfg.x, y: wCfg.y, width: wCfg.width, height: wCfg.height,
                state: wCfg.state, zIndex: wCfg.zIndex
            });
        });
        refreshLedger();
    }

    window.scc.onConfigChanged(newCfg => {
        if (newCfg.workspaces) {
            newCfg.workspaces.forEach((ws, i) => {
                if (workspaces[i]) workspaces[i].projects = ws.projects || [];
            });
            syncProjects();
            refreshLedger();
        }
    });
})();

// ── 777-MINUTE WARP DRIVE EASTER EGG ─────────────────────
(() => {
    const TRIGGER_MS = 777 * 60 * 1000; // 777 minutes
    const IDLE_LIMIT = 60 * 60 * 1000;  // 1 hour mouse idle resets streak
    const HEARTBEAT  = 30 * 1000;       // check every 30s for sleep gaps
    const SLEEP_GAP  = 60 * 1000;       // >60s gap between heartbeats = sleep

    let warpTriggered = false;
    let activeMs = 0;
    let lastHeartbeat = Date.now();
    let lastMouseMove = Date.now();
    let idleReset = false;

    // Track mouse activity
    document.addEventListener('mousemove', () => { lastMouseMove = Date.now(); idleReset = false; });

    // Heartbeat: accumulate active time, detect sleep gaps and mouse idle
    const hbInterval = setInterval(() => {
        if (warpTriggered) { clearInterval(hbInterval); return; }

        const now = Date.now();
        const gap = now - lastHeartbeat;
        lastHeartbeat = now;

        // Sleep detected: gap too large, reset streak
        if (gap > SLEEP_GAP) {
            activeMs = 0;
            return;
        }

        // Mouse idle > 1 hour: reset streak (once, until mouse moves again)
        if (now - lastMouseMove > IDLE_LIMIT) {
            if (!idleReset) { activeMs = 0; idleReset = true; }
            return;
        }

        // Accumulate active time
        activeMs += gap;

        // Check if we hit 777 minutes
        if (activeMs >= TRIGGER_MS) {
            clearInterval(hbInterval);
            triggerWarp();
        }
    }, HEARTBEAT);

    function triggerWarp() {
        if (warpTriggered) return;
        warpTriggered = true;

        // Create fullscreen overlay
        const overlay = document.createElement('canvas');
        overlay.id = 'warpOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99999;pointer-events:none;';
        overlay.width = window.innerWidth;
        overlay.height = window.innerHeight;
        document.body.appendChild(overlay);
        const ctx = overlay.getContext('2d');
        const W = overlay.width, H = overlay.height, CX = W/2, CY = H/2;

        // Shake the whole window (intensity fades after 10s)
        let shakeInt = setInterval(() => {
            const elapsed = performance.now() - startTime;
            let intensity = 12;
            if (elapsed > 10000) intensity = Math.max(0.5, 12 * (1 - (elapsed - 10000) / 3000));
            const dx = (Math.random()-0.5)*intensity, dy = (Math.random()-0.5)*intensity;
            document.body.style.transform = `translate(${dx}px,${dy}px)`;
        }, 30);

        // Warp stars
        const wStars = Array.from({length:300}, () => ({
            x:(Math.random()-0.5)*W*2, y:(Math.random()-0.5)*H*2,
            z:Math.random()*W, pz:0
        }));

        const DURATION = 25000;   // 25 seconds total
        const MSG_IN   = 3000;    // text appears at 3s
        const MSG_OUT  = 23000;   // text fades at 23s (20s of text visible)
        const FADE_MS  = 800;     // fade in/out duration
        const startTime = performance.now();

        // Text zoom: starts at 0.6x scale, slowly grows to 1.4x over the text duration
        const ZOOM_START = 0.6;
        const ZOOM_END   = 1.4;

        function warpFrame(now) {
            const elapsed = now - startTime;
            const progress = elapsed / DURATION; // 0..1

            // After 14s, fade to black for quiet title reading
            const fadePhase = elapsed > 14000 ? Math.min(1, (elapsed - 14000) / 3000) : 0;
            ctx.fillStyle = elapsed < 300 ? '#000' : `rgba(0,0,8,${0.15 + 0.1*Math.sin(elapsed*0.006) + fadePhase*0.6})`;
            ctx.fillRect(0,0,W,H);

            // Accelerating stars (fade out after 14s)
            const starAlpha = 1 - fadePhase;
            if (starAlpha > 0.01) {
                const speed = 5 + progress * 40;
                wStars.forEach(s => {
                    s.pz = s.z; s.z -= speed;
                    if (s.z <= 0) { s.x=(Math.random()-0.5)*W*2; s.y=(Math.random()-0.5)*H*2; s.z=W; s.pz=s.z; return; }
                    const sx = (s.x/s.z)*W+CX, sy = (s.y/s.z)*H+CY;
                    const px = (s.x/s.pz)*W+CX, py = (s.y/s.pz)*H+CY;
                    if (sx<0||sx>W||sy<0||sy>H) { s.z=W; s.pz=s.z; return; }
                    const f = (1-s.z/W) * starAlpha;
                    ctx.strokeStyle = `rgba(${Math.floor(f*200+55)},${Math.floor(f*150+105)},255,${f})`;
                    ctx.lineWidth = Math.max(0.5, f*3.5);
                    ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(sx,sy); ctx.stroke();
                });
            }

            // Central flash + text with slow zoom
            if (elapsed > MSG_IN && elapsed < MSG_OUT) {
                const textProgress = (elapsed - MSG_IN) / (MSG_OUT - MSG_IN); // 0..1 over text lifetime
                const zoom = ZOOM_START + textProgress * (ZOOM_END - ZOOM_START);

                const pulse = 0.5 + 0.3*Math.sin(elapsed*0.009);
                const glowR = 200 * zoom;
                const glow = ctx.createRadialGradient(CX,CY,0,CX,CY,glowR);
                glow.addColorStop(0, `rgba(0,200,255,${pulse*0.25})`);
                glow.addColorStop(1, 'transparent');
                ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(CX,CY,glowR,0,Math.PI*2); ctx.fill();

                const tAlpha = elapsed < MSG_IN+FADE_MS ? (elapsed-MSG_IN)/FADE_MS
                             : elapsed > MSG_OUT-FADE_MS ? (MSG_OUT-elapsed)/FADE_MS : 1;

                ctx.save();
                ctx.translate(CX, CY);
                ctx.scale(zoom, zoom);
                ctx.textAlign = 'center';
                ctx.shadowColor = '#0ff'; ctx.shadowBlur = 30;

                ctx.font = 'bold 28px "Orbitron", monospace';
                ctx.fillStyle = `rgba(0,255,255,${tAlpha})`;
                ctx.fillText('WARPSPEED UNLOCKED', 0, -40);

                ctx.font = 'bold 16px "Orbitron", monospace';
                ctx.fillStyle = `rgba(255,220,100,${tAlpha*0.9})`;
                ctx.fillText('DEV MANIA INITIATED', 0, -5);

                ctx.font = 'bold 13px "Orbitron", monospace';
                ctx.fillStyle = `rgba(0,255,180,${tAlpha*0.85})`;
                ctx.fillText('DRINK WATER \u2022 HAVE FOOD \u2022 10 PUSH-UPS!', 0, 30);

                ctx.font = '10px "Orbitron", monospace';
                ctx.fillStyle = `rgba(180,220,255,${tAlpha*0.5})`;
                ctx.fillText('777 MINUTES OF PURE FOCUS', 0, 60);

                ctx.restore();
            }

            if (elapsed < DURATION) {
                requestAnimationFrame(warpFrame);
            } else {
                clearInterval(shakeInt);
                document.body.style.transform = '';
                overlay.remove();
            }
        }

        // Force sound even if SFX is toggled off (this is a reward)
        try {
            const audio = new Audio(`file://${window.scc.assetsPath}/sounds/warp-unlock.wav`);
            audio.volume = 0.9;
            audio.play().catch(() => {});
        } catch (_) {}
        requestAnimationFrame(warpFrame);
    }

    // Test trigger: Ctrl+Shift+7 fires the easter egg immediately
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === '7') {
            e.preventDefault();
            triggerWarp();
        }
    });

    // ── TASK MONITOR (functions defined at module scope above) ──
    document.getElementById('taskMonitorClose').addEventListener('click', closeTaskMonitor);
    document.getElementById('taskMonitorBtn').addEventListener('click', () => {
        taskMonitorOpen ? closeTaskMonitor() : openTaskMonitor();
    });

    document.getElementById('restoreBtn')?.addEventListener('click', async () => {
        const latestCfg = await window.scc.readConfig();
        const savedSession = latestCfg.session;
        if (!savedSession?.workspaceWindows) return;
        const wsWins = savedSession.workspaceWindows[activeWsIdx] || [];
        wsWins.forEach(wCfg => {
            const resolvedPath = wCfg.path || projects.find(p => p.title === wCfg.title)?.path;
            if (!resolvedPath) return;
            const alreadyOpen = wins.find(w => (w.path && w.path === resolvedPath) || w.title === wCfg.title);
            if (alreadyOpen) return;
            mkWin({
                title: wCfg.title, model: wCfg.model,
                path: resolvedPath,
                x: wCfg.x, y: wCfg.y,
                width: wCfg.width, height: wCfg.height,
                state: wCfg.state, zIndex: wCfg.zIndex
            });
        });
        refreshLedger();
    });

    // ── CLAUDE STOP SIGNAL ───────────────────────────────────
    if (window.scc && window.scc.onClaudeStop) {
        window.scc.onClaudeStop(() => {
            playSound(DONE_SOUNDS[0], 0.7);
            const focused = wins.find(w => w.element && w.element.classList.contains('focused'));
            if (focused && focused.element) {
                focused.element.dataset.snake = 'done';
                focused.snakeState = 'done';
            }
            updateTaskMonitor();
        });
    }
})();
