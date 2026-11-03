import time
def now():return int(time.time()*1000)
def mutate(s,a,p):
 s=s.copy();t=now();r=s['deadline']-t if s['mode']=='running' else s['remaining']
 if a=='start':
  if s['mode']=='running':raise ValueError('Already running')
  s.update(mode='running',deadline=t+r,remaining=None)
 elif a=='pause':
  if s['mode']!='running':raise ValueError('Not running')
  s.update(mode='paused',remaining=r,deadline=None)
 elif a in ('reset','duration'):
  if a=='duration':
   v=p.get('seconds')
   if type(v)!=int or not 60<=v<=10800 or v%60:raise ValueError('Use 1–180 whole minutes')
   s['duration']=v
  s.update(mode='prepared',remaining=s['duration']*1000,deadline=None)
 elif a=='adjust':
  v=p.get('seconds')
  if type(v)!=int or v not in (-60,60):raise ValueError('Invalid adjustment')
  r+=v*1000
  if not -86400000<=r<=10800000:raise ValueError('Outside adjustment limits')
  if s['mode']=='running':s['deadline']=t+r
  else:s.update(mode='paused',remaining=r)
 elif a=='title':
  v=p.get('text')
  if not isinstance(v,str) or len(v)>120:raise ValueError('Title limit is 120 characters')
  s['title']=v
 else:raise ValueError('Unknown command')
 s['revision']+=1;return s
