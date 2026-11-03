import asyncio
import unittest
from app import Peer

class SlowSocket:
    def __init__(self):self.closed=False
    async def send_json(self,message):await asyncio.Event().wait()
    async def close(self,code):self.closed=True

class SocketIsolation(unittest.IsolatedAsyncioTestCase):
    async def test_queue_overflow_disconnects_without_blocking_producer(self):
        socket=SlowSocket();peer=Peer(socket,'display');peer.task=asyncio.create_task(peer.writer())
        await asyncio.sleep(0)
        for _ in range(40):peer.send(dict(type='error',code='test',message='test'))
        await asyncio.gather(peer.task,return_exceptions=True)
        self.assertTrue(socket.closed)
        self.assertLessEqual(peer.queue.qsize(),32)
    async def test_send_timeout_disconnects(self):
        socket=SlowSocket();peer=Peer(socket,'display');peer.task=asyncio.create_task(peer.writer())
        peer.send(dict(type='error',code='test',message='test'))
        await asyncio.wait_for(peer.task,3)
        self.assertTrue(socket.closed)
