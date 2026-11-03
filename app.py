import os,json,time,secrets,hashlib,sqlite3,asyncio
from pathlib import Path
from fastapi import FastAPI,WebSocket
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
app=FastAPI();root=Path(__file__).parent
path=os.getenv('DATABASE_PATH','data/timers.db');Path(path).parent.mkdir(parents=True,exist_ok=True)
db=sqlite3.connect(path,check_same_thread=False);db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, control TEXT, display TEXT, state TEXT)');db.commit()
clients={};lock=asyncio.Lock()
def now():return int(time.time()*1000)
def digest(t):return hashlib.sha256(t.encode()).hexdigest()
def get(sid):return db.execute('SELECT control,display,state FROM sessions WHERE id=?',(sid,)).fetchone()
from timer import mutate
async def broadcast(sid):
 row=get(sid)
 if not row:return
 s=json.loads(row[2]);s.update(server_time=now(),displays=sum(r=='display' for w,r in clients.get(sid,[])))
 for w,r in list(clients.get(sid,[])):
  try:await asyncio.wait_for(w.send_json({'type':'state','state':s}),2)
  except Exception:pass
@app.get('/')
@app.get('/control/{sid}')
@app.get('/display/{sid}')
async def index(sid:str=''):return FileResponse(root/'static/index.html',headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})
@app.post('/api/sessions')
async def create():
 sid=secrets.token_urlsafe(12);c=secrets.token_urlsafe(24);d=secrets.token_urlsafe(24)
 s=dict(mode='prepared',duration=1800,remaining=1800000,deadline=None,title='',revision=0)
 db.execute('INSERT INTO sessions VALUES(?,?,?,?)',(sid,digest(c),digest(d),json.dumps(s)));db.commit()
 return dict(controller=f'/control/{sid}#{c}',display=f'/display/{sid}#{d}')
@app.get('/healthz')
async def health():db.execute('SELECT 1');return {'ok':True}
@app.websocket('/ws/{sid}')
async def socket(w:WebSocket,sid:str):
 origin=w.headers.get('origin','');allowed=os.getenv('ALLOWED_ORIGINS','').split(',')
 if origin not in allowed and origin.split('://')[-1]!=w.headers.get('host'):
  await w.close(code=1008);return
 await w.accept()
 try:
  auth=await asyncio.wait_for(w.receive_json(),5);row=get(sid)
  if not row:await w.close(code=1008);return
  token=digest(str(auth.get('token','')));role='control' if secrets.compare_digest(token,row[0]) else 'display' if secrets.compare_digest(token,row[1]) else None
  if not role:await w.close(code=1008);return
  clients.setdefault(sid,[]).append((w,role));await broadcast(sid)
  while True:
   m=await asyncio.wait_for(w.receive_json(),30)
   if m.get('type')=='ping':await w.send_json({'type':'pong','sent':m.get('sent'),'server_time':now()});continue
   async with lock:
    s=json.loads(get(sid)[2])
    try:
     if role!='control':raise ValueError('Read-only display')
     if m.get('revision')!=s['revision']:raise ValueError('Timer changed. Review and retry.')
     s=mutate(s,m.get('action'),m.get('payload',{}))
     db.execute('UPDATE sessions SET state=? WHERE id=?',(json.dumps(s),sid));db.commit();await broadcast(sid)
    except (ValueError,TypeError) as e:await w.send_json({'type':'error','message':str(e)});await broadcast(sid)
 except Exception:pass
 finally:
  clients[sid]=[(a,b) for a,b in clients.get(sid,[]) if a is not w];await broadcast(sid)
  try:await w.close()
  except Exception:pass
app.mount('/static',StaticFiles(directory=root/'static'),name='static')
