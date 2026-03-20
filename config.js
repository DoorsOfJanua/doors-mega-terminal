const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DEFAULT_CONFIG = {
  welcomeSeen: false,
  claudeShortcut: 'Ctrl+Shift+C',
  projects: []
};

function createConfig(configPath) {
  if (!configPath || typeof configPath !== 'string') {
    throw new TypeError('configPath must be a non-empty string');
  }

  function readConfig() {
    try {
      const raw  = fs.readFileSync(configPath, 'utf8');
      const data = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...data };
    } catch (_) {
      return { ...DEFAULT_CONFIG };
    }
  }

  function writeConfig(data) {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
  }

  // Poll every 2s — fs.watch is unreliable cross-platform
  function watchConfig(onChange) {
    let last = '';
    return setInterval(() => {
      try {
        const raw = fs.readFileSync(configPath, 'utf8');
        if (raw !== last) { last = raw; onChange(JSON.parse(raw)); }
      } catch (_) {}
    }, 2000);
  }

  return { readConfig, writeConfig, watchConfig };
}

const DEFAULT_PATH = path.join(os.homedir(), '.spaceship', 'config.json');
const { readConfig, writeConfig, watchConfig } = createConfig(DEFAULT_PATH);

module.exports = { readConfig, writeConfig, watchConfig, createConfig, DEFAULT_CONFIG };
