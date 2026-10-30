'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, scryptSync, createCipheriv } = require('node:crypto');
const { unlockPreset } = require('../src/preset.cjs');
test('preset decrypts only with the exact command; plaintext is absent from file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preset-test-'));
  const file = path.join(dir, 'preset.json');
  const command = 'TESTCODE123';
  const content = 'anytls://test-secret@localhost:443?sni=localhost';
  const salt = randomBytes(16), iv = randomBytes(12), key = scryptSync(command, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(content), cipher.final()]);
  try {
    const record = JSON.stringify({ version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
    assert(!record.includes(command)); assert(!record.includes('test-secret'));
    await fs.writeFile(file, record);
    assert.equal(await unlockPreset(command, file), content);
    assert.equal(await unlockPreset('WRONGCODE123', file), null);
    assert.equal(await unlockPreset('testcode123', file), null);
    assert.equal(await unlockPreset('hello world', file), null);
    await fs.writeFile(file, '{}');
    assert.equal(await unlockPreset(command, file), null);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
