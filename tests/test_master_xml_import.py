from pathlib import Path
import pytest

from books import Books
from interchange import preview_import, apply_import

MASTER_XML_PATH = Path(r"C:\Users\Prime Steel\Desktop\Master.xml")


def test_import_desktop_master_xml_end_to_end():
    if not MASTER_XML_PATH.is_file():
        pytest.skip("C:\\Users\\Prime Steel\\Desktop\\Master.xml not present")

    with open(MASTER_XML_PATH, 'rb') as f:
        xml_bytes = f.read()

    db = Books(':memory:')
    
    # 1. Test preview_import with zero manual company/date parameters
    preview = preview_import(db, {
        'xmls': [{'name': 'Master.xml', 'text': xml_bytes}]
    })
    assert preview['status'] == 'success'
    assert preview['companies'] == 1
    assert preview['masters'] > 0
    assert preview['vouchers'] == 0

    # 2. Test apply_import
    result = apply_import(db, {
        'xmls': [{'name': 'Master.xml', 'text': xml_bytes}]
    })
    assert result['status'] == 'success'
    assert result['masters'] == preview['masters']

    # 3. Verify created company
    assert len(db.data['companies']) >= 1
    cmp_name = list(db.data['companies'].keys())[0]
    cmp = db.get_company(cmp_name)
    assert cmp['name'] == cmp_name
    assert cmp.get('starting_from')
    assert cmp.get('ending_at')
    assert len(cmp['groups']) > 0
