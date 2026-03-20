const pty = require('node-pty');
const os  = require('os');

class PtyManager {
  constructor() {
    this._ptys = new Map();
  }

  spawn(id, cwd, onData) {
    const shell = process.env.SHELL || '/bin/zsh';
    const p = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80, rows: 24,
      cwd: cwd || os.homedir(),
      env: process.env
    });
    p.onData(data => onData(id, data));
    this._ptys.set(id, p);
  }

  write(id, data) {
    const p = this._ptys.get(id);
    if (p) p.write(data);
  }

  resize(id, cols, rows) {
    const p = this._ptys.get(id);
    if (p) p.resize(cols, rows);
  }

  kill(id) {
    const p = this._ptys.get(id);
    if (p) { try { p.kill(); } catch (_) {} }
    this._ptys.delete(id);
  }

  has(id) { return this._ptys.has(id); }

  killAll() {
    for (const id of [...this._ptys.keys()]) this.kill(id);
  }
}

module.exports = PtyManager;
