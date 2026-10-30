'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn, spawnSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const { AnyTlsEngine, freePort } = require('../src/engine.cjs');
const { normalizeConfig } = require('../src/config.cjs');
const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
const binary = path.join(__dirname, '..', 'resources', 'sing-box', `${platform}-${process.arch}`, process.platform === 'win32' ? 'sing-box.exe' : 'sing-box');
const fixtureDir = path.join(__dirname, 'fixtures');
const pause = ms => new Promise(r => setTimeout(r, ms));
const liveSkip = !existsSync(binary) || process.env.SKIP_NETWORK_TESTS === '1';

test('pinned sing-box accepts generated AnyTLS config with certificate validation', { skip: !existsSync(binary) }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anytls-check-'));
  try {
    const file = path.join(dir, 'config.json');
    await fs.writeFile(file, JSON.stringify(normalizeConfig(JSON.stringify({ server: 'example.invalid', server_port: 443, password: 'example-only', server_name: 'example.invalid' }))));
    const result = spawnSync(binary, ['check', '-c', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('real AnyTLS server/client carries HTTP over verified TLS and rejects wrong password/certificate', { skip: liveSkip, timeout: 60000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anytls-e2e-'));
  const target = http.createServer((_, response) => response.end('ANYTLS_VERIFIED_ROUND_TRIP'));
  const engine = new AnyTlsEngine({ binary, directory: path.join(dir, 'client') });
  let server;
  try {
    await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
    const targetPort = target.address().port;
    const serverPort = await freePort();
    const file = path.join(dir, 'server.json');
    await fs.writeFile(file, JSON.stringify({ log: { level: 'error' }, inbounds: [{ type: 'anytls', listen: '127.0.0.1', listen_port: serverPort, users: [{ name: 'test', password: 'test-only' }], tls: { enabled: true, certificate_path: path.join(fixtureDir, 'localhost-cert.pem'), key_path: path.join(fixtureDir, 'localhost-key.pem') } }], outbounds: [{ type: 'direct', tag: 'direct' }], route: { final: 'direct' } }));
    server = spawn(binary, ['run', '-c', file], { stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 80; i++) {
      assert.equal(server.exitCode, null, 'Test AnyTLS server exited');
      const ready = await new Promise(resolve => { const s = net.connect(serverPort, '127.0.0.1'); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
      if (ready) break;
      await pause(100);
    }
    const certificate = await fs.readFile(path.join(fixtureDir, 'localhost-cert.pem'), 'utf8');
    const connection = { server: '127.0.0.1', server_port: serverPort, password: 'test-only', server_name: 'localhost', certificate };
    const request = port => execute(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--silent', '--show-error', '--fail', '--max-time', '5', '--noproxy', '', '--proxy', `socks5h://127.0.0.1:${port}`, `http://127.0.0.1:${targetPort}/`], { timeout: 10000 });
    let port = await engine.start(JSON.stringify(connection));
    assert.equal((await request(port)).stdout, 'ANYTLS_VERIFIED_ROUND_TRIP');
    await engine.stop();
    port = await engine.start(JSON.stringify({ ...connection, password: 'wrong-test-password' }));
    await assert.rejects(request(port));
    await engine.stop();
    port = await engine.start(JSON.stringify({ ...connection, certificate: undefined }));
    await assert.rejects(request(port));
  } finally {
    await engine.stop();
    if (server && server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
    await new Promise(resolve => target.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
