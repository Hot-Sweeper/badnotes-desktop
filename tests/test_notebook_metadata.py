import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app

class NotebookMetadataTests(unittest.TestCase):
    def test_geometric_vectors_survive_save_reopen(self):
        with tempfile.TemporaryDirectory(prefix='badnotes-geometry-test-') as directory:
            shapes=[{'id':1,'tool':'pen','size':2,'color':'#ffffff','isGeometric':True,
                     'geometryType':'double-arrow','geometryCurve':False,'geometryFill':False,'geometryDashed':True,
                     'points':[{'x':0,'y':0,'size':2},{'x':100,'y':0,'size':2},
                               {'x':80,'y':-10,'size':2,'break':True},{'x':100,'y':0,'size':2}]},
                    {'id':2,'tool':'pen','size':3,'color':'#6c5ce7','isGeometric':True,
                     'geometryType':'heart','geometryCurve':True,'geometryFill':True,
                     'points':[{'x':10,'y':20},{'x':30,'y':40},{'x':50,'y':20},{'x':10,'y':20}]}]
            with patch.object(app,'NOTEBOOKS_DIR',Path(directory)):
                client=app.app.test_client()
                response=client.put('/api/notebooks/geometry-test/pages/one',json={'strokes':shapes,'width':1100,'height':1600})
                self.assertEqual(response.status_code,200)
                reopened=client.get('/api/notebooks/geometry-test/pages/one')
                self.assertEqual(reopened.status_code,200)
                self.assertEqual(reopened.get_json()['strokes'],shapes)

    def test_edit_preserves_pages_and_persists_emblem(self):
        with tempfile.TemporaryDirectory(prefix='badnotes-metadata-test-') as directory:
            root=Path(directory)
            original={'id':'edit-test','name':'Original','color':'#4a9eff','pages':['one','two'],
                'trash':[{'id':'deleted'}],'template':'dotted'}
            (root/'edit-test.json').write_text(json.dumps(original))
            with patch.object(app,'NOTEBOOKS_DIR',root):
                client=app.app.test_client()
                response=client.put('/api/notebooks/edit-test',json={'name':'Design journal','color':'#379886','icon':'leaf'})
                self.assertEqual(response.status_code,200)
                saved=response.get_json()
                self.assertEqual(saved['name'],'Design journal')
                self.assertEqual(saved['color'],'#379886')
                self.assertEqual(saved['icon'],'leaf')
                self.assertEqual(saved['pages'],original['pages'])
                self.assertEqual(saved['trash'],original['trash'])
                self.assertEqual(saved['template'],'dotted')
                reordered=client.put('/api/notebooks/edit-test',json={'pages':['two','one']}).get_json()
                self.assertEqual(reordered['icon'],'leaf')
                self.assertEqual(json.loads((root/'edit-test.json').read_text())['icon'],'leaf')

if __name__=='__main__':unittest.main()
