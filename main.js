const { app, BrowserWindow, ipcMain } = require('electron');
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
      nodeIntegration: false
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

ipcMain.on('terminal:input',  (_e, { id, data })       => ptys.write(id, data));
ipcMain.on('terminal:resize', (_e, { id, cols, rows }) => ptys.resize(id, cols, rows));
ipcMain.on('terminal:kill',   (_e, { id })             => ptys.kill(id));
