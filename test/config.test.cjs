'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConfig, navigationURL } = require('../src/config.cjs');
const fixture = () => ({ profiles: [{ profileName: 'home', user: { name: 'demo', password: 'example-only' }, servers: [{ domainName: 'example.invalid', portBindings: [{ port: 443, protocol: 'TCP' }] }] }], socks5ListenLAN: true, httpProxyPort: 8000, socks5Authentication: [{ user: 'a', password: 'b' }] });
test('import preserves server settings but forces app-owned loopback listeners', () => {
  const result = normalizeConfig(JSON.stringify(fixture()), { socks: 16000, rpc: 16001 });
  assert.equal(result.activeProfile, 'home');
  assert.equal(result.socks5ListenLAN, false);
  assert.equal(result.socks5Port, 16000);
  assert.equal(result.rpcPort, 16001);
  assert.equal(result.httpProxyPort, undefined);
  assert.equal(result.socks5Authentication, undefined);
  assert.equal(result.profiles[0].servers[0].domainName, 'example.invalid');
});
test('invalid JSON, absent credentials, invalid ports and active profile are rejected', () => {
  for (const mutate of [c => c.profiles[0].user = {}, c => c.activeProfile = 'missing', c => c.profiles[0].servers[0].portBindings[0].port = 70000, c => c.profiles[0].servers[0].portBindings[0].protocol = 'HTTP']) {
    const c = fixture(); mutate(c); assert.throws(() => normalizeConfig(JSON.stringify(c)));
  }
  assert.throws(() => normalizeConfig('mieru://example'));
  assert.throws(() => normalizeConfig('{}'));
});
test('port ranges retain their protocol', () => {
  const c = fixture(); c.profiles[0].servers[0].portBindings = [{ portRange: '1000-1010', protocol: 'UDP' }];
  assert.equal(normalizeConfig(JSON.stringify(c)).profiles[0].servers[0].portBindings[0].protocol, 'UDP');
  c.profiles[0].servers[0].portBindings[0].portRange = '1010-1000';
  assert.throws(() => normalizeConfig(JSON.stringify(c)));
});
test('navigation accepts web URLs and searches; blocks privileged schemes', () => {
  assert.equal(navigationURL('example.com'), 'https://example.com/');
  assert.equal(navigationURL('http://localhost:8080'), 'http://localhost:8080/');
  assert.equal(navigationURL('hello world'), 'https://www.google.com/search?q=hello%20world');
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hello', 'chrome://settings', 'mailto:a@b.com']) assert.throws(() => navigationURL(url));
});
