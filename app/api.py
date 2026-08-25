"""Бизнес-логика и JSON-эндпоинты приложения."""

import csv
import io
from datetime import date, datetime, timedelta

from . import db

SIZE_PRESETS = [
    {"id": "ru42_56", "label": "Российские 42–56", "sizes": ["42", "44", "46", "48", "50", "52", "54", "56"]},
    {"id": "ru40_60", "label": "Российские 40–60", "sizes": ["40", "42", "44", "46", "48", "50", "52", "54", "56", "58", "60"]},
    {"id": "letters", "label": "Буквенные XS–XXL", "sizes": ["XS", "S", "M", "L", "XL", "XXL"]},
    {"id": "one", "label": "Один размер", "sizes": ["ONE"]},
]

KIND_LABELS = {
    db.KIND_SALE: "Продажа",
    db.KIND_RETURN: "Возврат",
    db.KIND_RECEIPT: "Приёмка",
    db.KIND_CORRECTION: "Коррекция",
    db.KIND_WRITEOFF: "Списание",
}

DEFAULT_KINDS = ["Толстовка", "Футболка", "Худи", "Свитшот", "Шопер", "Кепка"]

LOW_STOCK_DEFAULT = 2
DEAD_DAYS_DEFAULT = 30


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


# --- Вспомогательное -------------------------------------------------------

def product_title(p):
    """«Толстовка фиолетовая · большая печать» — как товар называется на карточке."""
    parts = [p["kind"].strip()]
    if p.get("color"):
        parts.append(p["color"].strip())
    title = " ".join(x for x in parts if x)
    if p.get("print_name"):
        title += " · " + p["print_name"].strip()
    return title


def _size_order(sizes):
    return {s: i for i, s in enumerate(sizes)}


def _int(value, default=0):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def _day_bounds(params):
    """Возвращает (from_date, to_date) строками YYYY-MM-DD."""
    date_to = (params.get("to") or "").strip() or date.today().isoformat()
    date_from = (params.get("from") or "").strip()
    if not date_from:
        days = _int(params.get("days"), 30)
        days = max(1, min(days, 3650))
        date_from = (date.fromisoformat(date_to) - timedelta(days=days - 1)).isoformat()
    return date_from, date_to


def _ts_range(date_from, date_to):
    return date_from + " 00:00:00", date_to + " 23:59:59"


def low_stock_threshold():
    return _int(db.get_setting("low_stock", LOW_STOCK_DEFAULT), LOW_STOCK_DEFAULT)


# --- Товары ----------------------------------------------------------------

def list_products(include_archived=False):
    where = "" if include_archived else "WHERE archived = 0"
    products = db.query("SELECT * FROM products %s ORDER BY kind, color, print_name" % where)
    stock_rows = db.query("SELECT product_id, size, qty FROM stock")
    by_product = {}
    for row in stock_rows:
        by_product.setdefault(row["product_id"], {})[row["size"]] = row["qty"]

    last_sale = {
        r["product_id"]: r["ts"]
        for r in db.query(
            "SELECT product_id, MAX(ts) AS ts FROM movements "
            "WHERE kind = ? AND undone = 0 GROUP BY product_id",
            (db.KIND_SALE,),
        )
    }

    out = []
    for p in products:
        sizes = db.parse_sizes(p["sizes"])
        qty_map = by_product.get(p["id"], {})
        # Размеры, по которым остался товар, но их убрали из карточки — всё равно показываем.
        for extra in sorted(set(qty_map) - set(sizes)):
            sizes.append(extra)
        rows = [{"size": s, "qty": qty_map.get(s, 0)} for s in sizes]
        total = sum(r["qty"] for r in rows)
        out.append(
            {
                "id": p["id"],
                "kind": p["kind"],
                "color": p["color"],
                "print_name": p["print_name"],
                "price": p["price"],
                "note": p["note"],
                "archived": bool(p["archived"]),
                "created_at": p["created_at"],
                "title": product_title(p),
                "sizes": rows,
                "total": total,
                "last_sale": last_sale.get(p["id"]),
            }
        )
    return out


