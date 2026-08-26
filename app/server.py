"""Локальный HTTP-сервер: раздаёт интерфейс и обслуживает JSON-API."""

import json
import mimetypes
import os
import posixpath
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from . import access, api, db

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")

# По этой метке ярлык запуска понимает, что приложение уже работает.
APP_TOKEN = "merch-nsu"

# Маршруты, доступные до входа: проверка живости для ярлыка, экран входа и
# сам вход. Данных они не отдают.
OPEN_ROUTES = {"ping", "session", "login", "logout"}

_httpd = None

# Адрес, на котором сокет слушает на самом деле, и заявка на смену адреса.
# Настройка «доступ по сети» и реальное состояние сокета — разные вещи: пока
# сокет не пересоздан, по сети никого нет, и показывать адрес нельзя.
_bound_host = "127.0.0.1"
_rebind_to = None


def bound_host():
    return _bound_host


def listening_on_network():
    """Слушаем ли мы прямо сейчас кого-то кроме самого компьютера."""
    return _bound_host not in ("127.0.0.1", "::1", "localhost")


def host_for_sharing():
    """0.0.0.0 — слушать и локальную сеть; иначе только сам компьютер."""
    return "0.0.0.0" if access.sharing_enabled() else "127.0.0.1"


def stop_server():
    """Завершает работу по кнопке из интерфейса — из отдельного потока,
    иначе сервер заблокирует сам себя, ожидая окончания текущего запроса."""
    if _httpd is not None:
        threading.Thread(target=_httpd.shutdown, daemon=True).start()


def rebind(host):
    """Просит главный цикл поднять сокет на другом адресе. Раньше для этого
    требовалось закрыть и открыть приложение, и это была ловушка: повторный
    клик по ярлыку видит работающую программу и просто открывает вкладку,
    ничего не перезапуская, — а приложение уже показывало сетевой адрес."""
    global _rebind_to
    if host == _bound_host:
        return False
    _rebind_to = host
    if _httpd is not None:
        threading.Thread(target=_httpd.shutdown, daemon=True).start()
    return True


