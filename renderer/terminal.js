import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const terminals = new Map();

const PROMPT_RE   = /[\$%#❯>]\s*$/m;
const TOKEN_RE_A  = /Tokens?:\s*([\d,]+)\s*input,\s*([\d,]+)\s*output/i;
const TOKEN_RE_B  = /Usage:\s*input=(\d+)\s+output=(\d+)/i;
const APPROVAL_RE = /(\[y\/n\]|\[Y\/n\]|\(y\/n\)|Press Enter|Continue\?|\?\s*$)/im;
const ansiRe = () => /\x1B\[[0-9;]*[mGKHF]/g;
// Claude Code tool invocation — "● Write(..." appears in Claude Code output
const TOOL_RE     = /[●○◉]\s*(Write|Edit|Bash|Read|Glob|Grep|Create|Update|MultiEdit|NotebookEdit)/i;
// Claude thinking — braille spinner chars shown during processing
const THINKING_RE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

window.scc.onTermData(({ id, data }) => {
  const t = terminals.get(id);
  if (!t) return;
  t.term.write(data);

  t.outputLen  = (t.outputLen  || 0) + data.length;
  t.lastOutput = (t.lastOutput + data).slice(-500);
  const clean  = t.lastOutput.replace(ansiRe(), '');

  if (t.onStateChange) {
    if (PROMPT_RE.test(clean)) {
      if (t.outputLen > 50) t.onStateChange(id, 'done');
      t.lastOutput = '';
      t.outputLen  = 0;
    } else if (TOOL_RE.test(clean)) {
      t.onStateChange(id, 'writing');
    } else if (THINKING_RE.test(clean)) {
      t.onStateChange(id, 'thinking');
    }
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
          if (!rule._compiled) {
            rule._compiled = rule.regex
              ? new RegExp(rule.pattern, 'i')
              : new RegExp(rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          }
          const re = rule._compiled;
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
    if (line) lines.push(line.translateToString(true).replace(ansiRe(), ''));
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
