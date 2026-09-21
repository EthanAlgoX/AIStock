#!/usr/bin/env python3
"""Keep local AI tooling out of Git without requiring it in a clean checkout.

The historical script/job name is retained for branch-protection compatibility.
Product Skills and shared product/design documentation remain versioned.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL_FILES = {'AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md'}
LOCAL_DIRS = ('.claude/', '.codex/', '.agents/', '.impeccable/', '.github/instructions/')
IGNORE_PROBES = (
    *sorted(LOCAL_FILES), *(directory + 'local-probe' for directory in LOCAL_DIRS),
    '.env', 'data/private.db', 'logs/runtime.log', 'backups/private.json',
    'longbridge_tokens/token.json', 'credentials.json', 'service-account.json',
    'private.pem', 'private.key', 'local.db-wal', '.playwright-cli/local-probe',
)
PUBLIC_PROBES = ('.env.example', 'SKILL.md', 'strategies/example/SKILL.md', 'PRODUCT.md', 'DESIGN.md')


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, check=False)


def main() -> int:
    tracked = git('ls-files', '-z')
    if tracked.returncode:
        print('[ai-assets] ERROR: cannot inspect Git index', file=sys.stderr)
        return 1
    errors = []
    for filename in tracked.stdout.decode().split('\0'):
        if filename in LOCAL_FILES or filename.startswith(LOCAL_DIRS):
            errors.append(f'local-only file is tracked: {filename}')
    for filename, expected in [(p, True) for p in IGNORE_PROBES] + [(p, False) for p in PUBLIC_PROBES]:
        result = git('check-ignore', '--no-index', '-q', '--', filename)
        if result.returncode not in (0, 1):
            errors.append(f'cannot check ignore rule: {filename}')
        elif (result.returncode == 0) != expected:
            errors.append(f'{filename}: expected {"ignored" if expected else "publishable"}')
    for error in errors:
        print(f'[ai-assets] ERROR: {error}', file=sys.stderr)
    if not errors:
        print('[ai-assets] OK: local-only files excluded; product assets publishable')
    return int(bool(errors))


if __name__ == '__main__':
    sys.exit(main())
