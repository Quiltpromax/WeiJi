"""Local preview server, runnable independently of the Codex command session."""
import argparse
import functools
import json
import logging
import os
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app" / "src" / "main" / "assets"
OUT = ROOT / "artifacts"

class PreviewHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        logging.info(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path == "/__weiji_health":
            data = json.dumps({"app": "weiji-preview", "pid": os.getpid()}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    logging.basicConfig(filename=OUT / "preview-server.log", encoding="utf-8", level=logging.INFO,
                        format="%(asctime)s %(message)s")
    try:
        handler = functools.partial(PreviewHandler, directory=str(ASSETS))
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
        (OUT / "preview-server.pid").write_text(str(os.getpid()), encoding="ascii")
        logging.info("Preview ready at http://127.0.0.1:%s/?demo=1", args.port)
        server.serve_forever()
    except Exception:
        logging.exception("Preview server stopped")
        raise
