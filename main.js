const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { readConfig, writeConfig, watchConfig } = require('./config');
const PtyManager = require('./pty-manager');

let mainWindow;
let isClosing = false;
const ptys = new PtyManager();

function createWindow() {
  const cfg = readConfig();

  mainWindow = new BrowserWindow({
    width: 1440, height: 900,
    minWidth: 900, minHeight: 600,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (!cfg.welcomeSeen) {
    mainWindow.loadFile('renderer/welcome.html');
  } else {
    mainWindow.loadFile('renderer/dist/index.html');
  }


  mainWindow.on('close', (e) => {
    if (!isClosing) {
      e.preventDefault();
      isClosing = true;
      mainWindow.webContents.send('app:closing');
      setTimeout(() => mainWindow.destroy(), 2800);
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  watchConfig(cfg => {
    if (mainWindow) mainWindow.webContents.send('config:changed', cfg);
  });

  // ── CLAUDE STOP SIGNAL ───────────────────────────────────
  const _fs   = require('fs');
  const _os   = require('os');
  const CLAUDE_DONE_FILE = path.join(_os.homedir(), '.spaceship', '.claude-done');
  _fs.mkdirSync(path.dirname(CLAUDE_DONE_FILE), { recursive: true });
  let _claudeDoneMtime = 0;
  setInterval(() => {
    try {
      const mt = _fs.statSync(CLAUDE_DONE_FILE).mtimeMs;
      if (mt > _claudeDoneMtime) {
        _claudeDoneMtime = mt;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('claude-stop');
        }
      }
    } catch (_) { /* file doesn't exist yet - normal */ }
  }, 1000);
});

app.on('window-all-closed', () => {
  ptys.killAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.on('navigate', (_e, page) => {
  if (mainWindow) mainWindow.loadFile(page);
});

ipcMain.on('welcome:done', () => {
  const cfg = readConfig();
  cfg.welcomeSeen = true;
  writeConfig(cfg);
  if (mainWindow) mainWindow.loadFile('renderer/dist/index.html');
});

ipcMain.handle('config:read', () => readConfig());
ipcMain.handle('config:write', (_e, cfg) => { writeConfig(cfg); return { ok: true }; });

ipcMain.handle('terminal:spawn', (_e, { id, projectPath }) => {
  ptys.spawn(id, projectPath, (winId, data) => {
    if (mainWindow) mainWindow.webContents.send('terminal:data', { id: winId, data });
  });
  return { ok: true };
});

ipcMain.handle('dialog:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project Folder'
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:pick-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select Image',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.on('terminal:input',  (_e, { id, data })       => ptys.write(id, data));
ipcMain.on('terminal:resize', (_e, { id, cols, rows }) => ptys.resize(id, cols, rows));
ipcMain.on('terminal:kill',   (_e, { id })             => ptys.kill(id));

ipcMain.handle('git-branch', async (_e, dirPath) => {
  if (!dirPath || typeof dirPath !== 'string') return '';
  return new Promise(resolve => {
    const { execFile } = require('child_process');
    execFile('git', ['-C', dirPath, 'branch', '--show-current'],
      { timeout: 3000 },
      (_err, stdout) => resolve((stdout || '').trim())
    );
  });
});

ipcMain.handle('git-worktree-create', async (_e, { originalPath, worktreeKey }) => {
  if (!originalPath || typeof originalPath !== 'string') return { ok: false };
  if (!worktreeKey  || typeof worktreeKey  !== 'string') return { ok: false };
  const { execFile } = require('child_process');
  const _fs = require('fs');
  const worktreePath = path.join(originalPath, '.scc-worktrees', worktreeKey);

  // Auto-add .scc-worktrees to .gitignore if not already present
  try {
    const giPath = path.join(originalPath, '.gitignore');
    const existing = _fs.existsSync(giPath) ? _fs.readFileSync(giPath, 'utf8') : '';
    if (!existing.includes('.scc-worktrees')) {
      _fs.appendFileSync(giPath, '\n# DMT isolated worktrees\n.scc-worktrees\n');
    }
  } catch (_) {}

  return new Promise(resolve => {
    execFile('git', ['-C', originalPath, 'worktree', 'add', '--detach', worktreePath],
      { timeout: 10000 },
      (err) => {
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: true, path: worktreePath });
      }
    );
  });
});

ipcMain.handle('git-worktree-remove', async (_e, { originalPath, worktreeKey }) => {
  if (!originalPath || typeof originalPath !== 'string') return { ok: false };
  if (!worktreeKey  || typeof worktreeKey  !== 'string') return { ok: false };
  const { execFile } = require('child_process');
  const worktreePath = path.join(originalPath, '.scc-worktrees', worktreeKey);
  return new Promise(resolve => {
    execFile('git', ['-C', originalPath, 'worktree', 'remove', '--force', worktreePath],
      { timeout: 5000 },
      (err) => resolve({ ok: !err })
    );
  });
});

ipcMain.handle('git-diff', async (_e, dirPath) => {
  if (!dirPath || typeof dirPath !== 'string') return { stat: '', diff: '' };
  const { execFile } = require('child_process');
  const run = (args) => new Promise(resolve =>
    execFile('git', ['-C', dirPath, ...args], { timeout: 5000 },
      (_err, stdout) => resolve((stdout || '').trim())
    )
  );
  const [stat, diff] = await Promise.all([
    run(['diff', '--stat']),
    run(['diff'])
  ]);
  return { stat, diff };
});