def save_product(payload, product_id=None):
    kind = (payload.get("kind") or "").strip()
    if not kind:
        raise ApiError("Укажите тип товара (например, «Толстовка»)")

    sizes = db.parse_sizes(payload.get("sizes"))
    if not sizes:
        raise ApiError("Укажите хотя бы один размер")

    fields = (
        kind,
        (payload.get("color") or "").strip(),
        (payload.get("print_name") or "").strip(),
        max(0, _int(payload.get("price"), 0)),
        ",".join(sizes),
        (payload.get("note") or "").strip(),
    )

    if product_id is None:
        cur = db.execute(
            "INSERT INTO products(kind, color, print_name, price, sizes, note, created_at) "
            "VALUES(?, ?, ?, ?, ?, ?, ?)",
            fields + (db.now_iso(),),
        )
        product_id = cur.lastrowid
    else:
        if not db.query_one("SELECT id FROM products WHERE id = ?", (product_id,)):
            raise ApiError("Товар не найден", 404)
        db.execute(
            "UPDATE products SET kind = ?, color = ?, print_name = ?, price = ?, "
            "sizes = ?, note = ? WHERE id = ?",
            fields + (product_id,),
        )

    db.sync_stock_rows(product_id, sizes)
    return product_id


def archive_product(product_id, archived):
    if not db.query_one("SELECT id FROM products WHERE id = ?", (product_id,)):
        raise ApiError("Товар не найден", 404)
    db.execute("UPDATE products SET archived = ? WHERE id = ?", (1 if archived else 0, product_id))


def delete_product(product_id):
    used = db.query_one(
        "SELECT COUNT(*) AS n FROM movements WHERE product_id = ?", (product_id,)
    )
    if used and used["n"]:
        raise ApiError(
            "По товару есть %d записей в журнале — его можно только убрать в архив" % used["n"]
        )
    db.execute("DELETE FROM stock WHERE product_id = ?", (product_id,))
    db.execute("DELETE FROM products WHERE id = ?", (product_id,))


# --- Продавцы --------------------------------------------------------------

def list_sellers(include_inactive=False):
    where = "" if include_inactive else "WHERE active = 1"
    return db.query("SELECT * FROM sellers %s ORDER BY active DESC, name" % where)


def add_seller(name):
    name = (name or "").strip()
    if not name:
        raise ApiError("Введите имя продавца")
    existing = db.query_one("SELECT id FROM sellers WHERE lower(name) = lower(?)", (name,))
    if existing:
        db.execute("UPDATE sellers SET active = 1 WHERE id = ?", (existing["id"],))
        return existing["id"]
    cur = db.execute(
        "INSERT INTO sellers(name, active, created_at) VALUES(?, 1, ?)", (name, db.now_iso())
    )
    return cur.lastrowid


def set_seller_active(seller_id, active):
    if not db.query_one("SELECT id FROM sellers WHERE id = ?", (seller_id,)):
        raise ApiError("Продавец не найден", 404)
    db.execute("UPDATE sellers SET active = ? WHERE id = ?", (1 if active else 0, seller_id))


# --- Операции --------------------------------------------------------------

def do_move(payload):
    product_id = _int(payload.get("product_id"), 0)
    size = (payload.get("size") or "").strip()
    delta = _int(payload.get("delta"), 0)
    kind = (payload.get("kind") or "").strip()
    seller = (payload.get("seller") or "").strip()
    note = (payload.get("note") or "").strip()

    if not size:
        raise ApiError("Не выбран размер")
    try:
        movement_id, new_qty = db.apply_movement(
            product_id, size, delta, kind, seller=seller, note=note
        )
    except db.StockError as exc:
        raise ApiError(str(exc))
    return {"movement_id": movement_id, "qty": new_qty}


def do_receipt(payload):
    """Приёмка партии: сразу несколько размеров одной модели."""
    product_id = _int(payload.get("product_id"), 0)
    seller = (payload.get("seller") or "").strip()
    note = (payload.get("note") or "").strip() or "Приёмка партии"
    items = payload.get("items") or {}
    if not isinstance(items, dict):
        raise ApiError("Неверный формат партии")

    applied = []
    for size, raw_qty in items.items():
        qty = _int(raw_qty, 0)
        if qty <= 0:
            continue
        try:
            movement_id, new_qty = db.apply_movement(
                product_id, str(size), qty, db.KIND_RECEIPT, seller=seller, note=note
            )
        except db.StockError as exc:
            raise ApiError(str(exc))
        applied.append({"size": str(size), "qty": new_qty, "added": qty, "movement_id": movement_id})

    if not applied:
        raise ApiError("Не указано ни одной штуки к приёмке")
    return {"applied": applied, "total": sum(a["added"] for a in applied)}


