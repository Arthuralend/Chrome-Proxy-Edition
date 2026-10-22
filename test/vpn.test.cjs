'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VpnController } = require('../src/vpn.cjs');
function setup({ failStart = false, failProbe = false } = {}) {
  const events = [];
  let vpn;
  vpn = new VpnController({
    session: { setProxy: async c => { assert.equal(vpn.allowRequests, false); events.push(c); }, closeAllConnections: async () => events.push('close') },
    engine: { start: async () => { if (failStart) throw Error('secret password'); return 19000; }, stop: async () => events.push('stop') },
    probe: async () => { assert.equal(vpn.allowRequests, false); if (failProbe) throw Error('secret password'); events.push('verified'); },
    onTransition: async () => { assert.equal(vpn.allowRequests, false); events.push('destroy-views'); }
  });
  return { vpn, events };
}
test('startup blocks before any network use', async () => {
  const { vpn, events } = setup(); await vpn.initialize();
  assert.equal(vpn.allowRequests, false); assert.equal(vpn.state.mode, 'blocked');
  assert.equal(events[1].proxyRules, 'socks5://127.0.0.1:1');
});
test('only a verified proxied connection opens the request gate', async () => {
  const { vpn, events } = setup(); await vpn.connect('{}');
  assert.equal(vpn.state.mode, 'connected'); assert.equal(vpn.allowRequests, true);
  assert(events.some(e => e.proxyRules === 'socks5://127.0.0.1:19000'));
  assert.equal(events.at(-1), 'verified');
  assert(!events.some(e => e.mode === 'direct'));
});
for (const cause of ['failStart', 'failProbe']) test(`failure ${cause} stays blocked and redacts backend errors`, async () => {
  const { vpn, events } = setup({ [cause]: true });
  await assert.rejects(vpn.connect('{}'), error => !error.message.includes('secret'));
  assert.equal(vpn.allowRequests, false); assert.equal(vpn.state.mode, 'blocked');
  assert(!events.some(e => e.mode === 'direct'));
});
test('unexpected exit closes gate immediately and destroys pages', async () => {
  const { vpn, events } = setup(); await vpn.connect('{}');
  const promise = vpn.fail(); assert.equal(vpn.allowRequests, false); await promise;
  assert.equal(vpn.state.mode, 'blocked'); assert.equal(events.at(-1), 'stop');
});
test('rapid toggles run sequentially, direct mode needs its own explicit call', async () => {
  const { vpn, events } = setup();
  await Promise.all([vpn.connect('{}'), vpn.direct(), vpn.connect('{}')]);
  assert.equal(vpn.state.mode, 'connected'); assert.equal(events.filter(e => e.mode === 'direct').length, 1);
});
test('failure during an in-flight probe cannot reopen the request gate', async () => {
  let release, reached;
  const waiting = new Promise(r => reached = r);
  const { vpn } = setup();
  vpn.probe = async () => { reached(); await new Promise(r => release = r); };
  const connecting = vpn.connect('{}');
  await waiting;
  const failed = vpn.fail();
  release();
  await assert.rejects(connecting);
  await failed;
  assert.equal(vpn.state.mode, 'blocked');
  assert.equal(vpn.allowRequests, false);
});
