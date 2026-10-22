#!/usr/bin/env python3
"""Fetch only the pinned Mieru executable and verify its pinned SHA-256."""
import argparse
import hashlib
import io
import platform
from pathlib import Path
import tarfile
import urllib.request
import zipfile

VERSION = '3.38.1'
ASSETS = {
    ('mac', 'x64'): ('macos_amd64.tar.gz', 'de8451bcf1be26b781c49bde8288b3a702f42d2eaffbe9a691c1f414c914ebe0'),
    ('mac', 'arm64'): ('macos_arm64.tar.gz', '148236bda659dbc372111eccc56712e17cd7db43694b7dbf4520d4fe5e27a310'),
    ('win', 'x64'): ('windows_amd64.zip', '45d459257323f8e012b163217ca7810ee7cfe5b0eb7cb76e37bb05038a80badf'),
    ('win', 'arm64'): ('windows_arm64.zip', '187877d1cba4825206b8a9e04939d0723e3ba03eb36c18babaa468585dbeba3b'),
    ('linux', 'x64'): ('linux_amd64.tar.gz', 'f7ec3b1c2caf338803426d2b3ff32d85654ce585b391556ebe5d2ea55d72d34f'),
    ('linux', 'arm64'): ('linux_arm64.tar.gz', 'e978a9584ee240bfecb20e4b463323432ca7e2b3d7ae7a4abfb0a06941e776ee'),
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--os', choices=['mac', 'win', 'linux'], default={'Darwin': 'mac', 'Windows': 'win'}.get(platform.system(), 'linux'))
    parser.add_argument('--arch', choices=['x64', 'arm64'], default='arm64' if platform.machine().lower() in ['arm64', 'aarch64'] else 'x64')
    args = parser.parse_args()
    asset, expected = ASSETS[(args.os, args.arch)]
    url = f'https://github.com/enfein/mieru/releases/download/v{VERSION}/mieru_{VERSION}_{asset}'
    print(f'Downloading Mieru {VERSION} for {args.os}/{args.arch}', flush=True)
    request = urllib.request.Request(url, headers={'User-Agent': 'Mieru-Browser-build'})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read(40 * 1024 * 1024)
    if hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError('Mieru archive SHA-256 mismatch; refusing to install')
    name = 'mieru.exe' if args.os == 'win' else 'mieru'
    if asset.endswith('.zip'):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            matches = [m for m in archive.namelist() if Path(m).name == name]
            if len(matches) != 1:
                raise RuntimeError('Expected exactly one Mieru executable')
            executable = archive.read(matches[0])
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            matches = [m for m in archive.getmembers() if m.isfile() and Path(m.name).name == name]
            if len(matches) != 1:
                raise RuntimeError('Expected exactly one Mieru executable')
            executable = archive.extractfile(matches[0]).read()
    destination = Path(__file__).resolve().parents[1] / 'resources' / 'mieru' / f'{args.os}-{args.arch}' / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(executable)
    destination.chmod(0o755)
    print(f'Verified and installed: {destination}')

if __name__ == '__main__':
    main()