def do_set_qty(payload):
    """Инвентаризация: выставить точный остаток по размеру."""
    product_id = _int(payload.get("product_id"), 0)
    size = (payload.get("size") or "").strip()
    target = _int(payload.get("qty"), -1)
    if target < 0:
        raise ApiError("Остаток не может быть отрицательным")

    row = db.query_one(
        "SELECT qty FROM stock WHERE product_id = ? AND size = ?", (product_id, size)
    )
    current = row["qty"] if row else 0
    delta = target - current
    if delta == 0:
        return {"qty": current, "movement_id": None}

    note = (payload.get("note") or "").strip() or "Инвентаризация: было %d, стало %d" % (
        current,
        target,
    )
    try:
        movement_id, new_qty = db.apply_movement(
            product_id,
            size,
            delta,
            db.KIND_CORRECTION,
            seller=(payload.get("seller") or "").strip(),
            note=note,
        )
    except db.StockError as exc:
        raise ApiError(str(exc))
    return {"movement_id": movement_id, "qty": new_qty}


def do_undo(payload):
    movement_id = _int(payload.get("movement_id"), 0)
    try:
        qty = db.undo_movement(movement_id, seller=(payload.get("seller") or "").strip())
    except db.StockError as exc:
        raise ApiError(str(exc))
    return {"qty": qty}


# --- Журнал ----------------------------------------------------------------

def list_movements(params):
    where = ["1 = 1"]
    args = []

    if params.get("kind"):
        where.append("m.kind = ?")
        args.append(params["kind"])
    if params.get("product_id"):
        where.append("m.product_id = ?")
        args.append(_int(params["product_id"], 0))
    if params.get("seller"):
        where.append("m.seller = ?")
        args.append(params["seller"])
    if params.get("from"):
        where.append("m.ts >= ?")
        args.append(params["from"] + " 00:00:00")
    if params.get("to"):
        where.append("m.ts <= ?")
        args.append(params["to"] + " 23:59:59")
    if params.get("q"):
        where.append(
            "(p.kind LIKE ? OR p.color LIKE ? OR p.print_name LIKE ? OR m.note LIKE ? OR m.seller LIKE ?)"
        )
        needle = "%" + params["q"].strip() + "%"
        args.extend([needle] * 5)

    limit = max(1, min(_int(params.get("limit"), 100), 1000))
    offset = max(0, _int(params.get("offset"), 0))

    sql = (
        "SELECT m.*, p.kind AS product_kind, p.color, p.print_name FROM movements m "
        "JOIN products p ON p.id = m.product_id WHERE " + " AND ".join(where) +
        " ORDER BY m.ts DESC, m.id DESC LIMIT ? OFFSET ?"
    )
    rows = db.query(sql, tuple(args) + (limit, offset))
    total = db.query_one(
        "SELECT COUNT(*) AS n FROM movements m JOIN products p ON p.id = m.product_id WHERE "
        + " AND ".join(where),
        tuple(args),
    )["n"]

    for r in rows:
        r["title"] = product_title(
            {"kind": r["product_kind"], "color": r["color"], "print_name": r["print_name"]}
        )
        r["kind_label"] = KIND_LABELS.get(r["kind"], r["kind"])
        r["amount"] = -r["delta"] * r["price"] if r["kind"] in db.REVENUE_KINDS else 0
    return {"items": rows, "total": total, "limit": limit, "offset": offset}


# --- Отчёты ----------------------------------------------------------------

