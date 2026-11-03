import json, os, sqlite3, subprocess, sys, tempfile, unittest
from pathlib import Path

class Persistence(unittest.TestCase):
    def test_migration_restart_backup_restore(self):
        with tempfile.TemporaryDirectory() as folder:
            path=folder+'/old.db'
            old=dict(mode='running',duration=1800,remaining=None,deadline=123456,title='Legacy',revision=17)
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE sessions(id TEXT PRIMARY KEY,control TEXT,display TEXT,state TEXT)')
                db.execute('INSERT INTO sessions VALUES(?,?,?,?)',('legacy','controlhash','displayhash',json.dumps(old)))
            db.close()
            env=dict(os.environ,DATABASE_PATH=path)
            code="import app,json; r=app.get('legacy'); print(json.dumps(dict(state=json.loads(r[2]),control=r[0],display=r[1]))); app.db.close()"
            first=json.loads(subprocess.check_output([sys.executable,'-c',code],env=env,text=True))
            second=json.loads(subprocess.check_output([sys.executable,'-c',code],env=env,text=True))
            self.assertEqual(first,second)
            self.assertEqual(first['state']['deadline_utc_ms'],123456)
            self.assertEqual(first['state']['revision'],17)
            self.assertEqual(first['control'],'controlhash')
            self.assertTrue(Path(path+'.pre-v1.bak').exists())
            backup=folder+'/backup.db'
            subprocess.check_call([sys.executable,'scripts/backup.py',path,backup],stdout=subprocess.DEVNULL)
            env['DATABASE_PATH']=backup
            restored=json.loads(subprocess.check_output([sys.executable,'-c',code],env=env,text=True))
            self.assertEqual(first,restored)

    def test_receipt_replay_across_processes(self):
        with tempfile.TemporaryDirectory() as folder:
            env=dict(os.environ,DATABASE_PATH=folder+'/restart.db',BASE_URL='http://testserver',ALLOWED_ORIGINS='http://testserver')
            code = """
import json,os
from fastapi.testclient import TestClient
import app
with TestClient(app.app) as client:
    if os.environ.get('LINK'):
        link=os.environ['LINK']
    else:
        link=client.post('/api/sessions').json()['controller']
    sid=link.split('/')[2].split('#')[0]
    with client.websocket_connect('/ws/'+sid,headers={'origin':'http://testserver'}) as ws:
        ws.send_json(dict(type='auth',role='control',token=link.split('#')[1]))
        ws.receive_json()
        ws.send_json(dict(type='command',action='adjust_time',payload={'seconds':-60},request_id='restart-receipt',expected_revision=0))
        while True:
            m=ws.receive_json()
            if m['type']=='ack':break
        print(json.dumps(dict(link=link,ack=m,state=json.loads(app.get(sid)[2]))))
app.db.close()
"""
            first=json.loads(subprocess.check_output([sys.executable,'-c',code],env=env,text=True))
            env['LINK']=first['link']
            second=json.loads(subprocess.check_output([sys.executable,'-c',code],env=env,text=True))
            self.assertEqual(first,second)
            self.assertEqual(second['state']['paused_remaining_ms'],1740000)
            self.assertEqual(second['state']['revision'],1)
