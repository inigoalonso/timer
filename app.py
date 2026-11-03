import asyncio
import hashlib
import json
import logging
import os
import secrets
import sqlite3
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, ValidationError
from timer import initial, mutate, now

root = Path(__file__).parent
log = logging.getLogger('countdown')
logging.basicConfig(level=os.getenv('LOG_LEVEL', 'INFO'))
BASE_URL = os.getenv('BASE_URL', 'http://localhost:8000').rstrip('/')
from urllib.parse import urlsplit
def valid_origin(value):
    try:
        parsed = urlsplit(value)
        port = parsed.port
        return (parsed.scheme in ('http', 'https') and bool(parsed.hostname)
                and not parsed.username and not parsed.password and not parsed.path
                and not parsed.query and not parsed.fragment
                and (port is None or 1 <= port <= 65535))
    except ValueError:
        return False

if not valid_origin(BASE_URL):
    raise RuntimeError('BASE_URL must be an absolute HTTP(S) origin')
ORIGINS = [value.strip() for value in os.getenv('ALLOWED_ORIGINS', BASE_URL).split(',')]
if not all(valid_origin(value) for value in ORIGINS):
    raise RuntimeError('ALLOWED_ORIGINS must contain complete origins without paths')
TTL = int(os.getenv('SESSION_TTL_DAYS', '7')) * 86400000
MAX_SIZE = int(os.getenv('MAX_MESSAGE_BYTES', '4096'))
MAX_CONNECTIONS = int(os.getenv('MAX_CONNECTIONS', '500'))
CREATE_LIMIT = int(os.getenv('CREATE_PER_MINUTE', '10'))
AUTH_LIMIT = int(os.getenv('AUTH_PER_MINUTE', '30'))
MESSAGE_LIMIT = int(os.getenv('MESSAGES_PER_MINUTE', '120'))
if min(TTL, MAX_SIZE, MAX_CONNECTIONS, CREATE_LIMIT, AUTH_LIMIT, MESSAGE_LIMIT) <= 0:
    raise RuntimeError('Limits must be positive')
path = os.getenv('DATABASE_PATH', 'data/timers.db')
Path(path).parent.mkdir(parents=True, exist_ok=True)
db = sqlite3.connect(path, check_same_thread=False)
db.execute('PRAGMA busy_timeout=5000')
db.execute('PRAGMA journal_mode=WAL')
version = db.execute('PRAGMA user_version').fetchone()[0]
if version > 1:
    raise RuntimeError('Database schema is newer than this application')
if version == 0:
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='sessions'").fetchone():
        with sqlite3.connect(path + '.pre-v1.bak') as backup:
            db.backup(backup)
    with db:
        db.execute('CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, control TEXT, display TEXT, state TEXT)')
        columns = {r[1] for r in db.execute('PRAGMA table_info(sessions)')}
        for name in ('created_at', 'updated_at', 'expires_at'):
            if name not in columns:
                db.execute(f'ALTER TABLE sessions ADD COLUMN {name} INTEGER')
        for sid, raw in db.execute('SELECT id,state FROM sessions').fetchall():
            s = json.loads(raw)
            for old, new in [('duration','selected_duration_seconds'), ('remaining','paused_remaining_ms'), ('deadline','deadline_utc_ms')]:
                if old in s:
                    s[new] = s.pop(old)
            db.execute('UPDATE sessions SET state=?,created_at=?,updated_at=?,expires_at=? WHERE id=?', (json.dumps(s), now(), now(), now()+TTL, sid))
        db.execute('CREATE TABLE IF NOT EXISTS receipts(session_id TEXT, request_id TEXT, command TEXT, outcome TEXT, created_at INTEGER, PRIMARY KEY(session_id,request_id))')
        db.execute('PRAGMA user_version=1')
clients = defaultdict(set)
locks = {}
rates = {}
active_sockets = set()

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)

class Auth(StrictModel):
    type: Literal['auth']
    role: Literal['control', 'display']
    token: StrictStr = Field(min_length=20, max_length=200)

class Command(StrictModel):
    type: Literal['command']
    request_id: StrictStr = Field(min_length=1, max_length=100)
    expected_revision: StrictInt = Field(ge=0)
    action: Literal['start','pause','reset','set_duration','adjust_time','set_title','rotate_display']
    payload: dict = Field(default_factory=dict)

class SecondsPayload(StrictModel):
    seconds: StrictInt

class TitlePayload(StrictModel):
    text: StrictStr = Field(max_length=120)

class EmptyPayload(StrictModel):
    pass

class Snapshot(StrictModel):
    mode: Literal['prepared', 'running', 'paused']
    selected_duration_seconds: StrictInt
    paused_remaining_ms: StrictInt | None
    deadline_utc_ms: StrictInt | None
    title: StrictStr
    revision: StrictInt
    server_now_ms: StrictInt
    connected_display_count: StrictInt
    expires_at_ms: StrictInt

