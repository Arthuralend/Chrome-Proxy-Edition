'use strict';
const BLOCKED_PROXY = { mode: 'fixed_servers', proxyRules: 'socks5://127.0.0.1:1', proxyBypassRules: '<-loopback>' };

// All transitions are serialized; the request gate closes before touching live connections.
class VpnController {
  constructor({ session, engine, probe, onTransition = async () => {}, onState = () => {} }) {
    Object.assign(this, { session, engine, probe, onTransition, onState });
    this.state = { mode: 'blocked', message: 'Подключение не настроено' };
    this.allowRequests = false;
    this.tail = Promise.resolve();
    this.generation = 0;
  }
  enqueue(fn) { const job = this.tail.then(fn); this.tail = job.catch(() => {}); return job; }
  emit(mode, message) { this.state = { mode, message }; this.onState(this.state); }
  async seal(message = 'Соединение заблокировано') {
    this.allowRequests = false;
    this.generation++;
    this.emit('blocked', message);
    await this.onTransition();
    await this.session.setProxy(BLOCKED_PROXY);
    await this.session.closeAllConnections();
  }
  initialize() { return this.enqueue(() => this.seal()); }
  connect(config) { return this.enqueue(async () => {
    await this.seal('Подключаем Mieru…');
    const attempt = this.generation;
    this.emit('connecting', 'Подключаем Mieru…');
    try {
      await this.engine.stop();
      const port = await this.engine.start(config);
      await this.session.setProxy({ mode: 'fixed_servers', proxyRules: `socks5://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
      await this.session.closeAllConnections();
      // Only the isolated probe session is allowed until the server check succeeds.
      await this.probe(port);
      if (attempt !== this.generation) throw new Error('Connection cancelled');
      this.allowRequests = true;
      this.emit('connected', 'Mieru подключён');
    } catch {
      await this.seal('Не удалось подключиться. Проверьте настройки и сервер.');
      await this.engine.stop();
      throw new Error(this.state.message);
    }
  }); }
  direct() { return this.enqueue(async () => {
    await this.seal('Переключение…');
    await this.engine.stop();
    await this.session.setProxy({ mode: 'direct' });
    await this.session.closeAllConnections();
    this.allowRequests = true;
    this.emit('direct', 'VPN выключен • прямое подключение');
  }); }
  fail(message = 'Mieru недоступен. Загрузка страниц заблокирована.') {
    // Synchronous gate even if another transition is queued.
    this.allowRequests = false;
    this.generation++;
    return this.enqueue(async () => { await this.seal(message); await this.engine.stop(); });
  }
}
module.exports = { VpnController, BLOCKED_PROXY };
