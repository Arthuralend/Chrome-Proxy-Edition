'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AnyTlsEngine, socksReady } = require('../src/engine.cjs');
const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
const binary = path.join(__dirname, '..', 'resources', 'sing-box', `${platform}-${process.arch}`, process.platform === 'win32' ? 'sing-box.exe' : 'sing-box');
test('real pinned sing-box starts an isolated SOCKS endpoint and removes temporary credentials', { skip: !existsSync(binary) || process.env.SKIP_NETWORK_TESTS === '1', timeout: 20000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mieru-browser-test-'));
  let unexpected = false;
  const engine = new AnyTlsEngine({ binary, directory, onExit: () => { unexpected = true; } });
  try {
    const port = await engine.start(JSON.stringify({ server: '127.0.0.1', server_port: 9, password: 'test-only', server_name: 'localhost' }));
    assert(await socksReady(port));
    assert(existsSync(path.join(directory, 'runtime-config.json')));
    await engine.stop();
    assert.equal(await socksReady(port), false);
    assert.equal(existsSync(path.join(directory, 'runtime-config.json')), false);
    assert.equal(unexpected, false);
  } finally { await engine.stop(); await fs.rm(directory, { recursive: true, force: true }); }
});
