import ast
import sqlite3
import tempfile
import unittest
from pathlib import Path

class IdentityTests(unittest.TestCase):
    def test_capture_identity_and_legacy_quarantine(self):
        source = Path(__file__).resolve().parents[1] / 'src/screenshots/screenshot.py'
        module_nodes = ast.parse(source.read_text()).body
        functions = [
            n for n in module_nodes
            if (
                isinstance(n, ast.FunctionDef)
                and n.name in ('get_connection', 'insert_queue_record', 'fetch_upload_candidates')
            ) or (
                isinstance(n, ast.ClassDef)
                and n.name == 'ClosingConnection'
            )
        ]
        with tempfile.TemporaryDirectory() as folder:
            namespace = dict(sqlite3=sqlite3, Path=Path, DATA_ROOT=Path(folder), QUEUE_DB=Path(folder)/'queue.db')
            exec(compile(ast.Module(body=functions, type_ignores=[]), '<actual queue>', 'exec'), namespace)
            owners = [('org-a','user-a','device'), ('org-b','user-b','device'), ('org-a','user-b','device')]
            for index, owner in enumerate(owners):
                namespace['insert_queue_record'](screenshot_id=str(index), captured_at='2026-09-09', file_path=Path(folder)/f'{index}.png', width=1, height=1, sha256='a'*64, size_bytes=1, identity=owner)
            # Legacy rows cannot silently acquire the next logged-in user's identity.
            with namespace['get_connection']() as db:
                db.execute("INSERT INTO screenshots(id,captured_at,local_path,original_file_name,mime_type,width,height,sha256,size_bytes) VALUES ('legacy','2026-09-09','old.png','old.png','image/png',1,1,'hash',1)")
            for index, owner in enumerate(owners):
                self.assertEqual([r['id'] for r in namespace['fetch_upload_candidates'](100, owner)], [str(index)])
            with namespace['get_connection']() as db:
                self.assertEqual(db.execute("SELECT status FROM screenshots WHERE id='legacy'").fetchone()[0], 'quarantined')
            self.assertEqual(namespace['fetch_upload_candidates'](100, ('org-a','user-a','other-device')), [])

if __name__ == '__main__': unittest.main()
