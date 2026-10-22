'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { normalizeConfig } = require('./config.cjs');
const pause = ms => new Promise(r => setTimeout(r, ms));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}
async function socksReady(port) {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    const finish = ok => { socket.destroy(); resolve(ok); };
    socket.setTimeout(400, () => finish(false));
    socket.once('error', () => finish(false));
    socket.once('connect', () => socket.write(Buffer.from([5, 1, 0])));
    let result = Buffer.alloc(0);
    socket.on('data', data => { result = Buffer.concat([result, data]); if (result.length >= 2) finish(result[0] === 5 && result[1] === 0); });
  });
}
class MieruEngine {
  constructor({ binary, directory, onExit = () => {} }) { Object.assign(this, { binary, directory, onExit }); this.child = null; }
  async cleanup() { await fs.mkdir(this.directory, { recursive: true, mode: 0o700 }); await fs.rm(path.join(this.directory, 'runtime-config.json'), { force: true }); }
  async start(raw) {
    await this.cleanup();
    const socks = await freePort();
    let rpc = await freePort();
    while (rpc === socks) rpc = await freePort();
    const config = normalizeConfig(raw, { socks, rpc });
    const configPath = path.join(this.directory, 'runtime-config.json');
    await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    const environment = { ...process.env, MIERU_CONFIG_JSON_FILE: configPath };
    // An empty MIERU_CONFIG_FILE still overrides the JSON path in Mieru.
    delete environment.MIERU_CONFIG_FILE;
    const child = spawn(this.binary, ['run'], {
      env: environment,
      windowsHide: true, stdio: ['ignore', 'ignore', 'ignore']
    });
    this.child = child;
    let dead = false;
    child.once('error', () => { dead = true; });
    child.once('exit', () => { dead = true; if (this.child === child) { this.child = null; this.onExit(); } });
    for (let i = 0; i < 100; i++) {
      if (dead) break;
      if (await socksReady(socks)) return socks;
      await pause(100);
    }
    await this.stop();
    throw new Error('Не удалось запустить встроенный Mieru.');
  }
  async stop() {
    const child = this.child;
    this.child = null; // An intentional shutdown must not trigger onExit.
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2000);
        const done = () => { clearTimeout(timer); resolve(); };
        child.once('exit', done);
        child.once('error', done);
        child.kill();
      });
    }
    await this.cleanup();
  }
}
module.exports = { MieruEngine, freePort, socksReady };
