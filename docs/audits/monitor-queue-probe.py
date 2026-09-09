"""Run the real retry selector against isolated SQLite; no agent side effects."""
import ast
import sqlite3
from pathlib import Path
root = Path(__file__).resolve().parents[2]
tree = ast.parse((root / 'desktop/frontend/src/screenshots/screenshot.py').read_text())
selector = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'fetch_upload_candidates')
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
db.execute('CREATE TABLE screenshots (id TEXT, status TEXT, captured_at TEXT)')
db.executemany('INSERT INTO screenshots VALUES (?,?,?)', [('pending-shot', 'pending', '2026-09-09'), ('uploaded-before-crash', 'cloudinary_uploaded', '2026-09-09')])
namespace = {'sqlite3': sqlite3, 'get_connection': lambda: db}
exec(compile(ast.Module(body=[selector], type_ignores=[]), '<actual selector>', 'exec'), namespace)
assert [r['id'] for r in namespace['fetch_upload_candidates'](100)] == ['pending-shot']
print('CONFIRMED: retry selector excludes cloudinary_uploaded rows after process crash.')
