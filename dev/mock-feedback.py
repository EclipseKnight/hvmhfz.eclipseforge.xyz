#!/usr/bin/env python3
"""Local stand-in for POST /api/feedback, to test report.html without the REST API.

    python3 dev/mock-feedback.py [status] [port]     # defaults: 201 8099
    python3 -m http.server 8000                      # in another terminal
    open http://localhost:8000/report.html?api=http://localhost:8099

status is the HTTP code every submission gets: 201 (success), 400, 403 or 429 (errors the
player can fix), 502 (service down: Discord fallback). Each request body is printed.
Run it from the repo root. Never used by the live site.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

STATUS = int(sys.argv[1]) if len(sys.argv) > 1 else 201
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8099


class Handler(BaseHTTPRequestHandler):
    task_id = 100

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin") or "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_POST(self):
        if self.path != "/api/feedback":
            self.send_response(404)
            self.cors()
            self.end_headers()
            return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        print(json.dumps(body), flush=True)
        reply = {}
        if STATUS == 201:
            Handler.task_id += 1
            reply = {"taskId": Handler.task_id}
        data = json.dumps(reply).encode()
        self.send_response(STATUS)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    print(f"mock /api/feedback on http://localhost:{PORT}, replying {STATUS}", flush=True)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