def build_reports(params):
    date_from, date_to = _day_bounds(params)
    ts_from, ts_to = _ts_range(date_from, date_to)
    days = max(1, (date.fromisoformat(date_to) - date.fromisoformat(date_from)).days + 1)
    dead_days = max(1, _int(params.get("dead_days"), DEAD_DAYS_DEFAULT))
    low = low_stock_threshold()
    kind_filter = (params.get("kind") or "").strip()

    products = {
        p["id"]: p
        for p in list_products(include_archived=True)
        if not kind_filter or p["kind"] == kind_filter
    }

    # Все движения за период одним запросом — фильтры дальше применяем в Python.
    raw = db.query(
        "SELECT product_id, size, kind, SUM(delta) AS delta, SUM(-delta * price) AS amount, "
        "COUNT(*) AS ops FROM movements WHERE undone = 0 AND ts BETWEEN ? AND ? "
        "GROUP BY product_id, size, kind",
        (ts_from, ts_to),
    )
    rows = [r for r in raw if r["product_id"] in products]

    sold = {}           # (product_id, size) -> шт продано за вычетом возвратов
    sold_amount = {}    # (product_id, size) -> выручка
    sale_ops = sale_amount = sale_qty = 0
    return_qty = return_amount = 0
    received_qty = 0

    for r in rows:
        key = (r["product_id"], r["size"])
        if r["kind"] in db.REVENUE_KINDS:
            sold[key] = sold.get(key, 0) - r["delta"]
            sold_amount[key] = sold_amount.get(key, 0) + r["amount"]
        if r["kind"] == db.KIND_SALE:
            sale_qty += -r["delta"]
            sale_amount += r["amount"]
            sale_ops += r["ops"]
        elif r["kind"] == db.KIND_RETURN:
            return_qty += r["delta"]
            return_amount += r["amount"]
        elif r["kind"] == db.KIND_RECEIPT:
            received_qty += r["delta"]

    stock_qty = sum(
        s["qty"] for p in products.values() if not p["archived"] for s in p["sizes"]
    )
    stock_amount = sum(
        s["qty"] * p["price"] for p in products.values() if not p["archived"] for s in p["sizes"]
    )

    summary = {
        "date_from": date_from,
        "date_to": date_to,
        "days": days,
        "sold_qty": sale_qty,
        "revenue": sale_amount + return_amount,
        "sales_ops": sale_ops,
        "returned_qty": return_qty,
        "received_qty": received_qty,
        "avg_price": round(sale_amount / sale_ops) if sale_ops else 0,
        "stock_qty": stock_qty,
        "stock_amount": stock_amount,
        "per_day": round(sale_qty / days, 2),
    }

    # Топ моделей.
    top = []
    for pid, product in products.items():
        qty = sum(v for (p_id, _), v in sold.items() if p_id == pid)
        amount = sum(v for (p_id, _), v in sold_amount.items() if p_id == pid)
        if qty <= 0 and amount == 0:
            continue
        top.append(
            {
                "product_id": pid,
                "title": product["title"],
                "kind": product["kind"],
                "sold": qty,
                "revenue": amount,
                "stock": product["total"],
                "per_day": round(qty / days, 2),
                "days_left": round(product["total"] / (qty / days), 1) if qty > 0 else None,
            }
        )
    top.sort(key=lambda r: (-r["sold"], -r["revenue"]))

    # Залежавшиеся: есть остаток, но продаж давно (или совсем) не было.
    today = date.today()
    dead = []
    for product in products.values():
        if product["archived"] or product["total"] <= 0:
            continue
        last = product["last_sale"]
        if last:
            idle = (today - datetime.fromisoformat(last).date()).days
        else:
            idle = (today - datetime.fromisoformat(product["created_at"]).date()).days
        if idle >= dead_days:
            dead.append(
                {
                    "product_id": product["id"],
                    "title": product["title"],
                    "stock": product["total"],
                    "frozen": product["total"] * product["price"],
                    "last_sale": last,
                    "idle_days": idle,
                }
            )
    dead.sort(key=lambda r: (-r["idle_days"], -r["stock"]))

    # Какие размеры вымываются первыми. Числовые и буквенные ряды считаем раздельно —
    # 46-й и M это разные шкалы, в одной таблице их сравнивать нельзя.
    scales = {}
    for (pid, size), qty in sold.items():
        scales.setdefault(_scale_of(size), {}).setdefault(size, {"sold": 0, "stock": 0})[
            "sold"
        ] += qty
    for product in products.values():
        if product["archived"]:
            continue
        for s in product["sizes"]:
            bucket = scales.setdefault(_scale_of(s["size"]), {})
            bucket.setdefault(s["size"], {"sold": 0, "stock": 0})["stock"] += s["qty"]

    sizes_report = []
    for scale in ("num", "letter", "other"):
        bucket = scales.get(scale)
        if not bucket:
            continue
        total_sold = sum(max(0, v["sold"]) for v in bucket.values())
        total_stock = sum(v["stock"] for v in bucket.values())
        items = []
        for size in sorted(bucket, key=_natural_size_key):
            v = bucket[size]
            s_sold, s_stock = max(0, v["sold"]), v["stock"]
            items.append(
                {
                    "size": size,
                    "sold": s_sold,
                    "stock": s_stock,
                    "sold_share": round(s_sold / total_sold * 100, 1) if total_sold else 0,
                    "stock_share": round(s_stock / total_stock * 100, 1) if total_stock else 0,
                    "days_left": round(s_stock / (s_sold / days), 1) if s_sold > 0 else None,
                }
            )
        sizes_report.append({"scale": scale, "label": SCALE_LABELS[scale], "items": items})

    # Что заказывать: размеры, которые продаются и вот-вот кончатся.
    restock = []
    for product in products.values():
        if product["archived"]:
            continue
        for s in product["sizes"]:
            qty = sold.get((product["id"], s["size"]), 0)
            if qty <= 0:
                continue
            rate = qty / days
            days_left = round(s["qty"] / rate, 1)
            if s["qty"] > low and days_left > 14:
                continue
            restock.append(
                {
                    "product_id": product["id"],
                    "title": product["title"],
                    "size": s["size"],
                    "stock": s["qty"],
                    "sold": qty,
                    "days_left": days_left,
                    "suggest": max(1, round(rate * 30) - s["qty"]),
                }
            )
    restock.sort(key=lambda r: (r["stock"], -r["sold"]))

    return {
        "summary": summary,
        "top": top[:50],
        "dead": dead[:50],
        "sizes": sizes_report,
        "restock": restock[:60],
        "dead_days": dead_days,
        "kind": kind_filter,
    }


