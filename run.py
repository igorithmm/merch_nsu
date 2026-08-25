#!/usr/bin/env python3
"""Запуск приложения «Мерч НГУ».

Обычно запускается двойным кликом по ярлыку «Запустить» рядом с этим файлом.
Из терминала тоже работает:

    python run.py            — поднять сервер и открыть браузер
    python run.py --port 9000
    python run.py --no-browser
    python run.py --demo     — залить пример данных (только в пустую базу)
"""

import argparse
import http.client
import json
import os
import socket
import sys
import threading
import webbrowser

# Метка, по которой ярлык узнаёт уже работающее приложение (дублирует app.server,
# чтобы проверка не требовала импорта пакета — тот может и не загрузиться).
APP_TOKEN = "merch-nsu"

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(os.environ.get("MERCH_DB", "")) or os.path.join(HERE, "data")


def redirect_output_to_log():
    """Ярлык запускает программу без окна консоли — тогда sys.stdout is None,
    и любая печать или трассировка уронила бы приложение. Пишем в файл."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    os.makedirs(DATA_DIR, exist_ok=True)
    sys.stdout = sys.stderr = open(os.path.join(DATA_DIR, "app.log"), "a", encoding="utf-8")


def show_error(message):
    """Сообщение об ошибке видно, даже когда окна консоли нет."""
    print(message)
    if sys.platform == "win32":
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(0, message, "Мерч НГУ", 0x10)
        except Exception:
            pass


def already_running(host, port):
    """Приложение уже открыто на этом порту? Тогда второй раз запускать не нужно."""
    try:
        conn = http.client.HTTPConnection(host, port, timeout=1.5)
        conn.request("GET", "/api/ping")
        data = json.loads(conn.getresponse().read().decode("utf-8"))
        conn.close()
        return data.get("app") == APP_TOKEN
    except Exception:
        return False


def find_free_port(host, preferred):
    for port in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((host, port))
                return port
            except OSError:
                continue
    raise SystemExit("Не удалось найти свободный порт рядом с %d" % preferred)


def main():
    parser = argparse.ArgumentParser(description="Учёт мерча НГУ")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--demo", action="store_true", help="заполнить пример данных")
    args = parser.parse_args()

    redirect_output_to_log()

    # Импорт внутри main: если пакет не загрузится, ошибку покажет окно,
    # а не молчаливое исчезновение процесса при запуске без консоли.
    from app import db, server

    # Повторный клик по ярлыку не поднимает второе приложение — просто открывает вкладку.
    if already_running(args.host, args.port):
        url = "http://%s:%d/" % (args.host, args.port)
        print("Приложение уже работает, открываю %s" % url)
        if not args.no_browser:
            webbrowser.open(url)
        return 0

    db.connect()
    if args.demo:
        from app import demo

        added = demo.seed()
        print("  Пример данных добавлен: %d моделей." % added if added
              else "  База уже не пустая — пример данных не добавлен.")

    port = find_free_port(args.host, args.port)
    url = "http://%s:%d/" % (args.host, port)
    httpd = server.serve(args.host, port)

    print()
    print("  Мерч НГУ — учёт товара")
    print("  ----------------------")
    print("  Открыто:  %s" % url)
    print("  База:     %s" % db.DB_PATH)
    print("  Закрыть:  кнопка «Завершить работу» в настройках приложения")
    print()

    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    print("Остановлено. Данные сохранены.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 — иначе окно просто исчезнет без объяснений
        show_error("Не удалось запустить приложение:\n\n%s" % exc)
        sys.exit(1)
