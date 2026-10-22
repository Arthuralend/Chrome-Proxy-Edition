'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const arch = process.argv[2];
if (!['x64', 'arm64'].includes(arch)) throw new Error('Expected target architecture');
const candidates = [`dist/mac-${arch}/Mieru Browser.app`, 'dist/mac/Mieru Browser.app'];
const appPath = candidates.find(p => fs.existsSync(p));
if (!appPath) throw new Error('Packaged app not found');
const verify = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { encoding: 'utf8' });
process.stdout.write(verify.stdout || ''); process.stderr.write(verify.stderr || '');
if (verify.status !== 0) throw new Error('Packaged code signature verification failed');
const engine = spawnSync('/usr/bin/codesign', ['--verify', '--strict', path.join(appPath, 'Contents/Resources/mieru/mieru')], { encoding: 'utf8' });
if (engine.status !== 0) throw new Error('Bundled Mieru code signature verification failed: ' + engine.stderr);
const launched = spawnSync(path.resolve(appPath, 'Contents/MacOS/Mieru Browser'), [], {
  encoding: 'utf8', timeout: 45000, env: { ...process.env, MIERU_BROWSER_SMOKE: '1' }
});
process.stdout.write(launched.stdout || ''); process.stderr.write(launched.stderr || '');
if (launched.status !== 0 || !launched.stdout?.includes('MIERU_PACKAGED_SMOKE_OK')) throw new Error('Signed application did not complete first-run smoke test');
console.log('Verified macOS signature, bundled Mieru, and packaged application launch');
