import ast
import sqlite3
import unittest
from pathlib import Path

class RecoveryTests(unittest.TestCase):
    def test_resume_uses_existing_batch_without_reupload(self):
        source = Path(__file__).resolve().parents[1] / 'src/screenshots/screenshot.py'
        functions = [n for n in ast.parse(source.read_text()).body if isinstance(n, ast.FunctionDef) and n.name in ('resume_uploaded_screenshots', 'mark_rows_failed')]
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.execute("CREATE TABLE screenshots (id TEXT, organization_id TEXT DEFAULT 'org', user_id TEXT DEFAULT 'user', device_id TEXT DEFAULT 'device', batch_id TEXT, status TEXT, captured_at TEXT, cloudinary_public_id TEXT, cloudinary_asset_id TEXT, cloudinary_version INTEGER, cloudinary_format TEXT, cloudinary_url TEXT, size_bytes INTEGER, retry_count INTEGER DEFAULT 0, last_error TEXT, updated_at TEXT)")
        db.execute("INSERT INTO screenshots(id,batch_id,status,captured_at,cloudinary_public_id,cloudinary_version,cloudinary_url,size_bytes) VALUES ('shot','original-batch','cloudinary_uploaded','2026-09-09','public',1,'https://example.invalid/image',42)")
        db.commit()
        calls = []
        def commit(**kwargs):
            calls.append(kwargs)
            raise RuntimeError('temporary outage')
        namespace = dict(get_connection=lambda: db, get_device_id=lambda: 'original-device', commit_batch=commit, log_exception=lambda *args: None)
        exec(compile(ast.Module(body=functions, type_ignores=[]), '<real recovery>', 'exec'), namespace)
        namespace['resume_uploaded_screenshots']('token', ('org', 'user', 'device'))
        row = db.execute('SELECT * FROM screenshots').fetchone()
        self.assertEqual(row['status'], 'cloudinary_uploaded')
        self.assertEqual(row['retry_count'], 1)
        namespace['commit_batch'] = lambda **kwargs: calls.append(kwargs)
        namespace['resume_uploaded_screenshots']('token', ('org', 'user', 'device'))
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1]['batch_id'], 'original-batch')
        self.assertEqual(calls[1]['uploaded'][0]['clientScreenshotId'], 'shot')
        db.close()

if __name__ == '__main__': unittest.main()
