'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MieruEngine, socksReady } = require('../src/engine.cjs');
const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
const binary = path.join(__dirname, '..', 'resources', 'mieru', `${platform}-${process.arch}`, process.platform === 'win32' ? 'mieru.exe' : 'mieru');
test('real pinned Mieru starts an isolated SOCKS endpoint and removes temporary credentials', { skip: !existsSync(binary), timeout: 20000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mieru-browser-test-'));
  let unexpected = false;
  const engine = new MieruEngine({ binary, directory, onExit: () => { unexpected = true; } });
  try {
    const port = await engine.start(JSON.stringify({ profiles: [{ profileName: 'test', user: { name: 'test', password: 'test-only' }, servers: [{ ipAddress: '127.0.0.1', portBindings: [{ port: 9, protocol: 'TCP' }] }] }], activeProfile: 'test' }));
    assert(await socksReady(port));
    assert(existsSync(path.join(directory, 'runtime-config.json')));
    await engine.stop();
    assert.equal(await socksReady(port), false);
    assert.equal(existsSync(path.join(directory, 'runtime-config.json')), false);
    assert.equal(unexpected, false);
  } finally { await engine.stop(); await fs.rm(directory, { recursive: true, force: true }); }
});
