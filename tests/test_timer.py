import os,tempfile,unittest
os.environ['DATABASE_PATH']=tempfile.mktemp()
from timer import mutate,now
class TimerTests(unittest.TestCase):
 def base(self):return dict(mode='prepared',duration=1800,remaining=1800000,deadline=None,revision=0)
 def test_cycle(self):
  s=mutate(self.base(),'start',{});self.assertEqual(s['mode'],'running')
  s=mutate(s,'pause',{});self.assertGreater(s['remaining'],1799000)
  s=mutate(s,'adjust',{'seconds':-60});self.assertEqual(s['duration'],1800)
  s=mutate(s,'reset',{});self.assertEqual(s['remaining'],1800000)
 def test_overtime(self):
  s=self.base();s.update(mode='running',deadline=now()-10000)
  s=mutate(s,'pause',{});self.assertLess(s['remaining'],0)
  s=mutate(s,'adjust',{'seconds':60});self.assertGreater(s['remaining'],0)
 def test_validation(self):
  for n in [0,61,10860,True]:
   with self.assertRaises(ValueError):mutate(self.base(),'duration',{'seconds':n})
