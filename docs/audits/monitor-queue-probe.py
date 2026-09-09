"""Run the real queue selectors against isolated SQLite; no agent side effects."""
import ast
import sqlite3
from pathlib import Path
root = Path(__file__).resolve().parents[2]
tree = ast.parse((root / 'desktop/frontend/src/screenshots/screenshot.py').read_text())
selector = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'fetch_upload_candidates')
resume = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'resume_uploaded_screenshots')
mark_failed = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'mark_rows_failed')
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
db.execute('CREATE TABLE screenshots (id TEXT, status TEXT, captured_at TEXT, organization_id TEXT, user_id TEXT, device_id TEXT, batch_id TEXT, cloudinary_public_id TEXT, cloudinary_asset_id TEXT, cloudinary_version INTEGER, cloudinary_format TEXT, cloudinary_url TEXT, size_bytes INTEGER, retry_count INTEGER DEFAULT 0, last_error TEXT, updated_at TEXT)')
db.executemany('INSERT INTO screenshots(id,status,captured_at,organization_id,user_id,device_id,batch_id,cloudinary_public_id,cloudinary_version,cloudinary_url,size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
    ('pending-shot', 'pending', '2026-09-09', 'org-a', 'user-a', 'device-a', None, None, None, None, 10),
    ('uploaded-before-crash', 'cloudinary_uploaded', '2026-09-09', 'org-a', 'user-a', 'device-a', 'batch-a', 'public', 1, 'https://example.invalid/image', 42),
    ('other-account-shot', 'pending', '2026-09-09', 'org-b', 'user-b', 'device-a', None, None, None, None, 10),
])
calls = []
namespace = {
    'sqlite3': sqlite3,
    'get_connection': lambda: db,
    'commit_batch': lambda **kwargs: calls.append(kwargs),
    'log_exception': lambda *args: None,
}
exec(compile(ast.Module(body=[selector, mark_failed, resume], type_ignores=[]), '<actual queue>', 'exec'), namespace)
identity = ('org-a', 'user-a', 'device-a')
assert [r['id'] for r in namespace['fetch_upload_candidates'](100, identity)] == ['pending-shot']
namespace['resume_uploaded_screenshots']('token', identity)
assert calls[0]['batch_id'] == 'batch-a'
assert calls[0]['uploaded'][0]['clientScreenshotId'] == 'uploaded-before-crash'
print('FIXED: upload selection is identity-scoped and cloudinary_uploaded rows resume completion without reupload.')