LETTER_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"]
SCALE_LABELS = {"num": "Числовой ряд", "letter": "Буквенный ряд", "other": "Прочие размеры"}


def _scale_of(size):
    s = str(size).upper()
    if s.isdigit():
        return "num"
    if s in LETTER_SIZES:
        return "letter"
    return "other"


def _natural_size_key(size):
    """42 < 44 < ... и XS < S < M < L < XL < XXL."""
    s = str(size).upper()
    if s.isdigit():
        return (0, int(s), "")
    if s in LETTER_SIZES:
        return (1, LETTER_SIZES.index(s), "")
    return (2, 0, s)


# --- Экспорт ---------------------------------------------------------------

def export_stock_csv():
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["Тип", "Цвет", "Принт", "Размер", "Остаток", "Цена", "Сумма"])
    for product in list_products(include_archived=True):
        for s in product["sizes"]:
            writer.writerow(
                [
                    product["kind"],
                    product["color"],
                    product["print_name"],
                    s["size"],
                    s["qty"],
                    product["price"],
                    s["qty"] * product["price"],
                ]
            )
    return buf.getvalue()


def export_movements_csv(params):
    data = list_movements(dict(params, limit=1000000))
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["Дата", "Операция", "Товар", "Размер", "Штук", "Продавец", "Сумма", "Комментарий", "Отменено"])
    for row in data["items"]:
        writer.writerow(
            [
                row["ts"],
                row["kind_label"],
                row["title"],
                row["size"],
                row["delta"],
                row["seller"],
                row["amount"],
                row["note"],
                "да" if row["undone"] else "",
            ]
        )
    return buf.getvalue()


# --- Стартовые данные ------------------------------------------------------

def bootstrap():
    products = list_products()
    kinds = sorted({p["kind"] for p in products}) or []
    colors = sorted({p["color"] for p in products if p["color"]})
    prints = sorted({p["print_name"] for p in products if p["print_name"]})
    return {
        "products": products,
        "sellers": list_sellers(include_inactive=True),
        "facets": {
            "kinds": kinds,
            "colors": colors,
            "prints": prints,
            "kind_suggestions": sorted(set(kinds) | set(DEFAULT_KINDS)),
        },
        "size_presets": SIZE_PRESETS,
        "kind_labels": KIND_LABELS,
        "settings": {
            "low_stock": low_stock_threshold(),
            "dead_days": _int(db.get_setting("dead_days", DEAD_DAYS_DEFAULT), DEAD_DAYS_DEFAULT),
        },
        "archived_count": db.query_one("SELECT COUNT(*) AS n FROM products WHERE archived = 1")["n"],
    }
