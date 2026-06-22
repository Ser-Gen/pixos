#!/usr/bin/env python3
"""HTTP server with COOP/COEP headers for sherpa-onnx WASM (pthreads).

Also exposes GET /api/audio?url=<http(s)://…> — proxy for remote audio (CORS).

Alternative: use `python3 -m http.server` with service-worker.js
(/api/audio is handled in the SW).

Usage:
    cd /Users/svasilev/Work/__transcriber-go
    python3 serve.py 8080
"""
import http.server
import socketserver
import sys
import urllib.error
import urllib.request
from urllib.parse import parse_qs, unquote, urlparse


class CoopCoepHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/audio":
            self._handle_audio_proxy(parse_qs(parsed.query))
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def _handle_audio_proxy(self, query):
        target = (query.get("url") or [""])[0].strip()
        if not target:
            self.send_error(400, "Missing url query parameter")
            return
        try:
            parsed = urlparse(unquote(target))
        except ValueError:
            self.send_error(400, "Invalid url")
            return
        if parsed.scheme not in ("http", "https"):
            self.send_error(400, "Only http/https URLs are allowed")
            return

        req = urllib.request.Request(
            parsed.geturl(),
            headers={"User-Agent": "GigaAM-Transcriber/1.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
                content_type = resp.headers.get("Content-Type", "application/octet-stream")
        except urllib.error.HTTPError as err:
            self.send_error(err.code, f"Upstream HTTP {err.code}")
            return
        except urllib.error.URLError as err:
            self.send_error(502, f"Upstream error: {err.reason}")
            return

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", port), CoopCoepHandler) as httpd:
        print(f"serving with COOP/COEP on http://localhost:{port}/")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
