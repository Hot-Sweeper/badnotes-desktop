import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


class RecoverableTrashTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='badnotes-trash-test-')
        self.root = Path(self.temp.name)
        self.books = self.root / 'notebooks'; self.books.mkdir()
        self.trash = self.root / 'trashed'; self.trash.mkdir()
        self.patch = patch.multiple(app, DATA_DIR=self.root, NOTEBOOKS_DIR=self.books, TRASH_NOTEBOOKS_DIR=self.trash)
        self.patch.start()
        self.client = app.app.test_client()
        self.book = self.client.post('/api/notebooks', json={'name':'Recovery fixture','color':'#7640fd'}).get_json()['notebook']
        self.id = self.book['id']; self.page_id = self.book['pages'][0]
        self.content = {'strokes':[{'id':4,'tool':'pen','color':'#fff','size':2,'points':[{'x':20,'y':30}]}],
                        'images':[{'id':'img','dataUrl':'data:image/png;base64,fixture'}],
                        'width':600,'height':900,'template':'grid','gridShiftX':7,'gridShiftY':11}
        self.client.put(f'/api/notebooks/{self.id}/pages/{self.page_id}', json=self.content)
        self.original = (self.books / self.id / f'{self.page_id}.json').read_bytes()
        (self.root / 'notebook_order.json').write_text(json.dumps({'order':['before',self.id,'after']}))

    def tearDown(self):
        self.patch.stop(); self.temp.cleanup()

    def test_trash_and_restore_preserve_exact_page_files_ids_and_order(self):
        self.assertEqual(self.client.post(f'/api/notebooks/{self.id}/trash',json={'originalIndex':1}).status_code,200)
        self.assertFalse((self.books / f'{self.id}.json').exists())
        self.assertFalse((self.books / self.id).exists())
        self.assertEqual((self.trash / self.id / 'pages' / f'{self.page_id}.json').read_bytes(),self.original)
        self.assertEqual(self.client.get('/api/trash/notebooks').get_json()[0]['pages'],[self.page_id])
        self.assertEqual(self.client.post(f'/api/trash/notebooks/{self.id}/restore').status_code,200)
        self.assertEqual((self.books / self.id / f'{self.page_id}.json').read_bytes(),self.original)
        self.assertEqual(json.loads((self.root/'notebook_order.json').read_text())['order'],['before',self.id,'after'])
        self.assertEqual(self.client.get('/api/trash/notebooks').get_json(),[])

    def test_conflict_never_overwrites_content_and_permanent_delete_is_scoped(self):
        self.client.post(f'/api/notebooks/{self.id}/trash',json={})
        (self.books / f'{self.id}.json').write_text('collision')
        self.assertEqual(self.client.post(f'/api/trash/notebooks/{self.id}/restore').status_code,409)
        self.assertEqual((self.trash / self.id / 'pages' / f'{self.page_id}.json').read_bytes(),self.original)
        self.assertEqual(self.client.delete('/api/trash/notebooks/not-found').status_code,404)
        self.assertEqual(self.client.delete(f'/api/trash/notebooks/{self.id}').status_code,200)
        self.assertEqual((self.books/f'{self.id}.json').read_text(),'collision')
        self.assertEqual(self.client.post('/api/notebooks/invalid.id/trash').status_code,400)

    def test_content_trash_and_fontbook_protection(self):
        entry={'id':'selection','pageId':self.page_id,'strokes':self.content['strokes'],'images':self.content['images']}
        saved=self.client.put(f'/api/notebooks/{self.id}',json={'contentTrash':[entry]}).get_json()
        self.assertEqual(saved['contentTrash'],[entry])
        self.assertEqual(self.client.get(f'/api/notebooks/{self.id}').get_json()['notebook']['contentTrash'],[entry])
        book=self.client.post('/api/notebooks',json={'name':'Fontbook','isFontBook':True}).get_json()['notebook']
        self.assertEqual(self.client.post(f'/api/notebooks/{book["id"]}/trash',json={}).status_code,403)
        self.assertTrue((self.books/f'{book["id"]}.json').exists())

if __name__=='__main__': unittest.main()
