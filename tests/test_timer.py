import unittest
from timer import initial, mutate

class TimerTests(unittest.TestCase):
    def change(self,s,a,p=None,t=1000):return mutate(s,a,p or {},clock=lambda:t)
    def test_cycle(self):
        s=self.change(initial(),'start')
        self.assertEqual(s['deadline_utc_ms'],1801000)
        s=self.change(s,'pause',t=2000)
        self.assertEqual(s['paused_remaining_ms'],1799000)
        s=self.change(s,'start',t=3000)
        self.assertEqual(s['deadline_utc_ms'],1802000)
        self.assertEqual(self.change(s,'reset')['paused_remaining_ms'],1800000)
    def test_adjust_all_states(self):
        for mode in ('prepared','paused','running'):
            for delta in (-60,60):
                s=initial();s['mode']=mode
                if mode=='running':s['deadline_utc_ms']=1000-10000
                result=self.change(s,'adjust_time',{'seconds':delta})
                value=result['deadline_utc_ms']-1000 if mode=='running' else result['paused_remaining_ms']
                self.assertEqual(value,(-10000 if mode=='running' else 1800000)+delta*1000)
                self.assertEqual(result['selected_duration_seconds'],1800)
    def test_boundaries(self):
        for remaining in (301000,300000,61000,60000,1,0,-1,-10000):
            s=initial();s.update(mode='running',deadline_utc_ms=1000+remaining)
            paused=self.change(s,'pause')
            self.assertEqual(paused['paused_remaining_ms'],remaining)
            self.assertEqual(self.change(paused,'start')['deadline_utc_ms'],1000+remaining)
    def test_validation(self):
        for n in (0,61,10860,True,'60',None):
            with self.assertRaises(ValueError):self.change(initial(),'set_duration',{'seconds':n})
        for action in ('pause','unknown'):
            with self.assertRaises(ValueError):self.change(initial(),action)
        with self.assertRaises(ValueError):self.change(initial(),'set_title',{'text':'x'*121})
    def test_title_is_data(self):
        self.assertEqual(self.change(initial(),'set_title',{'text':'<script>alert(1)</script>'})['title'],'<script>alert(1)</script>')

    def test_playlist_transitions(self):
        entries = [dict(title='Opening', duration_seconds=600, qa_duration_seconds=120),
                   dict(title='Closing', duration_seconds=900, qa_duration_seconds=0)]
        state = self.change(initial(), 'set_playlist', {'entries': entries})
        self.assertIsNone(state['playlist_index'])
        state = self.change(state, 'next_presentation')
        self.assertEqual((state['title'], state['playlist_phase'], state['paused_remaining_ms']),
                         ('Opening', 'talk', 600000))
        state = self.change(state, 'start')
        state = self.change(state, 'next_presentation')
        self.assertEqual((state['mode'], state['playlist_phase'], state['paused_remaining_ms']),
                         ('prepared', 'qa', 120000))
        state = self.change(state, 'next_presentation')
        self.assertEqual((state['title'], state['playlist_index']), ('Closing', 1))
        with self.assertRaises(ValueError):
            self.change(state, 'next_presentation')
        with self.assertRaises(ValueError):
            self.change(state, 'load_presentation', {'index': 1, 'phase': 'qa'})
        self.assertIsNone(self.change(state, 'set_duration', {'seconds': 60})['playlist_index'])

    def test_playlist_validation_and_isolation(self):
        entry = dict(title='Talk', duration_seconds=600, qa_duration_seconds=0)
        state = self.change(initial(), 'set_playlist', {'entries': [entry]})
        entry['title'] = 'Changed'
        self.assertEqual(state['playlist'][0]['title'], 'Talk')
        for entries in (None, {}, [entry] * 101, [dict(entry, title=' ')],
                        [dict(entry, duration_seconds=True)], [dict(entry, qa_duration_seconds=61)],
                        [dict(entry, extra=1)], [dict(entry, duration_seconds=0)]):
            with self.assertRaises(ValueError):
                self.change(state, 'set_playlist', {'entries': entries})
        loaded = self.change(state, 'load_presentation', {'index': 0})
        running = self.change(loaded, 'start')
        edited = self.change(running, 'set_playlist', {'entries': []})
        self.assertEqual(edited['deadline_utc_ms'], running['deadline_utc_ms'])
        self.assertIsNone(edited['playlist_index'])
