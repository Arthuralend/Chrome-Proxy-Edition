#!/usr/bin/env python3
"""Download the pinned official sing-box binary; verify before extracting."""
import argparse
import hashlib
import io
import platform
from pathlib import Path
import tarfile
import urllib.request
import zipfile

VERSION = '1.14.4'
ASSETS = {
    ('mac', 'x64'): ('darwin-amd64.tar.gz', 'eae86b9b033bba50b7c44ab719e4bfac0aca05efd28483390ed3aa510f32db25'),
    ('mac', 'arm64'): ('darwin-arm64.tar.gz', '0d8c7f5ed5d587b0f1a5e9772a708ec3bfa4ac4c9329604b01d8d9c2ba406838'),
    ('win', 'x64'): ('windows-amd64.zip', '99185d75d314a07dbba4a130c8ad986cbeb629a07927975636b341ca61f991df'),
    ('win', 'arm64'): ('windows-arm64.zip', '8cd0a4d0cd8cd480be5731ac31f17038969a42d12add9feb6e031fd43d85bbae'),
    ('linux', 'x64'): ('linux-amd64.tar.gz', '699a1b510aa4396b2176d32d1181920399ebf1e267835da6f3b598d0f7c24968'),
    ('linux', 'arm64'): ('linux-arm64.tar.gz', '436441f76ee2f7fe21b5b2d426d3cb261a480455a704865789ad533e4273ec26'),
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--os', choices=['mac', 'win', 'linux'], default={'Darwin': 'mac', 'Windows': 'win'}.get(platform.system(), 'linux'))
    parser.add_argument('--arch', choices=['x64', 'arm64'], default='arm64' if platform.machine().lower() in ['arm64', 'aarch64'] else 'x64')
    args = parser.parse_args()
    suffix, expected = ASSETS[(args.os, args.arch)]
    url = f'https://github.com/SagerNet/sing-box/releases/download/v{VERSION}/sing-box-{VERSION}-{suffix}'
    print(f'Downloading sing-box {VERSION} for {args.os}/{args.arch}', flush=True)
    request = urllib.request.Request(url, headers={'User-Agent': 'Chrome-Proxy-Edition-build'})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read(100 * 1024 * 1024)
    if hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError('sing-box SHA-256 mismatch; refusing to install')
    name = 'sing-box.exe' if args.os == 'win' else 'sing-box'
    if suffix.endswith('.zip'):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            matches = [m for m in archive.namelist() if Path(m).name == name]
            if len(matches) != 1:
                raise RuntimeError('Expected exactly one sing-box executable')
            executable = archive.read(matches[0])
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            matches = [m for m in archive.getmembers() if m.isfile() and Path(m.name).name == name]
            if len(matches) != 1:
                raise RuntimeError('Expected exactly one sing-box executable')
            executable = archive.extractfile(matches[0]).read()
    destination = Path(__file__).resolve().parents[1] / 'resources' / 'sing-box' / f'{args.os}-{args.arch}' / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(executable)
    destination.chmod(0o755)
    print(f'Verified and installed: {destination}')

if __name__ == '__main__':
    main()
