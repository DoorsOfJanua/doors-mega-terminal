import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const terminals = new Map();

// Route all pty output to the correct xterm instance.
// Registered once at module load — survives for the page lifetime.
window.scc.onTermData(({ id, data }) => {
  const t = terminals.get(id);
  if (t) t.term.write(data);
});

export async function initTerminal(id, container, projectPath) {
  const term = new Terminal({
    fontFamily: '"Courier New", monospace',
    fontSize: 12,
    theme: {
      background: '#000e1a',
      foreground: '#00ff88',
      cursor: '#00ffcc',
      selectionBackground: 'rgba(0,255,200,0.3)'
    },
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

  term.onData(data => window.scc.termInput(id, data));
  terminals.set(id, { term, fit, resizeObserver });
}

export function destroyTerminal(id) {
  const t = terminals.get(id);
  if (!t) return;
  t.resizeObserver.disconnect();
  t.term.dispose();
  window.scc.termKill(id);
  terminals.delete(id);
}
