const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scc', {
  // Terminal
  termSpawn:  (id, projectPath) => ipcRenderer.invoke('terminal:spawn', { id, projectPath }),
  termInput:  (id, data)        => ipcRenderer.send('terminal:input',   { id, data }),
  termResize: (id, cols, rows)  => ipcRenderer.send('terminal:resize',  { id, cols, rows }),
  termKill:   (id)              => ipcRenderer.send('terminal:kill',    { id }),
  onTermData: (cb) => ipcRenderer.on('terminal:data', (_e, payload) => cb(payload)),

  // Config
  readConfig:      ()    => ipcRenderer.invoke('config:read'),
  writeConfig:     (cfg) => ipcRenderer.invoke('config:write', cfg),
  onConfigChanged: (cb)  => ipcRenderer.on('config:changed', (_e, cfg) => cb(cfg)),
});
