'use strict';
const { isIP } = require('node:net');

function normalizeConfig(input, ports = { socks: 10880 }) {
  if (typeof input !== 'string' || Buffer.byteLength(input) > 128 * 1024) throw new Error('Вставьте настройки AnyTLS (до 128 КБ).');
  let source;
  if (input.trim().startsWith('anytls://')) {
    let url;
    try { url = new URL(input.trim()); } catch { throw new Error('Неверная ссылка AnyTLS.'); }
    if (url.password) throw new Error('AnyTLS использует только пароль: anytls://пароль@сервер:порт.');
    source = { server: url.hostname.replace(/^\[|\]$/g, ''), server_port: Number(url.port || 443),
      password: decodeURIComponent(url.username), server_name: url.searchParams.get('sni') || url.searchParams.get('peer') || '',
      insecure: ['1', 'true'].includes(url.searchParams.get('insecure') || url.searchParams.get('allowInsecure')) };
    const supported = ['sni', 'peer', 'insecure', 'allowInsecure'];
    for (const key of url.searchParams.keys()) if (!supported.includes(key)) throw new Error('Неизвестный параметр ссылки AnyTLS: ' + key);
  } else {
    try { source = JSON.parse(input); } catch { throw new Error('Неверный JSON или ссылка AnyTLS.'); }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Нужен объект с настройками AnyTLS.');
  if (source.profiles) throw new Error('Это настройки Mieru. Введите данные сервера AnyTLS.');
  if (source.type && source.type !== 'anytls') throw new Error('Поддерживается только AnyTLS.');
  const host = source.server;
  if (typeof host !== 'string' || !host || host !== host.trim() || /[\s/\\@?#]/.test(host) || (!isIP(host) && !/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(host))) throw new Error('Укажите домен или IP-адрес сервера AnyTLS.');
  if (!Number.isInteger(source.server_port) || source.server_port < 1 || source.server_port > 65535) throw new Error('Укажите порт от 1 до 65535.');
  if (typeof source.password !== 'string' || !source.password || source.password.length > 4096) throw new Error('Укажите пароль AnyTLS.');
  if (source.tls !== undefined && (!source.tls || typeof source.tls !== 'object' || Array.isArray(source.tls))) throw new Error('Неверные настройки TLS.');
  const tlsSource = source.tls || source;
  if (tlsSource.enabled === false) throw new Error('Для AnyTLS требуется TLS.');
  if (tlsSource.insecure !== undefined && typeof tlsSource.insecure !== 'boolean') throw new Error('insecure должен быть true или false.');
  const serverName = tlsSource.server_name || '';
  if (typeof serverName !== 'string' || /[\s/\\@?#]/.test(serverName)) throw new Error('Неверный SNI.');
  const tls = { enabled: true, insecure: tlsSource.insecure === true };
  if (serverName) tls.server_name = serverName;
  if (tlsSource.certificate !== undefined) {
    const certs = Array.isArray(tlsSource.certificate) ? tlsSource.certificate : [tlsSource.certificate];
    if (!certs.length || certs.some(c => typeof c !== 'string' || !c.includes('-----BEGIN CERTIFICATE-----'))) throw new Error('Нужен PEM-сертификат.');
    tls.certificate = certs;
  }
  // Build the network topology ourselves: imported settings cannot add a bypass,
  // a public listener, a control API, or file paths for credentials/certificates.
  const outbound = { type: 'anytls', tag: 'proxy', server: host, server_port: source.server_port,
    password: source.password, tls };
  return {
    log: { level: 'error' },
    dns: { servers: [{ type: 'local', tag: 'bootstrap' }] },
    inbounds: [{ type: 'socks', tag: 'browser', listen: '127.0.0.1', listen_port: ports.socks }],
    outbounds: [outbound],
    route: { final: 'proxy', default_domain_resolver: 'bootstrap' }
  };
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
