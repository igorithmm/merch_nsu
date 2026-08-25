"""Локальный HTTP-сервер: раздаёт интерфейс и обслуживает JSON-API."""

import json
import mimetypes
import os
import posixpath
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from . import api, db

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


class Handler(BaseHTTPRequestHandler):
    server_version = "MerchNSU"
    protocol_version = "HTTP/1.1"

    # --- ответы ------------------------------------------------------------

    def _send(self, status, body=b"", content_type="application/octet-stream", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, data, status=200):
        payload = json.dumps(data, ensure_ascii=False, default=str)
        self._send(status, payload, "application/json; charset=utf-8")

    def _error(self, message, status=400):
        self._json({"error": message}, status)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise api.ApiError("Не удалось разобрать запрос")
        return data if isinstance(data, dict) else {}

    # --- маршрутизация -----------------------------------------------------

    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def _dispatch(self, method):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        try:
            if path.startswith("/api/"):
                self._handle_api(method, path, params)
            elif method == "GET":
                self._serve_static(path)
            else:
                self._error("Метод не поддерживается", 405)
        except api.ApiError as exc:
            self._error(exc.message, exc.status)
        except BrokenPipeError:
            pass
        except Exception as exc:  # noqa: BLE001 — в локальном приложении показываем причину
            self._error("Внутренняя ошибка: %s" % exc, 500)

    def _handle_api(self, method, path, params):
        route = path[len("/api/"):].rstrip("/")

        if method == "GET":
            if route == "bootstrap":
                return self._json(api.bootstrap())
            if route == "products":
                return self._json(
                    {"products": api.list_products(include_archived=params.get("archived") == "1")}
                )
            if route == "movements":
                return self._json(api.list_movements(params))
            if route == "reports":
                return self._json(api.build_reports(params))
            if route == "export/stock.csv":
                return self._send(
                    200,
                    "﻿" + api.export_stock_csv(),
                    "text/csv; charset=utf-8",
                    {"Content-Disposition": 'attachment; filename="ostatki.csv"'},
                )
            if route == "export/movements.csv":
                return self._send(
                    200,
                    "﻿" + api.export_movements_csv(params),
                    "text/csv; charset=utf-8",
                    {"Content-Disposition": 'attachment; filename="zhurnal.csv"'},
                )
            return self._error("Неизвестный запрос", 404)

        if method == "POST":
            body = self._read_json()
            if route == "products":
                product_id = api.save_product(body)
                return self._json({"id": product_id, "products": api.list_products()})
            match = re.fullmatch(r"products/(\d+)", route)
            if match:
                api.save_product(body, product_id=int(match.group(1)))
                return self._json({"products": api.list_products()})
            match = re.fullmatch(r"products/(\d+)/archive", route)
            if match:
                api.archive_product(int(match.group(1)), bool(body.get("archived", True)))
                return self._json({"ok": True})
            if route == "move":
                return self._json(api.do_move(body))
            if route == "receipt":
                return self._json(api.do_receipt(body))
            if route == "set-qty":
                return self._json(api.do_set_qty(body))
            if route == "undo":
                return self._json(api.do_undo(body))
            if route == "sellers":
                return self._json({"id": api.add_seller(body.get("name")), "sellers": api.list_sellers(True)})
            match = re.fullmatch(r"sellers/(\d+)/active", route)
            if match:
                api.set_seller_active(int(match.group(1)), bool(body.get("active", True)))
                return self._json({"sellers": api.list_sellers(True)})
            if route == "settings":
                for key in ("low_stock", "dead_days"):
                    if key in body:
                        db.set_setting(key, int(body[key]))
                return self._json({"ok": True})
            return self._error("Неизвестный запрос", 404)

        if method == "DELETE":
            match = re.fullmatch(r"products/(\d+)", route)
            if match:
                api.delete_product(int(match.group(1)))
                return self._json({"products": api.list_products()})
            return self._error("Неизвестный запрос", 404)

        return self._error("Метод не поддерживается", 405)

    # --- статика -----------------------------------------------------------

    def _serve_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        # Защита от выхода за пределы каталога web/.
        safe = posixpath.normpath(path).lstrip("/")
        full = os.path.normpath(os.path.join(WEB_DIR, safe))
        if not full.startswith(WEB_DIR) or not os.path.isfile(full):
            return self._error("Файл не найден", 404)

        ctype, _ = mimetypes.guess_type(full)
        if ctype and ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        with open(full, "rb") as fh:
            self._send(200, fh.read(), ctype or "application/octet-stream")

    def log_message(self, fmt, *args):
        # Тихий лог: сообщаем только про ошибки.
        status = args[1] if len(args) > 1 else ""
        if str(status).startswith(("4", "5")):
            print("  ! %s %s" % (self.command, self.path))


def serve(host="127.0.0.1", port=8765):
    db.connect()
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    return httpd
