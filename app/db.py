"""Хранилище данных: SQLite без внешних зависимостей."""

import os
import re
import sqlite3
import threading
from datetime import datetime, timedelta

DB_PATH = os.environ.get(
    "MERCH_DB",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "merch.db"),
)

# Категории товара.
CAT_CLOTHING = "clothing"    # одежда: есть размерный ряд и материал
CAT_SOUVENIR = "souvenir"    # сувенирка: одна позиция без размеров

CATEGORIES = (CAT_CLOTHING, CAT_SOUVENIR)

# Размер-заглушка для сувенирки: в интерфейсе не показывается.
ONE_SIZE = "—"

# Операции, меняющие остаток.
KIND_SALE = "sale"            # продажа
KIND_RETURN = "return"        # возврат от покупателя
KIND_RECEIPT = "receipt"      # поставка
KIND_DEFECT = "defect"        # брак, списание
KIND_MISTAKE = "mistake"      # случайный клик, исправление ошибки
KIND_CORRECTION = "correction"  # инвентаризация и откаты
KIND_WRITEOFF = "writeoff"    # старое списание, осталось в базах прошлой версии

STOCK_KINDS = (
    KIND_SALE, KIND_RETURN, KIND_RECEIPT, KIND_DEFECT, KIND_MISTAKE,
    KIND_CORRECTION, KIND_WRITEOFF,
)

# События справочника — тоже строки журнала, но остаток не меняют.
KIND_PRODUCT_ADDED = "product_added"
KIND_PRODUCT_EDITED = "product_edited"
KIND_PRODUCT_ARCHIVED = "product_archived"
KIND_PRODUCT_RESTORED = "product_restored"
KIND_PRODUCT_DELETED = "product_deleted"

EVENT_KINDS = (
    KIND_PRODUCT_ADDED, KIND_PRODUCT_EDITED, KIND_PRODUCT_ARCHIVED,
    KIND_PRODUCT_RESTORED, KIND_PRODUCT_DELETED,
)

KINDS = STOCK_KINDS + EVENT_KINDS

# Движения, которые считаются выручкой.
REVENUE_KINDS = (KIND_SALE, KIND_RETURN)

# Через сколько дней корзина очищается сама.
TRASH_DAYS = 60

SCHEMA_TABLES = """
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
    category   TEXT NOT NULL DEFAULT 'clothing',
    kind       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '',
    print_name TEXT NOT NULL DEFAULT '',
    material   TEXT NOT NULL DEFAULT '',
    price      INTEGER NOT NULL DEFAULT 0,
    sizes      TEXT NOT NULL DEFAULT '',
    name_1c    TEXT NOT NULL DEFAULT '',
    link       TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

-- alt_1c — пересорт: этот размер продаётся в кассе под другим наименованием 1С.
CREATE TABLE IF NOT EXISTS stock (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    size       TEXT NOT NULL,
    qty        INTEGER NOT NULL DEFAULT 0,
    alt_1c     TEXT NOT NULL DEFAULT '',
    alt_note   TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (product_id, size)
);

-- Журнал действий: и движения товара, и события справочника.
-- title — снимок названия на момент операции, поэтому запись переживает
-- переименование и даже удаление товара.
CREATE TABLE IF NOT EXISTS movements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL,
    product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
    title       TEXT NOT NULL DEFAULT '',
    size        TEXT NOT NULL DEFAULT '',
    delta       INTEGER NOT NULL DEFAULT 0,
    kind        TEXT NOT NULL,
    seller      TEXT NOT NULL DEFAULT '',
    price       INTEGER NOT NULL DEFAULT 0,
    note        TEXT NOT NULL DEFAULT '',
    undone      INTEGER NOT NULL DEFAULT 0,
    needs_punch INTEGER NOT NULL DEFAULT 0,
    punched     INTEGER NOT NULL DEFAULT 0,
    sold_as     TEXT NOT NULL DEFAULT '',
    deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS wishes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    asked_on    TEXT NOT NULL,
    product     TEXT NOT NULL,
    contact     TEXT NOT NULL DEFAULT '',
    seller      TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'open',
    closed_at   TEXT,
    created_at  TEXT NOT NULL
);
"""

