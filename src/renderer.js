'use strict';
const $ = id => document.getElementById(id);
let state, toastTimer;
async function command(action, data) {
  const response = await window.browser.command(action, data);
  if (!response.ok) { notify(response.error); throw new Error(response.error); }
  return response.result;
}
function run(action, data) { command(action, data).catch(() => {}); }
function notify(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
function button(text, className, callback, title) {
  const el = document.createElement('button'); el.textContent = text; el.className = className || '';
  el.onclick = callback; if (title) el.title = title; return el;
}
function render(next) {
  state = next;
  const active = state.tabs.find(t => t.id === state.activeId);
  $('tabs').replaceChildren(...state.tabs.map(tab => {
    const el = document.createElement('div'); el.className = 'tab' + (tab.id === state.activeId ? ' active' : '');
    el.append(button((tab.loading ? '◌ ' : '') + tab.title, 'tab-label', () => run('select-tab', tab.id), tab.title), button('×', 'tab-close', () => run('close-tab', tab.id), 'Закрыть вкладку'));
    return el;
  }));
  if (document.activeElement !== $('address')) $('address').value = active?.url || '';
  const mode = state.vpn.mode;
  $('vpn').className = 'vpn-pill ' + mode;
  $('vpn').textContent = mode === 'connected' ? '● VPN включён' : mode === 'connecting' ? '◌ Подключение' : mode === 'direct' ? '○ VPN выключен' : '◈ Подключить';
  $('vpn').disabled = state.busy;
  $('connection-status').textContent = state.vpn.message;
  $('settings-panel').hidden = !state.settingsOpen;
  $('home-panel').hidden = state.settingsOpen;
  $('auto-connect').checked = state.autoConnect;
  $('save-config').disabled = state.busy;
  $('close-settings').disabled = state.busy;
  $('import-preset').disabled = state.busy;
  $('config').disabled = state.busy;
  for (const id of ['server', 'server-port', 'password', 'server-name', 'insecure']) $(id).disabled = state.busy;
  $('card-title').textContent = mode === 'connected' ? 'Подключение AnyTLS активно' : mode === 'direct' ? 'Прямое подключение' : 'Защищённое подключение';
  $('card-description').textContent = mode === 'connected' ? 'Страницы открываются через ваш сервер AnyTLS.' : mode === 'direct' ? 'VPN выключен. Страницы используют обычное соединение.' : state.vpn.message;
  $('card-connect').textContent = mode === 'connected' ? 'Выключить' : state.configured ? 'Подключиться' : 'Настроить AnyTLS';
  $('card-connect').disabled = state.busy;
  $('page-error').textContent = active?.error || (active?.url && !['connected', 'direct'].includes(mode) ? 'Адрес сохранён. Подключитесь, чтобы открыть страницу.' : '');
  $('bookmark').textContent = state.bookmarks.some(b => b.url === active?.url) ? '★' : '☆';
  $('bookmarks').replaceChildren(...state.bookmarks.map(b => button(b.title || new URL(b.url).hostname, 'bookmark-link', () => run('navigate', b.url), b.url)));
  if (!state.bookmarks.length) $('bookmarks').textContent = 'Нажмите ☆ в адресной строке, чтобы сохранить страницу.';
  if (state.settingsOpen) $('settings-status').textContent = state.busy ? state.vpn.message : '';
}
$('new-tab').onclick = () => run('new-tab');
for (const id of ['back', 'forward', 'reload', 'home', 'bookmark']) $(id).onclick = () => run(id);
$('settings').onclick = () => run('settings', true);
$('close-settings').onclick = () => run('settings', false);
$('import-preset').onclick = async () => { try { const message = await command('import-preset'); if (message) notify(message); } catch {} };
function toggle() { run(state.vpn.mode === 'connected' ? 'direct' : 'connect'); }
$('vpn').onclick = toggle; $('card-connect').onclick = toggle;
for (const [form, field] of [['address-form', 'address'], ['search-form', 'search']]) $(form).onsubmit = e => { e.preventDefault(); run('navigate', $(field).value); $(field).blur(); };
$('save-config').onclick = async () => {
  try {
    const config = $('config').value.trim() || JSON.stringify({
      server: $('server').value.trim(), server_port: Number($('server-port').value),
      password: $('password').value, server_name: $('server-name').value.trim(), insecure: $('insecure').checked
    });
    await command('save-config', { config, autoConnect: $('auto-connect').checked });
    $('config').value = '';
    $('password').value = '';
  } catch (error) { $('settings-status').textContent = error.message; }
};
$('history').onclick = async () => {
  // Hide native page views before opening an HTML dialog.
  await command('settings', true);
  const items = await command('history');
  $('history-list').replaceChildren(...items.map(item => button(item.title + ' — ' + item.url, 'history-link', () => { $('history-dialog').close(); run('settings', false); run('navigate', item.url); })));
  if (!items.length) $('history-list').textContent = 'История пока пуста.';
  $('history-dialog').showModal();
};
$('history-dialog').addEventListener('close', () => run('settings', false));
$('close-history').onclick = () => $('history-dialog').close();
window.browser.onState(render);
window.browser.onFocusAddress(() => { $('address').focus(); $('address').select(); });
command('state').then(render).catch(() => {});
