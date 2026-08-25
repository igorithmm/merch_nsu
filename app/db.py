"""Хранилище данных: SQLite без внешних зависимостей."""

import os
import re
import sqlite3
import threading
from datetime import datetime, timezone

DB_PATH = os.environ.get(
    "MERCH_DB",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "merch.db"),
)

# Типы движений товара.
KIND_SALE = "sale"            # продажа
KIND_RETURN = "return"        # возврат покупателем
KIND_RECEIPT = "receipt"      # приёмка партии
KIND_CORRECTION = "correction"  # исправление / инвентаризация
KIND_WRITEOFF = "writeoff"    # списание (брак, подарок)

KINDS = (KIND_SALE, KIND_RETURN, KIND_RECEIPT, KIND_CORRECTION, KIND_WRITEOFF)

# Движения, которые считаются выручкой.
REVENUE_KINDS = (KIND_SALE, KIND_RETURN)

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS sellers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '',
    print_name TEXT NOT NULL DEFAULT '',
    price      INTEGER NOT NULL DEFAULT 0,
    sizes      TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    size       TEXT NOT NULL,
    qty        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, size)
);

CREATE TABLE IF NOT EXISTS movements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    size       TEXT NOT NULL,
    delta      INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    seller     TEXT NOT NULL DEFAULT '',
    price      INTEGER NOT NULL DEFAULT 0,
    note       TEXT NOT NULL DEFAULT '',
    undone     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mov_ts ON movements(ts);
CREATE INDEX IF NOT EXISTS idx_mov_product ON movements(product_id);
CREATE INDEX IF NOT EXISTS idx_mov_kind ON movements(kind);
"""

_lock = threading.RLock()
_conn = None


def now_iso():
    """Текущее локальное время в ISO-формате (секундная точность)."""
    return datetime.now().replace(microsecond=0).isoformat(sep=" ")


def utc_now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect():
    global _conn
    with _lock:
        if _conn is None:
            os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
            _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA foreign_keys = ON")
            _conn.execute("PRAGMA journal_mode = WAL")
            _conn.executescript(SCHEMA)
            _conn.commit()
        return _conn


def query(sql, params=()):
    with _lock:
        return [dict(r) for r in connect().execute(sql, params).fetchall()]


def query_one(sql, params=()):
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql, params=()):
    with _lock:
        conn = connect()
        cur = conn.execute(sql, params)
        conn.commit()
        return cur


# --- Настройки -------------------------------------------------------------

def get_setting(key, default=None):
    row = query_one("SELECT value FROM settings WHERE key = ?", (key,))
    return row["value"] if row else default


def set_setting(key, value):
    execute(
        "INSERT INTO settings(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value)),
    )


# --- Размеры ---------------------------------------------------------------

def parse_sizes(raw):
    """Строку «42, 44,46» превращает в упорядоченный список без дублей."""
    if isinstance(raw, (list, tuple)):
        parts = [str(p) for p in raw]
    else:
        parts = re.split(r"[,;\n]+", str(raw or ""))
    out = []
    for part in parts:
        s = part.strip().upper()
        if s and s not in out:
            out.append(s)
    return out


def sync_stock_rows(product_id, sizes):
    """Заводит нулевые остатки для новых размеров, удаляет пустые лишние."""
    with _lock:
        conn = connect()
        existing = {
            r["size"]: r["qty"]
            for r in conn.execute("SELECT size, qty FROM stock WHERE product_id = ?", (product_id,))
        }
        for size in sizes:
            if size not in existing:
                conn.execute(
                    "INSERT INTO stock(product_id, size, qty) VALUES(?, ?, 0)", (product_id, size)
                )
        for size, qty in existing.items():
            # Размер убрали из карточки — стираем только если по нему нет остатка.
            if size not in sizes and qty == 0:
                conn.execute(
                    "DELETE FROM stock WHERE product_id = ? AND size = ?", (product_id, size)
                )
        conn.commit()


# --- Движение товара -------------------------------------------------------

class StockError(Exception):
    """Операция невозможна (например, ушли бы в минус)."""


def apply_movement(product_id, size, delta, kind, seller="", note="", allow_negative=False):
    """Меняет остаток и пишет строку в журнал. Возвращает (movement_id, new_qty)."""
    if kind not in KINDS:
        raise StockError("Неизвестный тип операции: %s" % kind)
    if delta == 0:
        raise StockError("Нулевое изменение остатка")

    with _lock:
        conn = connect()
        product = conn.execute(
            "SELECT id, price, archived FROM products WHERE id = ?", (product_id,)
        ).fetchone()
        if product is None:
            raise StockError("Товар не найден")

        row = conn.execute(
            "SELECT qty FROM stock WHERE product_id = ? AND size = ?", (product_id, size)
        ).fetchone()
        current = row["qty"] if row else 0
        new_qty = current + delta
        if new_qty < 0 and not allow_negative:
            raise StockError("На складе %d шт — списать %d нельзя" % (current, -delta))

        conn.execute(
            "INSERT INTO stock(product_id, size, qty) VALUES(?, ?, ?) "
            "ON CONFLICT(product_id, size) DO UPDATE SET qty = excluded.qty",
            (product_id, size, new_qty),
        )
        cur = conn.execute(
            "INSERT INTO movements(ts, product_id, size, delta, kind, seller, price, note) "
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
            (now_iso(), product_id, size, delta, kind, seller, product["price"], note),
        )
        conn.commit()
        return cur.lastrowid, new_qty


def undo_movement(movement_id, seller=""):
    """Откатывает операцию: возвращает остаток и помечает запись как отменённую."""
    with _lock:
        conn = connect()
        mov = conn.execute("SELECT * FROM movements WHERE id = ?", (movement_id,)).fetchone()
        if mov is None:
            raise StockError("Запись журнала не найдена")
        if mov["undone"]:
            raise StockError("Эта операция уже отменена")

        row = conn.execute(
            "SELECT qty FROM stock WHERE product_id = ? AND size = ?",
            (mov["product_id"], mov["size"]),
        ).fetchone()
        current = row["qty"] if row else 0
        new_qty = current - mov["delta"]
        if new_qty < 0:
            raise StockError("Откат увёл бы остаток в минус")

        conn.execute(
            "INSERT INTO stock(product_id, size, qty) VALUES(?, ?, ?) "
            "ON CONFLICT(product_id, size) DO UPDATE SET qty = excluded.qty",
            (mov["product_id"], mov["size"], new_qty),
        )
        conn.execute("UPDATE movements SET undone = 1 WHERE id = ?", (movement_id,))
        conn.execute(
            "INSERT INTO movements(ts, product_id, size, delta, kind, seller, price, note) "
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
            (
                now_iso(),
                mov["product_id"],
                mov["size"],
                -mov["delta"],
                KIND_CORRECTION,
                seller,
                mov["price"],
                "Отмена операции №%d" % movement_id,
            ),
        )
        conn.commit()
        return new_qty
