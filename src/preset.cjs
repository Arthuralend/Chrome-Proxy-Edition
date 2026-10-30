'use strict';
const fs = require('node:fs/promises');
const { scrypt, createDecipheriv } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);

function validatePreset(text) {
  if (typeof text !== 'string' || text.length > 192 * 1024) throw new Error('Неверный файл профиля.');
  const record = JSON.parse(text);
  if (record.version !== 1 || typeof record.data !== 'string' || !record.data) throw new Error('Неверный файл профиля.');
  for (const [name, length] of [['salt', 16], ['iv', 12], ['tag', 16]]) {
    if (typeof record[name] !== 'string' || Buffer.from(record[name], 'base64').length !== length) throw new Error('Неверный файл профиля.');
  }
  return record;
}

// The command itself is not embedded in the source. It is the decryption key.
async function unlockPreset(command, file) {
  if (typeof command !== 'string' || !/^[A-Z0-9]{8,64}$/.test(command)) return null;
  let key;
  try {
    const text = await fs.readFile(file, 'utf8');
    const record = validatePreset(text);
    const salt = Buffer.from(record.salt, 'base64');
    const iv = Buffer.from(record.iv, 'base64');
    const tag = Buffer.from(record.tag, 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) return null;
    key = await derive(command, salt, 32);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
  finally { if (key) key.fill(0); }
}
module.exports = { unlockPreset, validatePreset };
