'use strict';
// UI smoke test, not loaded by the distributed app. No real credentials required.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mieru-ui-smoke-'));
app.setPath('userData', directory);
// Allow isolated smoke tests in containers which prohibit UNIX singleton sockets.
app.requestSingleInstanceLock = () => true;
const timeout = setTimeout(() => { console.error('UI smoke timed out'); app.exit(1); }, 15000);
require('../src/main.cjs');
app.whenReady().then(() => {
  const timer = setInterval(async () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.webContents.isLoading()) return;
    clearInterval(timer);
    try {
      const command = (action, data) => win.webContents.executeJavaScript(`window.browser.command(${JSON.stringify(action)},${JSON.stringify(data)})`);
      const initial = await command('state');
      assert(initial.ok);
      assert.equal(initial.result.vpn.mode, 'blocked');
      assert.equal(initial.result.configured, false);
      assert(initial.result.settingsOpen);
      const invalid = await command('save-config', { config: '{}', autoConnect: true });
      assert.equal(invalid.ok, false);
      await command('settings', false);
      await command('new-tab');
      let state = (await command('state')).result;
      assert.equal(state.tabs.length, 2);
      await command('navigate', 'https://example.com/');
      state = (await command('state')).result;
      assert.equal(state.vpn.mode, 'blocked');
      assert.equal(state.tabs.find(t => t.id === state.activeId).url, 'https://example.com/');
      await new Promise(resolve => setTimeout(resolve, 100));
      const dom = await win.webContents.executeJavaScript(`({tabs:document.querySelectorAll('.tab').length,vpn:document.getElementById('vpn').textContent})`);
      assert.equal(dom.tabs, 2);
      assert(dom.vpn.includes('Подключить'));
      console.log('UI smoke passed: first-run setup, IPC, tabs, blocked navigation, renderer state');
      clearTimeout(timeout);
      app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  }, 100);
});
app.on('quit', () => { try { fs.rmSync(directory, { recursive: true, force: true }); } catch {} });
