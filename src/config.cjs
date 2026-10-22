'use strict';
const { isIP } = require('node:net');

function normalizeConfig(input, ports = { socks: 10880, rpc: 10881 }) {
  if (typeof input !== 'string' || Buffer.byteLength(input) > 128 * 1024) throw new Error('Вставьте JSON-конфигурацию Mieru (до 128 КБ).');
  let config;
  try { config = JSON.parse(input); } catch { throw new Error('Неверный JSON. Вставьте полную клиентскую конфигурацию Mieru.'); }
  if (!config || !Array.isArray(config.profiles) || !config.profiles.length) throw new Error('В конфигурации отсутствует profiles.');
  if (!config.activeProfile) config.activeProfile = config.profiles[0].profileName;
  if (!config.profiles.some(p => p.profileName === config.activeProfile)) throw new Error('Не найден активный профиль.');
  for (const p of config.profiles) {
    if (typeof p.profileName !== 'string' || !p.profileName.trim()) throw new Error('Укажите имя профиля.');
    if (!p.user || typeof p.user.name !== 'string' || !p.user.name || !(p.user.password || p.user.hashedPassword)) throw new Error('В профиле нужны имя пользователя и пароль Mieru.');
    if (!Array.isArray(p.servers) || !p.servers.length) throw new Error('Укажите сервер Mieru.');
    for (const s of p.servers) {
      if (!(typeof s.domainName === 'string' && s.domainName.trim()) && !isIP(s.ipAddress || '')) throw new Error('Укажите домен или IP-адрес сервера.');
      if (!Array.isArray(s.portBindings) || !s.portBindings.length) throw new Error('Укажите порт сервера.');
      for (const b of s.portBindings) {
        if (!['TCP', 'UDP'].includes(b.protocol)) throw new Error('Протокол порта должен быть TCP или UDP.');
        if (b.port !== undefined && b.portRange !== undefined) throw new Error('Укажите port или portRange, но не оба.');
        if (b.portRange !== undefined) {
          const match = /^(\d+)-(\d+)$/.exec(b.portRange);
          if (!match || +match[1] < 1 || +match[2] > 65535 || +match[1] > +match[2]) throw new Error('Неверный диапазон портов.');
        } else if (!Number.isInteger(b.port) || b.port < 1 || b.port > 65535) throw new Error('Неверный порт сервера.');
      }
    }
  }
  // Never expose an imported listener to the LAN. Chromium talks to our local SOCKS endpoint.
  config.socks5Port = ports.socks;
  config.rpcPort = ports.rpc;
  config.socks5ListenLAN = false;
  delete config.httpProxyPort;
  delete config.httpProxyListenLAN;
  delete config.socks5Authentication;
  config.loggingLevel = 'ERROR';
  return config;
}

function navigationURL(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Неверный адрес.');
  const text = value.trim();
  if (!text) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(text) && !/^[\w.-]+:\d+(?:\/|$)/.test(text)) {
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Разрешены только HTTP и HTTPS.');
    return url.href;
  }
  if (!/\s/.test(text) && (/^[\w.-]+(?::\d+)?(?:\/|$)/.test(text)) && (text.includes('.') || /^localhost(?::|\/|$)/.test(text))) return new URL('https://' + text).href;
  return 'https://www.google.com/search?q=' + encodeURIComponent(text);
}

module.exports = { normalizeConfig, navigationURL };