class Outgoing(StrictModel):
    type: Literal['state', 'ack', 'error', 'pong']
    state: Snapshot | None = None
    request_id: str | None = None
    code: str | None = None
    message: str | None = None
    revision: int | None = None
    display_url: str | None = None
    sent: float | int | None = None
    server_now_ms: int | None = None

class Ping(StrictModel):
    type: Literal['ping']
    sent: float | int = Field(allow_inf_nan=False)


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def get(sid):
    return db.execute('SELECT control,display,state,expires_at FROM sessions WHERE id=?', (sid,)).fetchone()


def limited(key, count):
    q = rates.setdefault(key, deque())
    while q and q[0] < now()-60000:
        q.popleft()
    if len(q) >= count:
        return True
    q.append(now())
    return False


def snapshot(sid):
    row = get(sid)
    s = json.loads(row[2])
    s.update(server_now_ms=now(), connected_display_count=sum(c.role == 'display' for c in clients.get(sid, ())), expires_at_ms=row[3])
    return s

class Peer:
    def __init__(self, ws, role):
        self.ws, self.role = ws, role
        self.queue = asyncio.Queue(maxsize=32)

    def send(self, message):
        try:
            self.queue.put_nowait(Outgoing.model_validate(message).model_dump(exclude_unset=True))
        except asyncio.QueueFull:
            self.task.cancel()

    async def writer(self):
        try:
            while True:
                await asyncio.wait_for(self.ws.send_json(await self.queue.get()), 2)
        except (asyncio.TimeoutError, WebSocketDisconnect, RuntimeError):
            log.info('socket writer disconnected')
        finally:
            await self.ws.close(code=1013)


def broadcast(sid):
    if get(sid):
        message = dict(type='state', state=snapshot(sid))
        for peer in list(clients.get(sid, ())):
            peer.send(message)


async def cleanup():
    while True:
        expired = [r[0] for r in db.execute('SELECT id FROM sessions WHERE expires_at<=?', (now(),))]
        with db:
            db.execute('DELETE FROM receipts WHERE created_at<? OR session_id IN (SELECT id FROM sessions WHERE expires_at<=?)', (now()-86400000, now()))
            db.execute('DELETE FROM sessions WHERE expires_at<=?', (now(),))
        for sid in expired:
            for peer in list(clients.get(sid, ())):
                await peer.ws.close(code=1008)
        for sid in list(locks):
            if not clients.get(sid) and not locks[sid].locked():
                locks.pop(sid, None)
        for key in list(rates):
            if not rates[key] or rates[key][-1] < now()-60000:
                rates.pop(key, None)
        await asyncio.sleep(10)


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(cleanup())
    try:
        yield
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

app = FastAPI(lifespan=lifespan)

