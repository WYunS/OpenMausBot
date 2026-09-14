#!/usr/bin/env python3
"""Authenticated HTTP-to-MCP bridge for a private Cua Driver daemon."""

import hmac
import json
import os
import re
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DRIVER = "/opt/ogb/cua-driver"
SOCKET = "/opt/ogb/run/cua.sock"
TOKEN_FILE = "/opt/ogb/run/cua-bridge.token"
PORT = 18765
MAX_REQUEST_BYTES = 128 * 1024
ALLOWED_METHODS = {
    "initialize",
    "notifications/initialized",
    "ping",
    "tools/list",
    "tools/call",
}


def read_token():
    with open(TOKEN_FILE, "r", encoding="ascii") as handle:
        token = handle.read().strip()
    if not re.fullmatch(r"[0-9a-f]{64}", token):
        raise RuntimeError("invalid bridge token")
    return token


TOKEN = read_token()


class DriverMcp:
    def __init__(self):
        self.lock = threading.Lock()
        self.child = None

    def _start(self):
        if self.child is not None and self.child.poll() is None:
            return
        self.child = subprocess.Popen(
            [DRIVER, "mcp", "--socket", SOCKET],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            bufsize=1,
            env={
                **os.environ,
                "CUA_DRIVER_RS_TELEMETRY_ENABLED": "false",
                "CUA_DRIVER_RS_UPDATE_CHECK": "false",
            },
        )

    def _restart(self):
        if self.child is not None and self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait(timeout=2)
        self.child = None
        self._start()

    def healthy(self):
        with self.lock:
            self._start()
            return self.child is not None and self.child.poll() is None

    def rpc(self, message):
        with self.lock:
            # HTTP clients do not share one transport lifecycle. Give every
            # MCP initialize a fresh driver transport so a completed prior
            # turn cannot leave the next bot attached to an ended implicit
            # session.
            if message.get("method") == "initialize":
                self._restart()
            else:
                self._start()
            child = self.child
            if child is None or child.stdin is None or child.stdout is None:
                raise RuntimeError("CUA MCP process unavailable")
            child.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
            child.stdin.flush()
            request_id = message.get("id")
            if request_id is None:
                return {"ok": True}
            while True:
                line = child.stdout.readline()
                if not line:
                    raise RuntimeError("CUA MCP process exited")
                response = json.loads(line)
                if response.get("id") == request_id:
                    return response


DRIVER_MCP = DriverMcp()


class Handler(BaseHTTPRequestHandler):
    server_version = "OpenMausBotCuaBridge/1"

    def log_message(self, _format, *_args):
        return

    def _authorized(self):
        supplied = self.headers.get("authorization", "")
        return hmac.compare_digest(supplied, "Bearer " + TOKEN)

    def _json(self, status, value):
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _deny_unless_authorized(self):
        if self._authorized():
            return False
        self._json(401, {"error": "unauthorized"})
        return True

    def do_GET(self):
        if self.path != "/health":
            self._json(404, {"error": "not found"})
            return
        if self._deny_unless_authorized():
            return
        try:
            self._json(200, {"ok": DRIVER_MCP.healthy()})
        except Exception:
            self._json(503, {"ok": False})

    def do_POST(self):
        if self.path != "/rpc":
            self._json(404, {"error": "not found"})
            return
        if self._deny_unless_authorized():
            return
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            self._json(400, {"error": "invalid content length"})
            return
        if length < 2 or length > MAX_REQUEST_BYTES:
            self._json(413, {"error": "request too large"})
            return
        try:
            message = json.loads(self.rfile.read(length))
        except Exception:
            self._json(400, {"error": "invalid json"})
            return
        if not isinstance(message, dict) or message.get("method") not in ALLOWED_METHODS:
            self._json(400, {"error": "unsupported method"})
            return
        try:
            self._json(200, DRIVER_MCP.rpc(message))
        except Exception:
            self._json(502, {"error": "CUA MCP unavailable"})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
