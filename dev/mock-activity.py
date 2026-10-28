#!/usr/bin/env python3
"""Local stand-in for GET /api/public/activity, to test the live board on worlds.html without the REST API.

    python3 dev/mock-activity.py [answer] [port]     # defaults: busy 8099
    python3 -m http.server 8000                      # in another terminal
    open http://localhost:8000/worlds.html?api=http://localhost:8099

answer is a board from dev/activity-fixtures.json (busy, empty, hidden) or an HTTP status
(401, 500) to test the error message. busy has every Discord name case: no discordName key,
null, a name, and a name with HTML in it (must show as text, with no image or alert). Only
the board is mocked: the world cards and monster list on the page still read the real API. Run it from the repo root. Never used by the live site.
"""
import json
import pathlib
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

ANSWER = sys.argv[1] if len(sys.argv) > 1 else "busy"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8099
FIXTURES = json.loads((pathlib.Path(__file__).parent / "activity-fixtures.json").read_text())


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/public/activity":
            status, body = 404, {}
        elif ANSWER.isdigit():
            status, body = int(ANSWER), {}
        else:
            status, body = 200, FIXTURES[ANSWER]
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin") or "*")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    print(f"mock /api/public/activity on http://localhost:{PORT}, answering {ANSWER}", flush=True)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
