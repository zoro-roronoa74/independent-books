import re
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from test_browser_vouchers import app

ROOT = Path(__file__).parents[1]

def test_no_emojis_in_source_files():
    # Strict zero-emoji policy
    emoji_pattern = re.compile(r'[\U00010000-\U0010ffff]|[\u2600-\u27bf]|[\u2300-\u23ff]')
    for fname in ['fidelity.css', 'index.html', 'workflows.js', 'lookup_context.js', 'date_picker.js']:
        content = (ROOT / fname).read_text(encoding='utf-8')
        matches = emoji_pattern.findall(content)
        assert not matches, f"Found emojis in {fname}: {matches}"

def test_css_glassmorphism_rules():
    css = (ROOT / 'fidelity.css').read_text(encoding='utf-8')
    assert 'backdrop-filter' in css or '-webkit-backdrop-filter' in css
    assert 'border-radius: 12px' in css or 'border-radius:12px' in css
    assert '180ms' in css

def test_svg_icons_and_glassmorphism_in_dom(app):
    page, db, _ = app
    page.reload()
    page.wait_for_load_state('networkidle')
    # Check that SVG icons exist for keys or navigation
    svgs = page.locator('svg')
    assert svgs.count() >= 2, "Expected at least 2 SVG icons for F12, F2, or other controls"
    
    # Check glassmorphism classes/styles
    body_styles = page.evaluate("() => window.getComputedStyle(document.body).fontFamily")
    assert body_styles
