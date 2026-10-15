"""Run the dependency-free JavaScript regression suites under pytest."""
import subprocess
from pathlib import Path


ROOT = Path(__file__).parents[1]


def test_client_rule_suites_pass():
    for script in ('tests/test_voucher_logic.js', 'tests/test_phase1_logic.js',
                   'tests/test_contextual_lookup.js'):
        result = subprocess.run(['node', script], cwd=ROOT, text=True,
                                capture_output=True)
        assert result.returncode == 0, f'{script}\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}'