@app.middleware('http')
async def headers(request, call_next):
    response = await call_next(request)
    response.headers.update({'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"})
    return response

@app.get('/')
@app.get('/control/{sid}')
@app.get('/display/{sid}')
async def index(sid: str = ''):
    return FileResponse(root/'static/index.html')

@app.post('/api/sessions')
async def create(request: Request):
    if limited(('create', request.client.host), CREATE_LIMIT):
        raise HTTPException(429, 'Creation limit reached')
    sid, c, d = (secrets.token_urlsafe(n) for n in (12, 24, 24))
    with db:
        db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)', (sid,digest(c),digest(d),json.dumps(initial()),now(),now(),now()+TTL))
    return dict(controller=f'/control/{sid}#{c}', display=f'/display/{sid}#{d}')

@app.get('/healthz')
async def health():
    return {'ok': True}

@app.get('/readyz')
async def ready():
    try:
        db.execute('SELECT count(*) FROM sessions').fetchone()
    except sqlite3.Error:
        raise HTTPException(503, 'Database unavailable')
    return {'ok': True}

async def receive(ws):
    event = await asyncio.wait_for(ws.receive(), 15)
    if event['type'] == 'websocket.disconnect':
        raise WebSocketDisconnect(event.get('code',1000))
    raw = event.get('text')
    if not isinstance(raw, str):
        raise ValueError('Text JSON required')
    if len(raw.encode()) > MAX_SIZE:
        raise ValueError('Message too large')
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError('Object required')
    return value

@app.websocket('/ws/{sid}')
async def socket(ws: WebSocket, sid: str):
    if ws.headers.get('origin') not in ORIGINS or len(active_sockets) >= MAX_CONNECTIONS:
        await ws.close(code=1008)
        return
    active_sockets.add(ws)
    await ws.accept()
    peer = None
    try:
        if limited(('auth',ws.client.host), AUTH_LIMIT):
            await ws.close(code=1008)
            return
        auth = Auth.model_validate(await asyncio.wait_for(receive(ws), 5))
        row = get(sid)
        if not row or row[3] <= now() or not secrets.compare_digest(digest(auth.token), row[0 if auth.role == 'control' else 1]):
            await ws.close(code=1008)
            return
        peer = Peer(ws, auth.role)
        peer.task = asyncio.create_task(peer.writer())
        clients[sid].add(peer)
        broadcast(sid)
        while True:
            command = None
            try:
                if limited(('message',id(peer)), MESSAGE_LIMIT):
                    await ws.close(code=1008)
                    break
                m = await receive(ws)
                row = get(sid)
                if not row or row[3] <= now() or not secrets.compare_digest(digest(auth.token),row[0 if auth.role=='control' else 1]):
                    await ws.close(code=1008)
                    break
                if m.get('type') == 'ping':
                    ping = Ping.model_validate(m)
                    peer.send(dict(type='pong', sent=ping.sent, server_now_ms=now()))
                    continue
                command = Command.model_validate(m)
                if peer.role != 'control':
                    peer.send(dict(type='error', request_id=command.request_id, code='read_only', message='Read-only display'))
                    continue
                async with locks.setdefault(sid, asyncio.Lock()):
                    canonical = command.model_dump_json()
                    receipt = db.execute('SELECT command,outcome FROM receipts WHERE session_id=? AND request_id=? AND created_at>?', (sid,command.request_id,now()-86400000)).fetchone()
                    if receipt:
                        peer.send(json.loads(receipt[1]) if receipt[0]==canonical else dict(type='error',request_id=command.request_id,code='request_id_reused',message='Request ID already used'))
                        continue
                    s = json.loads(get(sid)[2])
                    outcome = dict(type='ack', request_id=command.request_id)
                    new_secret = None
                    if command.expected_revision != s['revision']:
                        outcome.update(type='error',code='revision_conflict',message='Timer changed. Review and retry.',state=snapshot(sid))
                    else:
                        try:
                            payload_model = {'set_duration': SecondsPayload, 'adjust_time': SecondsPayload, 'set_title': TitlePayload}.get(command.action, EmptyPayload)
                            payload_model.model_validate(command.payload)
                            expected_keys = {'set_duration': {'seconds'}, 'adjust_time': {'seconds'}, 'set_title': {'text'}}.get(command.action, set())
                            if set(command.payload) != expected_keys:
                                raise ValueError('Unexpected command payload')
                            if command.action == 'rotate_display':
                                new_secret = secrets.token_urlsafe(24)
                                s['revision'] += 1
                                # Return the credential once; persistent receipts never store plaintext secrets.
                            else:
                                s = mutate(s,command.action,command.payload)
                            outcome['revision'] = s['revision']
                        except (ValueError, ValidationError) as exc:
                            outcome.update(type='error',code='invalid_transition',message='Invalid payload' if isinstance(exc, ValidationError) else str(exc))
                    with db:
                        if outcome['type']=='ack':
                            db.execute('UPDATE sessions SET state=?,updated_at=?,expires_at=? WHERE id=?', (json.dumps(s),now(),now()+TTL,sid))
                            if new_secret:
                                db.execute('UPDATE sessions SET display=? WHERE id=?',(digest(new_secret),sid))
                        db.execute('INSERT OR REPLACE INTO receipts VALUES(?,?,?,?,?)',(sid,command.request_id,canonical,json.dumps(outcome),now()))
                    if new_secret:
                        outcome['display_url'] = f'{BASE_URL}/display/{sid}#{new_secret}'
                        for other in list(clients[sid]):
                            if other.role=='display':
                                other.task.cancel()
                    peer.send(outcome)
                    broadcast(sid)
                    log.info('command session=%s action=%s outcome=%s revision=%s',sid,command.action,outcome['type'],s['revision'])
            except (ValueError, ValidationError, json.JSONDecodeError):
                peer.send(dict(type='error',code='invalid_message',message='Invalid message'))
            except sqlite3.Error:
                log.exception('database failure session=%s',sid)
                peer.send(dict(type='error',request_id=command.request_id if command else None,code='database_unavailable',message='Change could not be saved. Reconnect and review state.'))
    except (WebSocketDisconnect, asyncio.TimeoutError, ValueError, ValidationError):
        log.info('disconnected session=%s',sid)
    except sqlite3.Error:
        log.exception('database failure session=%s',sid)
    finally:
        active_sockets.discard(ws)
        if peer:
            clients[sid].discard(peer)
            if not clients[sid]:
                clients.pop(sid,None)
            peer.task.cancel()
            await asyncio.gather(peer.task, return_exceptions=True)
            rates.pop(('message',id(peer)),None)
            broadcast(sid)
        elif ws.application_state.name != 'DISCONNECTED':
            await ws.close(code=1008)

app.mount('/static', StaticFiles(directory=root/'static'), name='static')
