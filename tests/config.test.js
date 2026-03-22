const os   = require('os');
const fs   = require('fs');
const path = require('path');

const TEST_PATH = path.join(os.tmpdir(), 'scc-test', 'config.json');
const { createConfig, DEFAULT_CONFIG } = require('../config');

let cfg;
beforeEach(() => {
  if (fs.existsSync(TEST_PATH)) fs.unlinkSync(TEST_PATH);
  cfg = createConfig(TEST_PATH);
});

test('readConfig returns defaults when no file exists', () => {
  const result = cfg.readConfig();
  expect(result.welcomeSeen).toBe(false);
  expect(result.projects).toEqual([]);
  expect(result.claudeShortcut).toBe('Ctrl+Shift+C');
});

test('writeConfig persists and readConfig reads it back', () => {
  cfg.writeConfig({ ...DEFAULT_CONFIG, welcomeSeen: true });
  expect(cfg.readConfig().welcomeSeen).toBe(true);
});

test('readConfig merges missing keys with defaults', () => {
  fs.mkdirSync(path.dirname(TEST_PATH), { recursive: true });
  fs.writeFileSync(TEST_PATH, JSON.stringify({ welcomeSeen: true }));
  const result = cfg.readConfig();
  expect(result.welcomeSeen).toBe(true);
  expect(result.projects).toEqual([]);
});

test('writeConfig creates directory if missing', () => {
  const dir = path.dirname(TEST_PATH);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  expect(() => cfg.writeConfig(DEFAULT_CONFIG)).not.toThrow();
  expect(fs.existsSync(TEST_PATH)).toBe(true);
});

test('readConfig returns defaults when file contains invalid JSON', () => {
  fs.mkdirSync(path.dirname(TEST_PATH), { recursive: true });
  fs.writeFileSync(TEST_PATH, '{ not valid json !!!');
  const result = cfg.readConfig();
  expect(result).toEqual(DEFAULT_CONFIG);
});

test('tokenBudget defaults to 500', () => {
  const result = cfg.readConfig();
  expect(result.tokenBudget).toBe(500);
});

test('keywordAlerts defaults to 4 rules', () => {
  const result = cfg.readConfig();
  expect(result.keywordAlerts).toHaveLength(4);
  expect(result.keywordAlerts[0].pattern).toBe('error');
});

test('writeConfig persists tokenBudget', () => {
  cfg.writeConfig({ tokenBudget: 999 });
  const result = cfg.readConfig();
  expect(result.tokenBudget).toBe(999);
});
