"""Isolated local capacity run: 20 sessions x (2 controllers + 5 displays)."""
import asyncio, json, os, subprocess, sys, tempfile, time, statistics
import httpx
from websockets.asyncio.client import connect

async def run():
    connections=[]; groups=[]; latencies=[]
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8123') as client:
        for _ in range(100):
            try:
                if (await client.get('/readyz')).status_code==200:break
            except httpx.ConnectError:pass
            await asyncio.sleep(.1)
        for _ in range(20):
            links=(await client.post('/api/sessions')).json(); group=[]
            for role,link in [('control',links['controller'])]*2+[('display',links['display'])]*5:
                sid=link.split('/')[2].split('#')[0]
                ws=await connect('ws://127.0.0.1:8123/ws/'+sid,origin='http://localhost:8123')
                await ws.send(json.dumps(dict(type='auth',role=role,token=link.split('#')[1])))
                await ws.recv();connections.append(ws);group.append(ws)
            groups.append(group)
        async def drain(ws):
            while True:
                m=json.loads(await ws.recv())
                if m.get('state',{}).get('revision')==target_revision:return m
        for round_number in range(20):
            target_revision=round_number+1
            for group in groups:
                start=time.perf_counter()
                action='start' if round_number==0 else 'adjust_time'
                payload={} if round_number==0 else {'seconds':60 if round_number%2 else -60}
                await group[0].send(json.dumps(dict(type='command',request_id=f'capacity-{round_number}',expected_revision=round_number,action=action,payload=payload)))
                results=await asyncio.wait_for(asyncio.gather(*(drain(ws) for ws in group)),3)
                latencies.append((time.perf_counter()-start)*1000)
                assert len({r['state']['deadline_utc_ms'] for r in results})==1
        for ws in connections:await ws.close()
    print(json.dumps(dict(sessions=20,connections=140,mutations=400,median_ms=round(statistics.median(latencies),2),max_ms=round(max(latencies),2),failures=0)))

if __name__=='__main__':
    import threading
    import uvicorn
    with tempfile.TemporaryDirectory() as folder:
        os.environ.update(DATABASE_PATH=folder+'/capacity.db', BASE_URL='http://localhost:8123', ALLOWED_ORIGINS='http://localhost:8123', AUTH_PER_MINUTE='1000', CREATE_PER_MINUTE='1000')
        sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[1]))
        import app
        import logging
        logging.getLogger('countdown').setLevel(logging.ERROR)
        logging.getLogger('httpx').setLevel(logging.ERROR)
        server=uvicorn.Server(uvicorn.Config(app.app, host='127.0.0.1', port=8123, log_level='error',access_log=False))
        thread=threading.Thread(target=server.run)
        thread.start()
        try:asyncio.run(run())
        finally:
            server.should_exit=True
            thread.join(timeout=20)
            app.db.close()