# Индексы создаются после миграции: на старой таблице колонок из них ещё нет.
SCHEMA_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_mov_ts ON movements(ts);
CREATE INDEX IF NOT EXISTS idx_mov_product ON movements(product_id);
CREATE INDEX IF NOT EXISTS idx_mov_kind ON movements(kind);
CREATE INDEX IF NOT EXISTS idx_mov_trash ON movements(deleted_at);
CREATE INDEX IF NOT EXISTS idx_mov_punch ON movements(needs_punch, punched);
"""

_lock = threading.RLock()
_conn = None


def now_iso():
    """Текущее локальное время в ISO-формате (секундная точность)."""
    return datetime.now().replace(microsecond=0).isoformat(sep=" ")


def today_iso():
    return datetime.now().date().isoformat()


# --- Подключение и миграция -----------------------------------------------

def _columns(conn, table):
    return {r["name"] for r in conn.execute("PRAGMA table_info(%s)" % table)}


NEW_COLUMNS = {
    "products": [
        ("category", "TEXT NOT NULL DEFAULT 'clothing'"),
        ("material", "TEXT NOT NULL DEFAULT ''"),
        ("name_1c", "TEXT NOT NULL DEFAULT ''"),
        ("link", "TEXT NOT NULL DEFAULT ''"),
    ],
    "stock": [
        ("alt_1c", "TEXT NOT NULL DEFAULT ''"),
        ("alt_note", "TEXT NOT NULL DEFAULT ''"),
    ],
    "movements": [
        ("sold_as", "TEXT NOT NULL DEFAULT ''"),
    ],
}


def _add_missing_columns(conn, table):
    have = _columns(conn, table)
    for name, ddl in NEW_COLUMNS.get(table, []):
        if name not in have:
            conn.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, name, ddl))


def _migrate(conn):
    """Доводит базу прошлой версии до текущей схемы, не теряя данных."""
    _add_missing_columns(conn, "products")
    if "deleted_at" in _columns(conn, "movements"):
        _add_missing_columns(conn, "stock")
        _add_missing_columns(conn, "movements")
        return

    # Журнал перестраиваем: товар в записи стал необязательным (чтобы история
    # переживала удаление товара) и добавился снимок названия.
    conn.execute("ALTER TABLE movements RENAME TO movements_old")
    conn.executescript(SCHEMA_TABLES)
    conn.execute(
        """
        INSERT INTO movements(id, ts, product_id, title, size, delta, kind,
                              seller, price, note, undone)
        SELECT m.id, m.ts, m.product_id,
               COALESCE(
                   TRIM(p.kind || ' ' || p.color) ||
                   CASE WHEN COALESCE(p.print_name, '') <> ''
                        THEN ' · ' || p.print_name ELSE '' END,
                   ''),
               m.size, m.delta, m.kind, m.seller, m.price, m.note, m.undone
        FROM movements_old m
        LEFT JOIN products p ON p.id = m.product_id
        """
    )
    conn.execute("DROP TABLE movements_old")
    _add_missing_columns(conn, "stock")


def connect():
    global _conn
    with _lock:
        if _conn is None:
            os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
            conn = sqlite3.connect(DB_PATH, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode = WAL")
            conn.executescript(SCHEMA_TABLES)
            _migrate(conn)          # до индексов и внешних ключей: миграция перестраивает таблицы
            conn.executescript(SCHEMA_INDEXES)
            conn.execute("PRAGMA foreign_keys = ON")
            conn.commit()
            _conn = conn
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


# --- Товар -----------------------------------------------------------------

def product_title(p):
    """«Толстовка фиолетовая · большая печать» — как товар подписан на карточке."""
    parts = [(p.get("kind") or "").strip(), (p.get("color") or "").strip()]
    title = " ".join(x for x in parts if x)
    print_name = (p.get("print_name") or "").strip()
    if print_name:
        title += " · " + print_name
    return title


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


def set_size_override(product_id, size, alt_1c, alt_note=""):
    """Пересорт: этот размер продаётся в кассе под другим наименованием 1С."""
    execute(
        "INSERT INTO stock(product_id, size, qty, alt_1c, alt_note) VALUES(?, ?, 0, ?, ?) "
        "ON CONFLICT(product_id, size) DO UPDATE SET alt_1c = excluded.alt_1c, "
        "alt_note = excluded.alt_note",
        (product_id, size, alt_1c.strip(), alt_note.strip()),
    )


# --- Журнал ----------------------------------------------------------------

class StockError(Exception):
    """Операция невозможна (например, ушли бы в минус)."""


def log_event(kind, product_id, title, seller="", note=""):
    """Запись справочника в журнал: заведение товара, правка, архив."""
    cur = execute(
        "INSERT INTO movements(ts, product_id, title, kind, seller, note) "
        "VALUES(?, ?, ?, ?, ?, ?)",
        (now_iso(), product_id, title, kind, seller, note),
    )
    return cur.lastrowid


def apply_movement(product_id, size, delta, kind, seller="", note="", allow_negative=False):
    """Меняет остаток и пишет строку в журнал. Возвращает (movement_id, new_qty)."""
    if kind not in STOCK_KINDS:
        raise StockError("Неизвестный тип операции: %s" % kind)
    if delta == 0:
        raise StockError("Нулевое изменение остатка")

    with _lock:
        conn = connect()
        product = conn.execute(
            "SELECT * FROM products WHERE id = ?", (product_id,)
        ).fetchone()
        if product is None:
            raise StockError("Товар не найден")

        row = conn.execute(
            "SELECT qty, alt_1c FROM stock WHERE product_id = ? AND size = ?", (product_id, size)
        ).fetchone()
        current = row["qty"] if row else 0
        new_qty = current + delta
        if new_qty < 0 and not allow_negative:
            raise StockError("На складе %d шт — списать %d нельзя" % (current, -delta))

        # Под каким наименованием товар уходит через кассу: пересорт по размеру
        # важнее общего наименования товара.
        alt_1c = ((row["alt_1c"] if row else "") or "").strip()
        sold_as = alt_1c or (product["name_1c"] or "").strip()

        # Продажу товара, которого нет в 1С, нельзя пробить в кассе сразу:
        # помечаем, чтобы не забыть сделать это позже.
        needs_punch = 1 if (kind == KIND_SALE and not sold_as) else 0

        conn.execute(
            "INSERT INTO stock(product_id, size, qty) VALUES(?, ?, ?) "
            "ON CONFLICT(product_id, size) DO UPDATE SET qty = excluded.qty",
            (product_id, size, new_qty),
        )
        cur = conn.execute(
            "INSERT INTO movements(ts, product_id, title, size, delta, kind, seller, price, "
            "note, needs_punch, sold_as) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                now_iso(), product_id, product_title(dict(product)), size, delta, kind,
                seller, product["price"], note, needs_punch,
                sold_as if kind == KIND_SALE else "",
            ),
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
        if mov["delta"] == 0:
            raise StockError("Эту запись нельзя откатить — она не меняла остаток")
        if mov["product_id"] is None:
            raise StockError("Товар удалён, откатывать нечего")

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
            "INSERT INTO movements(ts, product_id, title, size, delta, kind, seller, price, note) "
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                now_iso(), mov["product_id"], mov["title"], mov["size"], -mov["delta"],
                KIND_CORRECTION, seller, mov["price"], "Отмена операции №%d" % movement_id,
            ),
        )
        conn.commit()
        return new_qty


# --- Корзина ---------------------------------------------------------------

def purge_trash(days=TRASH_DAYS):
    """Удаляет из корзины всё, что пролежало дольше срока."""
    cutoff = (datetime.now() - timedelta(days=days)).replace(microsecond=0).isoformat(sep=" ")
    cur = execute(
        "DELETE FROM movements WHERE deleted_at IS NOT NULL AND deleted_at < ?", (cutoff,)
    )
    return cur.rowcount


def purge_trash_daily():
    """Чистку достаточно делать раз в сутки — вызывается при открытии приложения."""
    if get_setting("last_purge") == today_iso():
        return 0
    removed = purge_trash()
    set_setting("last_purge", today_iso())
    return removed
