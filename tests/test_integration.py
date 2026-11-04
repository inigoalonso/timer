import os
import json
import tempfile
import unittest
from contextlib import contextmanager
from fastapi.testclient import TestClient

folder = tempfile.TemporaryDirectory()
os.environ['DATABASE_PATH'] = folder.name + '/test.db'
os.environ['BASE_URL'] = 'http://testserver'
os.environ['CREATE_PER_MINUTE'] = '1000'
os.environ['AUTH_PER_MINUTE'] = '1000'
import app as server

class Integration(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.client.__enter__()
        self.links = self.client.post('/api/sessions').json()
        self.sid = self.links['controller'].split('/')[2].split('#')[0]

    def tearDown(self):
        self.client.__exit__(None,None,None)

    @contextmanager
    def socket(self, role='control', token=None):
        link = self.links['controller' if role=='control' else 'display']
        with self.client.websocket_connect('/ws/'+self.sid, headers={'origin':'http://testserver'}) as w:
            w.send_json(dict(type='auth',role=role,token=token or link.split('#')[1]))
            yield w

    def command(self, w, action='start', revision=0, request='one', payload=None):
        w.send_json(dict(type='command',action=action,expected_revision=revision,request_id=request,payload=payload or {}))

    def outcome(self,w):
        while True:
            m=w.receive_json()
            if m['type']!='state':return m

    def test_receipt_conflict_and_reuse(self):
        with self.socket() as w:
            w.receive_json()
            self.command(w)
            self.assertEqual(self.outcome(w)['type'],'ack')
            self.command(w)
            self.assertEqual(self.outcome(w)['revision'],1)
            self.command(w,action='pause')
            self.assertEqual(self.outcome(w)['code'],'request_id_reused')
            self.command(w,request='stale')
            m=self.outcome(w)
            self.assertEqual(m['code'],'revision_conflict')
            self.assertEqual(m['state']['revision'],1)
        with self.socket() as w:
            self.assertEqual(w.receive_json()['state']['mode'],'running')
            self.command(w)
            self.assertEqual(self.outcome(w)['revision'],1)

    def test_display_and_malformed(self):
        with self.socket('display') as w:
            w.receive_json()
            for value in ('[]','null','{','"x"'):
                w.send_text(value)
                self.assertEqual(self.outcome(w)['code'],'invalid_message')
            self.command(w)
            self.assertEqual(self.outcome(w)['code'],'read_only')
            w.send_json(dict(type='ping',sent=123))
            self.assertEqual(self.outcome(w)['sent'],123)

    def test_rotation_and_expiry(self):
        with self.socket() as w:
            w.receive_json()
            self.command(w,action='rotate_display')
            m=self.outcome(w)
            self.assertIn('display_url',m)
            self.assertNotIn(m['display_url'].split('#')[1],str(server.db.execute('SELECT * FROM receipts').fetchall()))
        from starlette.websockets import WebSocketDisconnect
        with self.assertRaises(WebSocketDisconnect):
            with self.socket('display') as w:w.receive_json()
        with server.db:
            server.db.execute('UPDATE sessions SET expires_at=0 WHERE id=?',(self.sid,))
        with self.assertRaises(WebSocketDisconnect):
            with self.socket() as w:w.receive_json()

    def test_database_write_failure(self):
        with self.socket() as w:
            w.receive_json()
            server.db.execute('PRAGMA query_only=ON')
            try:
                self.command(w)
                self.assertEqual(self.outcome(w)['code'],'database_unavailable')
                self.assertEqual(json.loads(server.get(self.sid)[2])['revision'],0)
            finally:
                server.db.execute('PRAGMA query_only=OFF')

    def test_playlist_save_transition_and_reconnect(self):
        entries = [dict(title='Opening', duration_seconds=600, qa_duration_seconds=120),
                   dict(title='Closing', duration_seconds=900, qa_duration_seconds=0)]
        with self.socket() as controller:
            self.assertEqual(controller.receive_json()['state']['playlist'], [])
            self.command(controller, action='set_playlist', payload={'entries': entries})
            self.assertEqual(self.outcome(controller)['type'], 'ack')
            self.command(controller, action='set_playlist', payload={'entries': entries})
            self.assertEqual(self.outcome(controller)['revision'], 1)
            with self.socket('display') as display:
                self.assertEqual(display.receive_json()['state']['playlist'], entries)
                self.command(display, action='set_playlist', revision=1, payload={'entries': []})
                self.assertEqual(self.outcome(display)['code'], 'read_only')
                self.command(controller, action='load_presentation', revision=1, request='load',
                             payload={'index': 0, 'phase': 'talk'})
                self.assertEqual(self.outcome(controller)['type'], 'ack')
                state = display.receive_json()['state']
                self.assertEqual((state['title'], state['mode'], state['playlist_phase']),
                                 ('Opening', 'prepared', 'talk'))
                self.command(controller, action='next_presentation', revision=2, request='qa')
                self.assertEqual(self.outcome(controller)['type'], 'ack')
                state = display.receive_json()['state']
                self.assertEqual((state['playlist_phase'], state['selected_duration_seconds']), ('qa', 120))
        with self.socket() as controller:
            state = controller.receive_json()['state']
            self.assertEqual(state['playlist'], entries)
            self.assertEqual(state['playlist_phase'], 'qa')
            self.command(controller, action='set_playlist', revision=2, request='stale-list', payload={'entries': []})
            self.assertEqual(self.outcome(controller)['code'], 'revision_conflict')

    def test_playlist_payload_limits(self):
        entries = [dict(title='Presentation ' + str(index) + 'x' * 100,
                        duration_seconds=10800, qa_duration_seconds=10800) for index in range(100)]
        with self.socket() as controller:
            controller.receive_json()
            self.command(controller, action='set_playlist', payload={'entries': entries})
            self.assertEqual(self.outcome(controller)['type'], 'ack')
            for index, bad in enumerate(([dict(entries[0], unexpected=True)], entries + [entries[0]],
                                         [dict(entries[0], duration_seconds=True)],
                                         [dict(entries[0], title=' ')],
                                         [dict(entries[0], qa_duration_seconds=-60)])):
                self.command(controller, action='set_playlist', revision=1, request='invalid-'+str(index),
                             payload={'entries': bad})
                self.assertEqual(self.outcome(controller)['code'], 'invalid_transition')
            self.assertEqual(json.loads(server.get(self.sid)[2])['playlist'], entries)

    def test_legacy_snapshot_playlist_defaults(self):
        state = json.loads(server.get(self.sid)[2])
        for field in ('playlist', 'playlist_index', 'playlist_phase'):
            state.pop(field)
        with server.db:
            server.db.execute('UPDATE sessions SET state=? WHERE id=?', (json.dumps(state), self.sid))
        with self.socket() as controller:
            snapshot = controller.receive_json()['state']
            self.assertEqual(snapshot['playlist'], [])
            self.assertIsNone(snapshot['playlist_index'])
            self.command(controller, action='set_playlist', payload={'entries': []})
            self.assertEqual(self.outcome(controller)['type'], 'ack')

    def test_security_and_health(self):
        self.assertEqual(self.client.get('/readyz').status_code,200)
        self.assertIn('Content-Security-Policy',self.client.get('/').headers)
        from starlette.websockets import WebSocketDisconnect
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect('/ws/'+self.sid,headers={'origin':'https://evil.example'}) as w:w.receive_json()
        with self.assertRaises(WebSocketDisconnect):
            with self.socket('display',self.links['controller'].split('#')[1]) as w:w.receive_json()


def tearDownModule():
    server.db.close()
    folder.cleanup()