def take_rebind():
    """Забирает заявку на смену адреса: её выполняет главный цикл после того,
    как serve_forever() вернул управление."""
    global _rebind_to
    host, _rebind_to = _rebind_to, None
    return host


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

    # --- кто пришёл --------------------------------------------------------

    def _client_ip(self):
        return (self.client_address or ("",))[0]

    def _resolve_role(self):
        return access.role_for_request(self._client_ip(), self.headers.get("Cookie"))

    def _same_origin(self):
        """Защита от запросов, которые чужая страница шлёт от имени продавца.
        За компьютером с приложением роль выдаётся без кода, поэтому открытая
        в том же браузере вредная страница могла бы «продать» товар за него.
        Браузер всегда сообщает Origin в запросах на изменение — сверяем его
        с адресом, по которому нас открыли. Без Origin (curl, наши же скрипты)
        подделывать нечего: там нет ни куки, ни чужого браузера."""
        origin = self.headers.get("Origin")
        if not origin:
            return True
        host = self.headers.get("Host") or ""
        return urlparse(origin).netloc == host

    def _guard(self, method, route):
        """Возвращает текст отказа или None, если запрос можно выполнять."""
        if method != "GET" and not self._same_origin():
            return ("Запрос пришёл со стороннего сайта", 403)
        if route in OPEN_ROUTES:
            return None
        if self.role is None:
            if not access.sharing_enabled():
                return ("Доступ по сети выключен. Включить его может только тот, "
                        "кто сидит за компьютером с приложением.", 403)
            return ("Нужно войти по коду доступа", 401)
        if method != "GET" and self.role == access.ROLE_VIEWER:
            return ("Только просмотр: изменять данные с этого компьютера нельзя", 403)
        # Бэкап — вся база одним файлом, вместе с кодами доступа. Отдать его
        # наблюдателю значит подарить ему код продавца.
        if route == "backup" and self.role != access.ROLE_SELLER:
            return ("Бэкап скачивает только продавец", 403)
        # Настройки совместного доступа меняются лишь за самой машиной с базой:
        # так утёкший код не позволит ни переписать коды, ни закрыть доступ.
        if route.startswith("share") and not access.is_local(self._client_ip()):
            return ("Совместный доступ настраивается только на компьютере "
                    "с приложением", 403)
        return None

    def _dispatch(self, method):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        try:
            self.role = self._resolve_role()
            if path.startswith("/api/"):
                denied = self._guard(method, path[len("/api/"):].rstrip("/"))
                if denied:
                    return self._error(denied[0], denied[1])
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
            if route == "ping":
                return self._json({"app": APP_TOKEN})
            if route == "session":
                return self._json({
                    "role": self.role,
                    "local": access.is_local(self._client_ip()),
                    "sharing": access.sharing_enabled(),
                })
            if route == "bootstrap":
                return self._json(api.bootstrap(
                    role=self.role, local=access.is_local(self._client_ip())))
            if route == "products":
                return self._json(
                    {"products": api.list_products(include_archived=params.get("archived") == "1")}
                )
            if route == "movements":
                return self._json(api.list_movements(params))
            if route == "unpunched":
                return self._json(api.list_unpunched())
            if route == "wishes":
                return self._json({"wishes": api.list_wishes(params)})
            if route == "reports":
                return self._json(api.build_reports(params))
            if route == "export/wishes.csv":
                return self._send(
                    200,
                    "\ufeff" + api.export_wishes_csv(),
                    "text/csv; charset=utf-8",
                    {"Content-Disposition": 'attachment; filename="zhelaniya.csv"'},
                )
            if route == "backup":
                return self._send(
                    200,
                    db.backup_bytes(),
                    "application/octet-stream",
                    {"Content-Disposition": 'attachment; filename="merch-%s.db"'
                                            % db.today_iso()},
                )
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
            seller = (body.get("seller") or "").strip()
            if route == "products":
                product_id = api.save_product(body, seller=seller)
                return self._json({"id": product_id, "products": api.list_products()})
            match = re.fullmatch(r"products/(\d+)", route)
            if match:
                api.save_product(body, product_id=int(match.group(1)), seller=seller)
                return self._json({"products": api.list_products()})
            match = re.fullmatch(r"products/(\d+)/archive", route)
            if match:
                api.archive_product(
                    int(match.group(1)), bool(body.get("archived", True)), seller=seller
                )
                return self._json({"ok": True})
            if route == "move":
                return self._json(api.do_move(body))
            if route == "receipt":
                return self._json(api.do_receipt(body))
            if route == "set-qty":
                return self._json(api.do_set_qty(body))
            if route == "undo":
                return self._json(api.do_undo(body))
            if route == "movements/trash":
                return self._json(api.trash_movement(body))
            match = re.fullmatch(r"movements/(\d+)/restore", route)
            if match:
                api.restore_movement(int(match.group(1)))
                return self._json({"ok": True})
            match = re.fullmatch(r"movements/(\d+)/purge", route)
            if match:
                api.purge_movement(int(match.group(1)))
                return self._json({"ok": True})
            if route == "login":
                return self._login(body)
            if route == "logout":
                return self._send(
                    200, json.dumps({"ok": True}), "application/json; charset=utf-8",
                    {"Set-Cookie": access.cookie_header("")},
                )
            if route == "share":
                return self._json(api.save_share(body))
            if route == "share/code":
                return self._json(api.reset_share_code(body))
            if route == "share/check":
                return self._json(api.check_share())
            if route == "journal/clear":
                return self._json(api.clear_journal(body))
            if route == "trash/empty":
                return self._json({"removed": api.empty_trash()})
            if route == "marks":
                return self._json(api.save_marks(body))
            if route == "punched":
                return self._json(api.mark_punched(body))
            if route == "wishes":
                return self._json({"id": api.save_wish(body), "wishes": api.list_wishes(body)})
            match = re.fullmatch(r"wishes/(\d+)", route)
            if match:
                api.save_wish(body, wish_id=int(match.group(1)))
                return self._json({"ok": True})
            match = re.fullmatch(r"wishes/(\d+)/status", route)
            if match:
                api.set_wish_status(int(match.group(1)), (body.get("status") or "").strip())
                return self._json({"ok": True})
            if route == "demo":
                from . import demo

                added = demo.seed()
                if not added:
                    return self._error("В базе уже есть товары — пример не добавлен")
                return self._json({"added": added, "products": api.list_products()})
            if route == "shutdown":
                self._json({"ok": True})
                stop_server()
                return None
            if route == "sellers":
                return self._json({"id": api.add_seller(body.get("name")), "sellers": api.list_sellers(True)})
            match = re.fullmatch(r"sellers/(\d+)/active", route)
            if match:
                api.set_seller_active(int(match.group(1)), bool(body.get("active", True)))
                return self._json({"sellers": api.list_sellers(True)})
            if route == "settings":
                limits = {"low_souvenir": (0, 999), "dead_days": (1, 3650)}
                for key, (low, high) in limits.items():
                    if key not in body:
                        continue
                    try:
                        value = int(str(body[key]).strip())
                    except (TypeError, ValueError):
                        return self._error("Значение «%s» должно быть числом" % key)
                    db.set_setting(key, max(low, min(high, value)))
                return self._json({"ok": True})
            return self._error("Неизвестный запрос", 404)

        if method == "DELETE":
            match = re.fullmatch(r"products/(\d+)", route)
            if match:
                info = api.delete_product(int(match.group(1)), seller=params.get("seller", ""))
                return self._json(dict(info, products=api.list_products()))
            match = re.fullmatch(r"wishes/(\d+)", route)
            if match:
                api.delete_wish(int(match.group(1)))
                return self._json({"ok": True})
            return self._error("Неизвестный запрос", 404)

        return self._error("Метод не поддерживается", 405)

    # --- вход по коду ------------------------------------------------------

    def _login(self, body):
        addr = self._client_ip()
        if access.is_local(addr):
            return self._json({"role": access.ROLE_SELLER})
        if not access.sharing_enabled():
            return self._error("Доступ по сети выключен", 403)

        wait = access.attempt_block(addr)
        if wait:
            return self._error(
                "Слишком много попыток. Попробуйте через %d мин." % ((wait + 59) // 60), 429)

        role = access.role_for_code(body.get("code"))
        if role is None:
            access.note_failure(addr)
            return self._error("Код не подходит", 401)

        access.note_success(addr)
        token = access.make_token(role)
        return self._send(
            200,
            json.dumps({"role": role}, ensure_ascii=False),
            "application/json; charset=utf-8",
            {"Set-Cookie": access.cookie_header(token)},
        )

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


class Server(ThreadingHTTPServer):
    """Очередь входящих соединений по умолчанию всего 5: при быстрой череде
    запросов (несколько вкладок, частые клики) лишние соединения сбрасывались
    с ConnectionResetError."""

    request_queue_size = 128
    allow_reuse_address = True


def serve(host="127.0.0.1", port=8765):
    global _httpd, _bound_host
    db.connect()
    api.SHARE_PORT[0] = port
    db.purge_trash_daily()   # чистим корзину и при запуске, не только при открытии страницы
    _httpd = Server((host, port), Handler)
    _httpd.daemon_threads = True
    _bound_host = host
    return _httpd


def close():
    """Освобождает порт, чтобы его тут же можно было занять другим адресом."""
    global _httpd
    if _httpd is not None:
        _httpd.server_close()
        _httpd = None
