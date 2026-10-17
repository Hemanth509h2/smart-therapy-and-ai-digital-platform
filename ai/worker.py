"""Gunicorn worker that runs the websockets server from server.py.

server.py is a plain asyncio `websockets` server, not a WSGI/ASGI app, so the
stock gunicorn workers can't host it. This worker serves it on the sockets the
gunicorn master bound and keeps the master's contract: a heartbeat every second,
and TERM/INT/QUIT stop the worker. Open STT sockets are closed with 1001
(going away) on shutdown so browsers reconnect to another worker.
"""

import asyncio
import contextlib
import os
import signal

from gunicorn.workers.base import Worker

import server


class WebSocketWorker(Worker):
    def load_wsgi(self):
        pass  # no WSGI app to load; server.handler is the app

    def init_signals(self):
        # Handle signals on the event loop instead of interrupting it mid-callback.
        for s in self.SIGNALS:
            signal.signal(s, signal.SIG_DFL)
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        for s in (signal.SIGTERM, signal.SIGINT, signal.SIGQUIT):
            self.loop.add_signal_handler(s, self.stop)
        self.loop.add_signal_handler(signal.SIGUSR1, self.log.reopen_files)
        self.loop.add_signal_handler(signal.SIGWINCH, lambda: None)
        signal.signal(signal.SIGABRT, self.handle_abort)  # sent by the master on timeout

    def stop(self):
        self.alive = False

    def run(self):
        try:
            self.loop.run_until_complete(self.serve())
        finally:
            self.loop.close()

    async def serve(self):
        async with contextlib.AsyncExitStack() as stack:
            for s in self.sockets:
                await stack.enter_async_context(server.make_server(sock=s.sock))
            while self.alive:
                self.notify()
                if self.ppid != os.getppid():
                    self.log.info("Parent changed, shutting down: %s", self)
                    break
                await asyncio.sleep(1)
