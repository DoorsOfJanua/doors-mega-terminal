import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const terminals = new Map();

// Prompt patterns: common shells
const PROMPT_RE = /[\$%#❯>]\s*$/m;

// Route all pty output to the correct xterm instance.
// Registered once at module load — survives for the page lifetime.
window.scc.onTermData(({ id, data }) => {
  const t = terminals.get(id);
  if (!t) return;
  t.term.write(data);

  // Detect shell prompt in output → mark window as done
  if (t.onStateChange) {
    t.lastOutput = (t.lastOutput || '').slice(-200) + data;
    if (PROMPT_RE.test(t.lastOutput)) {
      t.lastOutput = '';
      t.onStateChange(id, 'done');
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
  // spaceship (default)
  return { background: '#000e1a', foreground: '#00ff88', cursor: '#00ffcc', selectionBackground: 'rgba(0,255,200,0.3)' };
}

export function refreshAllTermThemes() {
  const theme = getTermTheme();
  terminals.forEach(t => { t.term.options.theme = theme; });
}

export async function initTerminal(id, container, projectPath, onStateChange) {
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

  // Spawn pty FIRST, then attach resize observer to avoid resize-before-spawn race
  await window.scc.termSpawn(id, projectPath);
  window.scc.termResize(id, term.cols, term.rows);

  const resizeObserver = new ResizeObserver(() => {
    fit.fit();
    window.scc.termResize(id, term.cols, term.rows);
  });
  resizeObserver.observe(container);

  term.onData(data => {
    window.scc.termInput(id, data);
    // User typed → process is running again
    const entry = terminals.get(id);
    if (entry && entry.onStateChange) entry.onStateChange(id, 'running');
  });

  terminals.set(id, { term, fit, resizeObserver, onStateChange, lastOutput: '' });
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
