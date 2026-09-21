"""Exercise exclusion checks against real Git indexes and a clean checkout."""
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def repo(tmp_path):
    subprocess.run(['git', 'init', '-q', str(tmp_path)], check=True)
    shutil.copy(ROOT / '.gitignore', tmp_path / '.gitignore')
    (tmp_path / 'scripts').mkdir()
    shutil.copy(ROOT / 'scripts/check_ai_assets.py', tmp_path / 'scripts/check_ai_assets.py')
    return tmp_path


def check(repo):
    return subprocess.run([sys.executable, 'scripts/check_ai_assets.py'], cwd=repo,
                          capture_output=True, text=True)


def test_clean_checkout_needs_no_local_ai_assets(repo):
    assert check(repo).returncode == 0
    for name in ['.env.example', 'SKILL.md', 'PRODUCT.md', 'DESIGN.md', 'strategies/example/SKILL.md']:
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('Public project asset')
        subprocess.run(['git', 'add', '--', name], cwd=repo, check=True)
    assert check(repo).returncode == 0


@pytest.mark.parametrize('name', ['AGENTS.md', 'CLAUDE.md', '.claude/skills/example/SKILL.md',
                                 '.impeccable/design.json', '.github/copilot-instructions.md'])
def test_force_added_local_asset_is_rejected(repo, name):
    path = repo / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('Local development instructions')
    subprocess.run(['git', 'add', '-f', '--', name], cwd=repo, check=True)
    result = check(repo)
    assert result.returncode == 1 and name in result.stderr


def test_missing_secret_exclusion_is_rejected(repo):
    path = repo / '.gitignore'
    path.write_text(path.read_text().replace('/longbridge_tokens/\n', ''))
    result = check(repo)
    assert result.returncode == 1 and 'longbridge_tokens/token.json' in result.stderr
