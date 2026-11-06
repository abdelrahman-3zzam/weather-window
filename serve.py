"""
Weather Window: local preview server (Python standard library only).

    python serve.py            # opens http://127.0.0.1:8765 (or the next free port)
    python serve.py --port 9000
    python serve.py --no-browser

ES modules cannot load from file://, so the site needs a small web server.
If the port is busy or reserved ([Errno 13] / [Errno 10048] on Windows), the
next ports are tried automatically and the real URL is printed.
"""

import argparse
import functools
import http.server
import socket
import sys
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"

HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(self), camera=(), microphone=()",
    "Cache-Control": "no-cache",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".webmanifest": "application/manifest+json",
    }

    def end_headers(self):
        for key, value in HEADERS.items():
            self.send_header(key, value)
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the console quiet


def port_is_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind((HOST, port))
        except OSError:
            return False
    return True


def choose_port(preferred, attempts=20):
    for port in range(preferred, preferred + attempts):
        if port_is_free(port):
            return port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((HOST, 0))
        return probe.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description="Serve Weather Window locally.")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    port = choose_port(args.port)
    handler = functools.partial(Handler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer((HOST, port), handler)
    url = f"http://{HOST}:{port}/"
    if port != args.port:
        print(f"Port {args.port} was unavailable; using {port} instead.")
    print(f"Weather Window is running at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
