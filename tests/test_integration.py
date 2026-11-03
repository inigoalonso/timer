import os,tempfile,unittest
os.environ['DATABASE_PATH']=tempfile.mktemp()
from fastapi.testclient import TestClient
from app import app
class Integration(unittest.TestCase):
 def test_remote_control(self):
  with TestClient(app) as c:
   links=c.post('/api/sessions').json();sid=links['controller'].split('/')[2].split('#')[0]
   with c.websocket_connect('/ws/'+sid,headers={'origin':'http://testserver'}) as w:
    w.send_json({'token':links['controller'].split('#')[1]});s=w.receive_json()['state']
    w.send_json({'action':'start','revision':s['revision'],'payload':{}});self.assertEqual(w.receive_json()['state']['mode'],'running')
   with c.websocket_connect('/ws/'+sid,headers={'origin':'http://testserver'}) as w:
    w.send_json({'token':links['display'].split('#')[1]});s=w.receive_json()['state'];w.send_json({'action':'reset','revision':s['revision']});self.assertEqual(w.receive_json()['type'],'error')
