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
