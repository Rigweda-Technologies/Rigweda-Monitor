import ast
import sqlite3
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / 'src/screenshots/screenshot.py'

class CommitTests(unittest.TestCase):
    def test_only_verified_acknowledgement_deletes_file(self):
        function = next(n for n in ast.parse(SOURCE.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'commit_batch')
        for response, accepted in [
            ({'success': True, 'data': None}, False),
            ({'success': True, 'data': {'id': 'batch', 'device_id': 'device', 'acknowledgedScreenshotIds': []}}, False),
            ({'success': True, 'data': {'id': 'other', 'device_id': 'device', 'acknowledgedScreenshotIds': ['shot']}}, False),
            ({'success': True, 'data': {'id': 'batch', 'device_id': 'device', 'acknowledgedScreenshotIds': ['shot']}}, True),
        ]:
            with self.subTest(response=response), tempfile.TemporaryDirectory() as folder:
                image = Path(folder) / 'shot.png'
                image.write_bytes(b'test')
                db = sqlite3.connect(':memory:')
                db.row_factory = sqlite3.Row
                db.execute('CREATE TABLE screenshots(id TEXT, local_path TEXT)')
                db.execute('INSERT INTO screenshots VALUES (?,?)', ('shot', str(image)))
                db.commit()
                namespace = dict(Path=Path, get_connection=lambda: db,
                    get_backend_base_url_candidates=lambda: ['https://example.invalid'],
                    get_backend_base_url=lambda: 'https://example.invalid',
                    post_json=lambda *args, **kwargs: response, log_message=lambda *args, **kwargs: None)
                exec(compile(ast.Module(body=[function], type_ignores=[]), '<real commit_batch>', 'exec'), namespace)
                call = lambda: namespace['commit_batch'](batch_id='batch', device_id='device', uploaded=[{'clientScreenshotId': 'shot'}], duplicates=[], token='fake')
                if accepted:
                    call()
                else:
                    with self.assertRaises(RuntimeError): call()
                self.assertEqual(image.exists(), not accepted)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM screenshots').fetchone()[0], 0 if accepted else 1)
                db.close()

if __name__ == '__main__': unittest.main()
