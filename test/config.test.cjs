'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConfig, navigationURL } = require('../src/config.cjs');
const fixture = () => ({ server: 'vpn.example.com', server_port: 443, password: 'test-only', server_name: 'vpn.example.com' });
test('builds only a loopback SOCKS listener and a mandatory AnyTLS route', () => {
  const c = normalizeConfig(JSON.stringify({ ...fixture(), inbounds: [{ listen: '0.0.0.0' }], route: { final: 'direct' } }), { socks: 16000 });
  assert.deepEqual(c.inbounds, [{ type: 'socks', tag: 'browser', listen: '127.0.0.1', listen_port: 16000 }]);
  assert.equal(c.route.final, 'proxy'); assert.equal(c.outbounds.length, 1);
  assert.equal(c.outbounds[0].type, 'anytls'); assert.equal(c.outbounds[0].tls.enabled, true);
  assert.equal(c.outbounds[0].tls.insecure, false);
});
test('invalid JSON, Mieru config, bad credentials, hosts and ports are rejected', () => {
  for (const mutate of [c => c.password = '', c => c.server_port = 70000, c => c.server = 'http://host', c => c.insecure = 'false', c => c.type = 'direct']) {
    const c = fixture(); mutate(c); assert.throws(() => normalizeConfig(JSON.stringify(c)));
  }
  assert.throws(() => normalizeConfig('{'));
  assert.throws(() => normalizeConfig(JSON.stringify({ profiles: [] })));
});
test('imports AnyTLS URLs with URL-encoded passwords, SNI and explicit certificate policy', () => {
  const c = normalizeConfig('anytls://a%40b%3Ac@vpn.example.com:8443/?sni=cert.example.com&insecure=0#Name').outbounds[0];
  assert.equal(c.password, 'a@b:c'); assert.equal(c.server_port, 8443);
  assert.equal(c.tls.server_name, 'cert.example.com'); assert.equal(c.tls.insecure, false);
  assert.equal(normalizeConfig('anytls://abc@host.example/?insecure=1').outbounds[0].tls.insecure, true);
  assert.throws(() => normalizeConfig('anytls://abc@host.example/?unknown=1'));
});
test('IPv6, outbound JSON and inline certificate trust are supported', () => {
  const c = normalizeConfig(JSON.stringify({ type: 'anytls', tag: 'source', server: '::1', server_port: 443, password: 'x', tls: { enabled: true, server_name: 'localhost', certificate: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----' } }));
  assert.equal(c.outbounds[0].server, '::1'); assert.equal(c.outbounds[0].tls.certificate.length, 1);
  assert.throws(() => normalizeConfig(JSON.stringify({ ...fixture(), tls: { enabled: false } })));
});
test('navigation accepts web URLs and searches; blocks privileged schemes', () => {
  assert.equal(navigationURL('example.com'), 'https://example.com/');
  assert.equal(navigationURL('http://localhost:8080'), 'http://localhost:8080/');
  assert.equal(navigationURL('hello world'), 'https://www.google.com/search?q=hello%20world');
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hello', 'chrome://settings', 'mailto:a@b.com']) assert.throws(() => navigationURL(url));
});
