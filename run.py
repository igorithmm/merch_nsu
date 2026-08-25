#!/usr/bin/env python3
"""Запуск приложения «Мерч НГУ».

    python run.py            — поднять сервер и открыть браузер
    python run.py --port 9000
    python run.py --no-browser
    python run.py --demo     — залить пример данных (только в пустую базу)
"""

import argparse
import socket
import sys
import threading
import webbrowser

from app import db, server


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

    db.connect()
    if args.demo:
        from app import demo

        demo.seed()

    port = find_free_port(args.host, args.port)
    url = "http://%s:%d/" % (args.host, port)
    httpd = server.serve(args.host, port)

    print()
    print("  Мерч НГУ — учёт товара")
    print("  ----------------------")
    print("  Открыто:  %s" % url)
    print("  База:     %s" % db.DB_PATH)
    print("  Остановить: Ctrl+C")
    print()

    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Остановлено. Данные сохранены.")
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
