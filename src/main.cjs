'use strict';
const { app, BrowserWindow, WebContentsView, session, ipcMain, safeStorage, dialog, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { normalizeConfig, navigationURL } = require('./config.cjs');
const { VpnController } = require('./vpn.cjs');
const { MieruEngine } = require('./engine.cjs');

// CI launches the actual signed application in a fresh, disconnected profile.
const smoke = process.env.MIERU_BROWSER_SMOKE === '1';
if (smoke) app.setPath('userData', require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'mieru-packaged-smoke-')));

app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  let win, browserSession, probeSession, vpn, engine, preferences, encryptedPath;
  let tabs = [], activeId, settingsOpen = false, nextId = 1, shuttingDown = false, heartbeat;
  let operationBusy = false, healthBusy = false, currentPort;
  const downloads = new Set();
  const uiFile = path.join(__dirname, 'index.html');
  const uiURL = pathToFileURL(uiFile).href;
  const partition = 'persist:mieru-pages';

  function activeTab() { return tabs.find(t => t.id === activeId); }
  function snapshot() {
    return { tabs: tabs.map(({ view, ...t }) => t), activeId, vpn: vpn.state,
      configured: preferences.configured, autoConnect: preferences.autoConnect,
      settingsOpen, busy: operationBusy, bookmarks: preferences.bookmarks };
  }
  function send() { if (win && !win.isDestroyed()) win.webContents.send('state', snapshot()); }
  async function savePrefs() {
    const file = path.join(app.getPath('userData'), 'preferences.json');
    await fs.writeFile(file + '.tmp', JSON.stringify(preferences), { mode: 0o600 });
    await fs.rename(file + '.tmp', file);
  }
  function destroyView(tab) {
    if (!tab.view) return;
    win.contentView.removeChildView(tab.view);
    tab.view.webContents.close({ waitForBeforeUnload: false });
    tab.view = null;
    tab.loading = false;
  }
  async function clearConnections() {
    for (const item of downloads) item.cancel();
    for (const tab of tabs) destroyView(tab);
  }
  function layout() {
    if (!win || win.isDestroyed()) return;
    const [width, height] = win.getContentSize();
    for (const t of tabs) if (t.view) {
      t.view.setBounds({ x: 0, y: 116, width, height: Math.max(0, height - 116) });
      t.view.setVisible(t.id === activeId && !settingsOpen && !t.error);
    }
  }
  function focusActive() { if (activeTab()?.view && !settingsOpen) activeTab().view.webContents.focus(); }
  function makeView(tab) {
    const view = new WebContentsView({ webPreferences: {
      partition, nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, plugins: false, webviewTag: false,
      navigateOnDragDrop: false
    }});
    tab.view = view;
    const wc = view.webContents;
    wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) addTab(url);
      return { action: 'deny' };
    });
    const guard = (event, url) => { if (!/^https?:\/\//i.test(url) && url !== 'about:blank') event.preventDefault(); };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('will-frame-navigate', (event) => guard(event, event.url));
    wc.on('page-title-updated', (_, title) => { tab.title = title.slice(0, 150); send(); });
    wc.on('did-start-loading', () => { tab.loading = true; send(); });
    wc.on('did-stop-loading', () => { tab.loading = false; send(); });
    const navigated = (_, url) => {
      tab.url = url; tab.error = ''; send();
      if (/^https?:\/\//i.test(url)) {
        preferences.history.unshift({ url, title: tab.title, at: Date.now() });
        preferences.history = preferences.history.slice(0, 200);
        savePrefs().catch(() => {});
      }
    };
    wc.on('did-navigate', navigated);
    wc.on('did-navigate-in-page', navigated);
    wc.on('did-fail-load', (_, code, description, url, mainFrame) => {
      if (!mainFrame || code === -3) return;
      tab.error = `Страница не загрузилась (${code}). Проверьте адрес или повторите попытку.`;
      tab.loading = false; layout(); send();
      if (vpn.state.mode === 'connected' && [-130, -111, -120].includes(code)) vpn.fail().catch(() => {});
    });
    wc.on('render-process-gone', () => { tab.error = 'Вкладка остановлена. Нажмите обновить.'; destroyView(tab); send(); });
    wc.on('before-input-event', (event, input) => {
      if (shortcut(input)) event.preventDefault();
    });
    win.contentView.addChildView(view);
    layout();
    return view;
  }
  function loadTab(tab) {
    if (!tab || !tab.url || !vpn.allowRequests) return;
    tab.error = '';
    const view = tab.view || makeView(tab);
    layout();
    view.webContents.loadURL(tab.url).catch(() => {});
  }
  function restoreActive() { if (activeTab()?.url && !activeTab().view) loadTab(activeTab()); layout(); send(); }
  function addTab(url = '') {
    if (tabs.length >= 30) throw new Error('Можно открыть до 30 вкладок.');
    const tab = { id: nextId++, title: 'Новая вкладка', url, error: '', loading: false, view: null };
    tabs.push(tab); activeId = tab.id; loadTab(tab); layout(); send(); return tab;
  }
  function shortcut(input) {
    if (input.type !== 'keyDown' || !(input.control || input.meta)) return false;
    const key = input.key.toLowerCase();
    if (key === 'l') { win.webContents.focus(); win.webContents.send('focus-address'); return true; }
    if (key === 't') { addTab(); return true; }
    if (key === 'w') { closeTab(activeId); return true; }
    if (key === 'r') { loadTab(activeTab()); return true; }
    return false;
  }
  function closeTab(id) {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    destroyView(tab); tabs = tabs.filter(t => t.id !== id);
    if (!tabs.length) addTab();
    else if (activeId === id) activeId = tabs[tabs.length - 1].id;
    restoreActive();
  }
  async function readConfig() {
    try { return safeStorage.decryptString(await fs.readFile(encryptedPath)); }
    catch { throw new Error('Не удалось прочитать настройки. Вставьте конфигурацию Mieru заново.'); }
  }
  async function probe(port) {
    await probeSession.setProxy({ mode: 'fixed_servers', proxyRules: `socks5://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
    await probeSession.closeAllConnections();
    const response = await probeSession.fetch('https://example.com/', {
      cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error('Проверка подключения не пройдена.');
  }
  async function exclusive(fn) {
    if (operationBusy) throw new Error('Дождитесь завершения текущей операции.');
    operationBusy = true; send();
    try { return await fn(); } finally { operationBusy = false; send(); }
  }
  async function handle(action, data) {
    switch (action) {
      case 'state': return snapshot();
      case 'navigate': { const url = navigationURL(data); if (url) { activeTab().url = url; loadTab(activeTab()); send(); } break; }
      case 'new-tab': addTab(); break;
      case 'close-tab': closeTab(data); break;
      case 'select-tab': if (tabs.some(t => t.id === data)) { activeId = data; restoreActive(); } break;
      case 'back': { const h = activeTab()?.view?.webContents.navigationHistory; if (h?.canGoBack()) h.goBack(); break; }
      case 'forward': { const h = activeTab()?.view?.webContents.navigationHistory; if (h?.canGoForward()) h.goForward(); break; }
      case 'reload': loadTab(activeTab()); break;
      case 'home': destroyView(activeTab()); Object.assign(activeTab(), { url: '', title: 'Новая вкладка', error: '' }); send(); break;
      case 'settings': settingsOpen = Boolean(data); layout(); send(); break;
      case 'save-config': return exclusive(async () => {
        normalizeConfig(data?.config);
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Системное защищённое хранилище недоступно.');
        await vpn.fail('Настройки изменены. Подключаемся…');
        await fs.writeFile(encryptedPath + '.tmp', safeStorage.encryptString(data.config), { mode: 0o600 });
        await fs.rename(encryptedPath + '.tmp', encryptedPath);
        preferences.configured = true; preferences.autoConnect = Boolean(data.autoConnect);
        await savePrefs();
        await vpn.connect(await readConfig());
        settingsOpen = false; restoreActive();
      });
      case 'connect': return exclusive(async () => {
        if (!preferences.configured) { settingsOpen = true; layout(); send(); return; }
        await vpn.connect(await readConfig()); restoreActive();
      });
      case 'direct': return exclusive(async () => {
        const result = await dialog.showMessageBox(win, { type: 'warning', title: 'Выключить VPN?',
          message: 'Страницы будут открываться через обычное подключение.',
          buttons: ['Оставить защиту', 'Выключить VPN'], defaultId: 0, cancelId: 0 });
        if (result.response === 1) { await vpn.direct(); restoreActive(); }
      });
      case 'bookmark': {
        const tab = activeTab(); if (!tab.url) break;
        if (preferences.bookmarks.some(b => b.url === tab.url)) preferences.bookmarks = preferences.bookmarks.filter(b => b.url !== tab.url);
        else preferences.bookmarks.push({ title: tab.title, url: tab.url });
        await savePrefs(); send(); break;
      }
      case 'history': return preferences.history;
      default: throw new Error('Неизвестная команда.');
    }
    return null;
  }
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    const directory = app.getPath('userData');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    encryptedPath = path.join(directory, 'connection.enc');
    preferences = { configured: false, autoConnect: true, bookmarks: [], history: [] };
    try { Object.assign(preferences, JSON.parse(await fs.readFile(path.join(directory, 'preferences.json'), 'utf8'))); } catch {}
    browserSession = session.fromPartition(partition);
    probeSession = session.fromPartition('mieru-probe');
    for (const ses of [browserSession, probeSession]) {
      ses.setPermissionRequestHandler((_, __, callback) => callback(false));
      ses.setPermissionCheckHandler(() => false);
    }
    const binary = app.isPackaged
      ? path.join(process.resourcesPath, 'mieru', process.platform === 'win32' ? 'mieru.exe' : 'mieru')
      : path.join(__dirname, '..', 'resources', 'mieru', `${process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'}-${process.arch}`, process.platform === 'win32' ? 'mieru.exe' : 'mieru');
    engine = new MieruEngine({ binary, directory: path.join(directory, 'mieru-runtime'), onExit: () => { if (!shuttingDown) vpn.fail().catch(() => {}); } });
    await engine.cleanup();
    vpn = new VpnController({ session: browserSession, engine, probe: async port => { await probe(port); currentPort = port; }, onTransition: clearConnections, onState: send });
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !vpn.allowRequests || !/^(https?|wss?|blob|data|about):/i.test(details.url) });
    });
    browserSession.on('will-download', (event, item) => {
      if (!vpn.allowRequests) { event.preventDefault(); return; }
      downloads.add(item); item.once('done', () => downloads.delete(item));
      item.setSaveDialogOptions({ title: 'Сохранить загрузку' });
    });
    await vpn.initialize();
    win = new BrowserWindow({ width: 1280, height: 850, minWidth: 840, minHeight: 620,
      backgroundColor: '#11151d', title: 'Mieru Browser',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.webContents.on('before-input-event', (event, input) => { if (shortcut(input)) event.preventDefault(); });
    win.on('resize', layout);
    win.on('close', event => { if (!shuttingDown) { event.preventDefault(); app.quit(); } });
    ipcMain.handle('command', async (event, action, data) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== uiURL) throw new Error('Доступ запрещён.');
      try { return { ok: true, result: await handle(action, data) }; }
      catch (error) { return { ok: false, error: error.message }; }
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'Правка', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'Окно', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'togglefullscreen' }] }
    ]));
    addTab(); settingsOpen = !preferences.configured;
    await win.loadFile(uiFile);
    send();
    if (smoke) {
      const result = await win.webContents.executeJavaScript("window.browser.command('state')");
      if (!result.ok || result.result.vpn.mode !== 'blocked' || !result.result.settingsOpen) throw new Error('Packaged first-run state is invalid');
      console.log('MIERU_PACKAGED_SMOKE_OK');
      app.quit();
      return;
    }
    if (preferences.configured && preferences.autoConnect) {
      exclusive(async () => { await vpn.connect(await readConfig()); restoreActive(); }).catch(() => send());
    }
    heartbeat = setInterval(async () => {
      if (vpn.state.mode !== 'connected' || operationBusy || healthBusy) return;
      healthBusy = true;
      const generation = vpn.generation;
      try { await probe(currentPort); }
      catch { if (!shuttingDown && generation === vpn.generation && vpn.state.mode === 'connected') await vpn.fail(); }
      finally { healthBusy = false; }
    }, 30000);
  }).catch(error => { dialog.showErrorBox('Mieru Browser', 'Не удалось запустить браузер: ' + error.message); app.quit(); });
  app.on('before-quit', event => {
    if (shuttingDown) return;
    event.preventDefault(); shuttingDown = true; clearInterval(heartbeat);
    if (vpn) vpn.allowRequests = false;
    Promise.resolve().then(() => win && clearConnections()).then(() => engine?.stop()).finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
}
