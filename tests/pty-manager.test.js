const PtyManager = require('../pty-manager');

test('spawn creates a pty entry', done => {
  const mgr = new PtyManager();
  mgr.spawn('t1', '/tmp', () => {});
  expect(mgr.has('t1')).toBe(true);
  mgr.kill('t1');
  done();
});

test('kill removes the pty entry', done => {
  const mgr = new PtyManager();
  mgr.spawn('t2', '/tmp', () => {});
  mgr.kill('t2');
  expect(mgr.has('t2')).toBe(false);
  done();
});

test('write does not throw for active pty', done => {
  const mgr = new PtyManager();
  mgr.spawn('t3', '/tmp', () => {});
  expect(() => mgr.write('t3', 'ls\n')).not.toThrow();
  mgr.kill('t3');
  done();
});

test('write is a no-op for unknown id', () => {
  const mgr = new PtyManager();
  expect(() => mgr.write('unknown', 'ls\n')).not.toThrow();
});

test('resize does not throw for active pty', done => {
  const mgr = new PtyManager();
  mgr.spawn('t4', '/tmp', () => {});
  expect(() => mgr.resize('t4', 100, 30)).not.toThrow();
  mgr.kill('t4');
  done();
});

test('killAll kills all active ptys', done => {
  const mgr = new PtyManager();
  mgr.spawn('a', '/tmp', () => {});
  mgr.spawn('b', '/tmp', () => {});
  mgr.killAll();
  expect(mgr.has('a')).toBe(false);
  expect(mgr.has('b')).toBe(false);
  done();
});
