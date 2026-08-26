"""Бизнес-логика и JSON-эндпоинты приложения."""

import csv
import io
import uuid
from datetime import date, datetime, timedelta

from . import db

SIZE_PRESETS = [
    {"id": "ru42_56", "label": "Российские 42–56",
     "sizes": ["42", "44", "46", "48", "50", "52", "54", "56"]},
    {"id": "letters", "label": "Буквенные XXS–3XL",
     "sizes": ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"]},
    {"id": "one_size", "label": "OS (один размер)", "sizes": ["OS"]},
]

KIND_LABELS = {
    db.KIND_SALE: "Продажа",
    db.KIND_RETURN: "Возврат",
    db.KIND_RECEIPT: "Поставка",
    db.KIND_DEFECT: "Брак",
    db.KIND_MISTAKE: "Случайный клик",
    db.KIND_CORRECTION: "Коррекция",
    db.KIND_WRITEOFF: "Списание",
    db.KIND_PRODUCT_ADDED: "Товар заведён",
    db.KIND_PRODUCT_EDITED: "Товар изменён",
    db.KIND_PRODUCT_ARCHIVED: "Товар в архив",
    db.KIND_PRODUCT_RESTORED: "Товар из архива",
    db.KIND_PRODUCT_DELETED: "Товар удалён",
}

# Причины прихода и расхода — из них собирается меню на кнопках + и −.
PLUS_REASONS = [
    {"kind": db.KIND_RECEIPT, "label": "Поставка", "hint": "пришла новая партия"},
    {"kind": db.KIND_RETURN, "label": "Возврат", "hint": "покупатель вернул товар"},
]
MINUS_REASONS = [
    {"kind": db.KIND_SALE, "label": "Продажа", "hint": "обычная продажа покупателю"},
    {"kind": db.KIND_DEFECT, "label": "Брак", "hint": "товар испорчен и списан"},
    {"kind": db.KIND_MISTAKE, "label": "Случайный клик", "hint": "лишняя единица, исправление"},
]

CATEGORY_LABELS = {db.CAT_CLOTHING: "Одежда", db.CAT_SOUVENIR: "Сувенирная продукция"}

KIND_SUGGESTIONS = {
    db.CAT_CLOTHING: ["Толстовка", "Футболка", "Худи", "Свитшот", "Шопер", "Кепка"],
    db.CAT_SOUVENIR: ["Кружка", "Ручка", "Значок", "Блокнот", "Магнит", "Наклейка", "Термокружка"],
}

MATERIAL_SUGGESTIONS = [
    "Хлопок 100%", "Хлопок 80% / полиэстер 20%", "Футер трёхнитка", "Футер двухнитка",
    "Кулирка", "Полиэстер 100%",
]

WISH_STATUSES = [
    {"id": "open", "label": "Ждёт"},
    {"id": "notified", "label": "Клиенту сообщили"},
    {"id": "closed", "label": "Закрыта"},
]
WISH_STATUS_LABELS = {s["id"]: s["label"] for s in WISH_STATUSES}

# Единственный порог остатка: жёлтая подсветка сувенирки. У одежды её нет —
# один-два экземпляра размера это норма.
LOW_SOUVENIR_DEFAULT = 3
DEAD_DAYS_DEFAULT = 30


# Метка запуска приложения. Меняется при каждом старте, поэтому браузер
# понимает, что смена началась заново, и просит выбрать продавца.
RUN_ID = uuid.uuid4().hex

# Через сколько часов выбранная смена считается протухшей, даже если
# приложение не закрывали (оставили включённым на ночь).
SHIFT_HOURS = 12


# Пределы на текстовые поля: длинная строка ломает вёрстку карточек и журнала,
# а пользы от неё нет.
MAX_PRICE = 10_000_000
LIMITS = {
    "kind": 100, "color": 60, "print_name": 100, "material": 100,
    "name_1c": 200, "link": 500, "note": 300, "block_note": 200,
    "alt_1c": 200, "alt_note": 200, "seller": 100, "product": 300,
    "contact": 200, "wish_note": 500,
}


def _text(value, field, limit=None):
    """Строка из запроса: обрезаем по длине и убираем управляющие символы."""
    raw = str(value if value is not None else "")
    raw = "".join(ch for ch in raw if ch == "\n" or ch >= " ")
    return raw.strip()[: (limit or LIMITS.get(field, 200))]


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


# --- Вспомогательное -------------------------------------------------------

def _int(value, default=0):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def _as_date(value, default):
    """Дата из запроса. Мусор не должен ронять отчёт с ошибкой 500."""
    try:
        return date.fromisoformat((value or "").strip())
    except (ValueError, TypeError):
        return default


def _day_bounds(params):
    today = date.today()
    date_to = _as_date(params.get("to"), today)
    if (params.get("from") or "").strip():
        date_from = _as_date(params.get("from"), today)
    else:
        days = max(1, min(_int(params.get("days"), 30), 3650))
        date_from = date_to - timedelta(days=days - 1)
    if date_from > date_to:
        date_from, date_to = date_to, date_from
    return date_from.isoformat(), date_to.isoformat()


def _ts_range(date_from, date_to):
    return date_from + " 00:00:00", date_to + " 23:59:59"


def thresholds():
    """Пороги остатка; жёлтая подсветка есть только у сувенирной продукции."""
    return {
        "low_souvenir": _int(
            db.get_setting("low_souvenir", LOW_SOUVENIR_DEFAULT), LOW_SOUVENIR_DEFAULT),
    }


def _category(value):
    value = (value or "").strip()
    return value if value in db.CATEGORIES else db.CAT_CLOTHING


# --- Товары ----------------------------------------------------------------

def list_products(include_archived=False):
    where = "" if include_archived else "WHERE archived = 0"
    products = db.query(
        "SELECT * FROM products %s ORDER BY category, kind, color, print_name" % where
    )
    stock_rows = db.query(
        "SELECT product_id, size, qty, alt_1c, alt_note, blocked_qty, block_note FROM stock"
    )
    by_product = {}
    for row in stock_rows:
        by_product.setdefault(row["product_id"], {})[row["size"]] = row

    last_sale = {
        r["product_id"]: r["ts"]
        for r in db.query(
            "SELECT product_id, MAX(ts) AS ts FROM movements "
            "WHERE kind = ? AND undone = 0 AND deleted_at IS NULL AND product_id IS NOT NULL "
            "GROUP BY product_id",
            (db.KIND_SALE,),
        )
    }
    unpunched = {
        r["product_id"]: r["n"]
        for r in db.query(
            "SELECT product_id, COUNT(*) AS n FROM movements "
            "WHERE kind = ? AND needs_punch = 1 AND punched = 0 AND undone = 0 "
            "AND deleted_at IS NULL AND product_id IS NOT NULL GROUP BY product_id",
            (db.KIND_SALE,),
        )
    }

    out = []
    for p in products:
        sizes = db.parse_sizes(p["sizes"])
        qty_map = by_product.get(p["id"], {})
        for extra in sorted(set(qty_map) - set(sizes)):
            sizes.append(extra)
        if p["category"] == db.CAT_SOUVENIR:
            sizes = sizes[:1] or [db.ONE_SIZE]
        rows = []
        for size in sizes:
            cell = qty_map.get(size) or {}
            rows.append(
                {
                    "size": size,
                    "qty": cell.get("qty", 0),
                    "alt_1c": cell.get("alt_1c", ""),
                    "alt_note": cell.get("alt_note", ""),
                    "blocked_qty": min(cell.get("blocked_qty", 0), cell.get("qty", 0)),
                    "block_note": cell.get("block_note", ""),
                }
            )
        out.append(
            {
                "id": p["id"],
                "category": p["category"],
                "kind": p["kind"],
                "color": p["color"],
                "print_name": p["print_name"],
                "material": p["material"],
                "price": p["price"],
                "name_1c": p["name_1c"],
                "link": p["link"],
                "note": p["note"],
                "blocked": bool(p["blocked"]),
                "block_note": p["block_note"],
                "archived": bool(p["archived"]),
                "created_at": p["created_at"],
                "title": db.product_title(p),
                "sizes": rows,
                "total": sum(r["qty"] for r in rows),
                "last_sale": last_sale.get(p["id"]),
                "needs_1c": not (p["name_1c"] or "").strip(),
                "unpunched": unpunched.get(p["id"], 0),
                "overrides": sum(1 for r in rows if r["alt_1c"]),
                "blocked_qty": sum(r["blocked_qty"] for r in rows),
                "available": 0 if p["blocked"] else sum(
                    max(0, r["qty"] - r["blocked_qty"]) for r in rows
                ),
            }
        )
    return out


def get_product(product_id):
    row = db.query_one("SELECT * FROM products WHERE id = ?", (product_id,))
    if row is None:
        raise ApiError("Товар не найден", 404)
    return row


def save_product(payload, product_id=None, seller=""):
    category = _category(payload.get("category"))
    kind = _text(payload.get("kind"), "kind")
    if not kind:
        raise ApiError("Укажите тип товара (например, «Толстовка» или «Кружка»)")

    if category == db.CAT_SOUVENIR:
        sizes = [db.ONE_SIZE]
        material = ""
    else:
        sizes = db.parse_sizes(payload.get("sizes"))
        if not sizes:
            raise ApiError("Укажите хотя бы один размер")
        material = _text(payload.get("material"), "material")

    link = _text(payload.get("link"), "link")
    if link and not link.startswith(("http://", "https://")):
        link = "https://" + link

    fields = (
        category,
        kind,
        _text(payload.get("color"), "color"),
        _text(payload.get("print_name"), "print_name"),
        material,
        min(MAX_PRICE, max(0, _int(payload.get("price"), 0))),
        ",".join(sizes),
        _text(payload.get("name_1c"), "name_1c"),
        link,
        _text(payload.get("note"), "note"),
        1 if payload.get("blocked") else 0,
        _text(payload.get("block_note"), "block_note"),
    )
    title = db.product_title(
        {"kind": fields[1], "color": fields[2], "print_name": fields[3]}
    )

    if product_id is None:
        cur = db.execute(
            "INSERT INTO products(category, kind, color, print_name, material, price, sizes, "
            "name_1c, link, note, blocked, block_note, created_at) "
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            fields + (db.now_iso(),),
        )
        product_id = cur.lastrowid
        db.log_event(
            db.KIND_PRODUCT_ADDED, product_id, title, seller,
            "%s, %s" % (CATEGORY_LABELS[category], _sizes_note(category, sizes)),
        )
    else:
        get_product(product_id)
        db.execute(
            "UPDATE products SET category = ?, kind = ?, color = ?, print_name = ?, "
            "material = ?, price = ?, sizes = ?, name_1c = ?, link = ?, note = ?, "
            "blocked = ?, block_note = ? WHERE id = ?",
            fields + (product_id,),
        )
        db.log_event(db.KIND_PRODUCT_EDITED, product_id, title, seller)

    db.sync_stock_rows(product_id, sizes)
    return product_id


def _sizes_note(category, sizes):
    if category == db.CAT_SOUVENIR:
        return "без размеров"
    return "размеры " + ", ".join(sizes)


def archive_product(product_id, archived, seller=""):
    product = get_product(product_id)
    db.execute("UPDATE products SET archived = ? WHERE id = ?", (1 if archived else 0, product_id))
    db.log_event(
        db.KIND_PRODUCT_ARCHIVED if archived else db.KIND_PRODUCT_RESTORED,
        product_id, db.product_title(product), seller,
    )


def delete_product(product_id, seller=""):
    """Удаляет товар. Записи журнала остаются: у них сохранён снимок названия,
    а ссылка на товар обнуляется внешним ключом ON DELETE SET NULL."""
    product = get_product(product_id)
    title = db.product_title(product)
    stats = db.query_one(
        "SELECT COUNT(*) AS ops, COALESCE(SUM(CASE WHEN delta <> 0 THEN 1 ELSE 0 END), 0) AS moves "
        "FROM movements WHERE product_id = ?", (product_id,)
    )
    left = db.query_one(
        "SELECT COALESCE(SUM(qty), 0) AS qty FROM stock WHERE product_id = ?", (product_id,)
    )["qty"]

    db.execute("DELETE FROM stock WHERE product_id = ?", (product_id,))
    db.execute("DELETE FROM products WHERE id = ?", (product_id,))

    parts = []
    if left:
        parts.append("остаток на момент удаления: %d шт" % left)
    if stats["moves"]:
        parts.append("операций в журнале сохранено: %d" % stats["moves"])
    db.log_event(db.KIND_PRODUCT_DELETED, None, title, seller, "; ".join(parts))
    return {"title": title, "movements": stats["moves"], "stock": left}


def save_marks(payload):
    """Отметки размеров: пересорт в 1С и запрет продажи."""
    product_id = _int(payload.get("product_id"), 0)
    product = get_product(product_id)
    items = payload.get("items") or {}
    if not isinstance(items, dict):
        raise ApiError("Неверный формат отметок")

    known = set(db.parse_sizes(product["sizes"])) | {
        r["size"] for r in db.query("SELECT size FROM stock WHERE product_id = ?", (product_id,))
    }
    stock = {
        r["size"]: r["qty"]
        for r in db.query("SELECT size, qty FROM stock WHERE product_id = ?", (product_id,))
    }
    with_alt, blocked = [], []
    for size, value in items.items():
        size = str(size)
        if size not in known:
            continue
        value = value if isinstance(value, dict) else {"name_1c": value}
        alt_1c = str(value.get("name_1c") or "")
        blocked_qty = max(0, _int(value.get("blocked_qty"), 0))
        if blocked_qty > stock.get(size, 0):
            raise ApiError(
                "Размер %s: снять с продажи %d шт нельзя, на складе всего %d"
                % (size, blocked_qty, stock.get(size, 0))
            )
        db.set_size_marks(
            product_id, size, _text(alt_1c, "alt_1c"), _text(value.get("note"), "alt_note"),
            blocked_qty, _text(value.get("block_note"), "block_note"),
        )
        if alt_1c.strip():
            with_alt.append(size)
        if blocked_qty:
            blocked.append("%s — %d шт" % (size, blocked_qty))

    parts = []
    parts.append("пересорт: " + ", ".join(with_alt) if with_alt else "пересорт снят")
    parts.append("снято с продажи: " + ", ".join(blocked) if blocked else "стоп-продаж нет")
    db.log_event(
        db.KIND_PRODUCT_EDITED, product_id, db.product_title(product),
        (payload.get("seller") or "").strip(), "Отметки размеров — " + "; ".join(parts),
    )
    return {"overrides": with_alt, "blocked": blocked}


# --- Продавцы --------------------------------------------------------------

def list_sellers(include_inactive=False):
    where = "" if include_inactive else "WHERE active = 1"
    return db.query("SELECT * FROM sellers %s ORDER BY active DESC, name" % where)


def add_seller(name):
    name = _text(name, "seller")
    if not name:
        raise ApiError("Введите имя продавца")
    existing = db.find_seller(name)
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

MOVE_KINDS = {r["kind"] for r in PLUS_REASONS} | {r["kind"] for r in MINUS_REASONS}


def do_move(payload):
    product_id = _int(payload.get("product_id"), 0)
    size = (payload.get("size") or "").strip()
    delta = _int(payload.get("delta"), 0)
    kind = (payload.get("kind") or "").strip()

    if not size:
        raise ApiError("Не выбран размер")
    if kind not in MOVE_KINDS:
        raise ApiError("Не выбрана причина операции")
    expected_sign = 1 if kind in {r["kind"] for r in PLUS_REASONS} else -1
    if delta == 0 or (delta > 0) != (expected_sign > 0):
        raise ApiError("Причина «%s» не совпадает с направлением операции" % KIND_LABELS[kind])

    try:
        movement_id, new_qty = db.apply_movement(
            product_id, size, delta, kind,
            seller=_text(payload.get("seller"), "seller"),
            note=_text(payload.get("note"), "note"),
        )
    except db.StockError as exc:
        raise ApiError(str(exc))

    mov = db.query_one("SELECT needs_punch FROM movements WHERE id = ?", (movement_id,))
    return {
        "movement_id": movement_id,
        "qty": new_qty,
        "needs_punch": bool(mov and mov["needs_punch"]),
    }


def do_receipt(payload):
    """Поставка: сразу несколько размеров одной модели."""
    product_id = _int(payload.get("product_id"), 0)
    seller = (payload.get("seller") or "").strip()
    note = _text(payload.get("note"), "note") or "Поставка"
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
        raise ApiError("Не указано ни одной штуки к поставке")
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
        current, target,
    )
    try:
        movement_id, new_qty = db.apply_movement(
            product_id, size, delta, db.KIND_CORRECTION,
            seller=(payload.get("seller") or "").strip(), note=note,
        )
    except db.StockError as exc:
        raise ApiError(str(exc))
    return {"movement_id": movement_id, "qty": new_qty}


def do_undo(payload):
    try:
        qty = db.undo_movement(
            _int(payload.get("movement_id"), 0), seller=(payload.get("seller") or "").strip()
        )
    except db.StockError as exc:
        raise ApiError(str(exc))
    return {"qty": qty}


# --- Журнал и корзина ------------------------------------------------------

def list_movements(params):
    trash = str(params.get("trash") or "") in ("1", "true")
    where = ["deleted_at IS NOT NULL" if trash else "deleted_at IS NULL"]
    args = []

    if params.get("kind"):
        where.append("kind = ?")
        args.append(params["kind"])
    if params.get("group") == "stock":
        where.append("delta <> 0")
    elif params.get("group") == "events":
        where.append("delta = 0")
    if params.get("product_id"):
        where.append("product_id = ?")
        args.append(_int(params["product_id"], 0))
    if params.get("category") in db.CATEGORIES:
        # У записи хранится ссылка на товар, а не категория, поэтому сверяемся
        # со справочником. Записи удалённых товаров (ссылка обнулена) в такую
        # выборку не попадают — категорию у них уже не спросить.
        where.append("product_id IN (SELECT id FROM products WHERE category = ?)")
        args.append(params["category"])
    if params.get("seller"):
        where.append("seller = ?")
        args.append(params["seller"])
    if params.get("from"):
        where.append("ts >= ?")
        args.append(params["from"] + " 00:00:00")
    if params.get("to"):
        where.append("ts <= ?")
        args.append(params["to"] + " 23:59:59")
    if params.get("q"):
        where.append("(title LIKE ? OR note LIKE ? OR seller LIKE ? OR size LIKE ?)")
        needle = "%" + params["q"].strip() + "%"
        args.extend([needle] * 4)

    limit = max(1, min(_int(params.get("limit"), 100), 1000))
    offset = max(0, _int(params.get("offset"), 0))
    clause = " AND ".join(where)

    rows = db.query(
        "SELECT * FROM movements WHERE %s ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?" % clause,
        tuple(args) + (limit, offset),
    )
    total = db.query_one(
        "SELECT COUNT(*) AS n FROM movements WHERE %s" % clause, tuple(args)
    )["n"]

    for r in rows:
        r["kind_label"] = KIND_LABELS.get(r["kind"], r["kind"])
        r["amount"] = -r["delta"] * r["price"] if r["kind"] in db.REVENUE_KINDS else 0
        r["is_event"] = r["delta"] == 0
        r["sold_as"] = r.get("sold_as") or ""
        r["unpunched"] = bool(r["needs_punch"] and not r["punched"] and not r["undone"])
    return {"items": rows, "total": total, "limit": limit, "offset": offset, "trash": trash}


def trash_movement(payload):
    """Убирает запись журнала в корзину. Живую запись — только вместе с откатом."""
    movement_id = _int(payload.get("movement_id"), 0)
    mov = db.query_one("SELECT * FROM movements WHERE id = ?", (movement_id,))
    if mov is None:
        raise ApiError("Запись не найдена", 404)
    if mov["deleted_at"]:
        raise ApiError("Запись уже в корзине")

    active = mov["delta"] != 0 and not mov["undone"]
    mode = (payload.get("mode") or "").strip()
    if active and mode not in ("undo", "keep"):
        raise ApiError(
            "Запись ещё учтена в остатках: %s %+d шт. Откатить её перед удалением?"
            % (mov["title"], mov["delta"])
        )
    if active and mode == "undo":
        try:
            db.undo_movement(movement_id, seller=(payload.get("seller") or "").strip())
        except db.StockError as exc:
            raise ApiError(str(exc))

    db.execute("UPDATE movements SET deleted_at = ? WHERE id = ?", (db.now_iso(), movement_id))
    return {"ok": True, "undone": active and mode == "undo"}


def restore_movement(movement_id):
    mov = db.query_one("SELECT id FROM movements WHERE id = ? AND deleted_at IS NOT NULL",
                       (movement_id,))
    if mov is None:
        raise ApiError("Запись не найдена в корзине", 404)
    db.execute("UPDATE movements SET deleted_at = NULL WHERE id = ?", (movement_id,))


def purge_movement(movement_id):
    mov = db.query_one("SELECT id FROM movements WHERE id = ? AND deleted_at IS NOT NULL",
                       (movement_id,))
    if mov is None:
        raise ApiError("Запись не найдена в корзине", 404)
    db.execute("DELETE FROM movements WHERE id = ?", (movement_id,))


def empty_trash():
    cur = db.execute("DELETE FROM movements WHERE deleted_at IS NOT NULL")
    return cur.rowcount


# --- Не пробитые в кассе ---------------------------------------------------

def list_unpunched():
    rows = db.query(
        "SELECT * FROM movements WHERE kind = ? AND needs_punch = 1 AND punched = 0 "
        "AND undone = 0 AND deleted_at IS NULL ORDER BY ts DESC",
        (db.KIND_SALE,),
    )
    by_product = {}
    by_seller = {}
    for r in rows:
        key = r["product_id"] if r["product_id"] is not None else "gone:" + r["title"]
        group = by_product.setdefault(
            key,
            {"product_id": r["product_id"], "title": r["title"], "count": 0,
             "amount": 0, "name_1c": "", "sellers": set()},
        )
        group["count"] += 1
        group["amount"] += r["price"]
        group["sellers"].add(r["seller"] or "без имени")
        by_seller[r["seller"] or "без имени"] = by_seller.get(r["seller"] or "без имени", 0) + 1

    products = {p["id"]: p for p in list_products(include_archived=True)}
    groups = []
    for group in by_product.values():
        product = products.get(group["product_id"])
        groups.append(
            {
                "product_id": group["product_id"],
                "title": group["title"],
                "count": group["count"],
                "amount": group["amount"],
                "name_1c": product["name_1c"] if product else "",
                "has_1c": bool(product and not product["needs_1c"]),
                "sellers": sorted(group["sellers"]),
            }
        )
    groups.sort(key=lambda g: -g["count"])
    return {
        "items": rows,
        "groups": groups,
        "by_seller": sorted(by_seller.items(), key=lambda kv: -kv[1]),
        "total": len(rows),
        "amount": sum(r["price"] for r in rows),
    }


def mark_punched(payload):
    """Отмечает продажи пробитыми: одну запись или все по товару."""
    movement_id = _int(payload.get("movement_id"), 0)
    product_id = _int(payload.get("product_id"), 0)
    if movement_id:
        row = db.query_one("SELECT id FROM movements WHERE id = ?", (movement_id,))
        if row is None:
            raise ApiError("Запись не найдена", 404)
        db.execute("UPDATE movements SET punched = 1 WHERE id = ?", (movement_id,))
        return {"marked": 1}
    if product_id:
        cur = db.execute(
            "UPDATE movements SET punched = 1 WHERE product_id = ? AND kind = ? "
            "AND needs_punch = 1 AND punched = 0 AND undone = 0 AND deleted_at IS NULL",
            (product_id, db.KIND_SALE),
        )
        return {"marked": cur.rowcount}
    raise ApiError("Не указано, что отмечать")


# --- Желания ---------------------------------------------------------------

def list_wishes(params=None):
    params = params or {}
    where = []
    args = []
    if params.get("status"):
        where.append("status = ?")
        args.append(params["status"])
    elif not str(params.get("all") or "") in ("1", "true"):
        where.append("status <> 'closed'")
    if params.get("q"):
        where.append("(product LIKE ? OR contact LIKE ? OR seller LIKE ? OR note LIKE ?)")
        args.extend(["%" + params["q"].strip() + "%"] * 4)

    clause = ("WHERE " + " AND ".join(where)) if where else ""
    rows = db.query(
        "SELECT * FROM wishes %s ORDER BY (status = 'closed'), asked_on DESC, id DESC" % clause,
        tuple(args),
    )
    for r in rows:
        r["status_label"] = WISH_STATUS_LABELS.get(r["status"], r["status"])
    return rows


def save_wish(payload, wish_id=None):
    product = _text(payload.get("product"), "product")
    if not product:
        raise ApiError("Напишите, какой товар спрашивали")
    fields = (
        _as_date(payload.get("asked_on"), date.today()).isoformat(),
        product,
        _text(payload.get("contact"), "contact"),
        _text(payload.get("seller"), "seller"),
        _text(payload.get("note"), "wish_note"),
    )
    if wish_id is None:
        cur = db.execute(
            "INSERT INTO wishes(asked_on, product, contact, seller, note, created_at) "
            "VALUES(?, ?, ?, ?, ?, ?)",
            fields + (db.now_iso(),),
        )
        return cur.lastrowid
    if not db.query_one("SELECT id FROM wishes WHERE id = ?", (wish_id,)):
        raise ApiError("Заявка не найдена", 404)
    db.execute(
        "UPDATE wishes SET asked_on = ?, product = ?, contact = ?, seller = ?, note = ? "
        "WHERE id = ?",
        fields + (wish_id,),
    )
    return wish_id


def set_wish_status(wish_id, status):
    if status not in WISH_STATUS_LABELS:
        raise ApiError("Неизвестный статус заявки")
    if not db.query_one("SELECT id FROM wishes WHERE id = ?", (wish_id,)):
        raise ApiError("Заявка не найдена", 404)
    db.execute(
        "UPDATE wishes SET status = ?, closed_at = ? WHERE id = ?",
        (status, db.now_iso() if status == "closed" else None, wish_id),
    )


def delete_wish(wish_id):
    if not db.query_one("SELECT id FROM wishes WHERE id = ?", (wish_id,)):
        raise ApiError("Заявка не найдена", 404)
    db.execute("DELETE FROM wishes WHERE id = ?", (wish_id,))


# --- Отчёты ----------------------------------------------------------------

def build_reports(params):
    date_from, date_to = _day_bounds(params)
    ts_from, ts_to = _ts_range(date_from, date_to)
    days = max(1, (date.fromisoformat(date_to) - date.fromisoformat(date_from)).days + 1)
    dead_days = max(1, _int(params.get("dead_days"), DEAD_DAYS_DEFAULT))
    low = thresholds()["low_souvenir"]
    kind_filter = (params.get("kind") or "").strip()
    category_filter = (params.get("category") or "").strip()

    products = {
        p["id"]: p
        for p in list_products(include_archived=True)
        if (not kind_filter or p["kind"] == kind_filter)
        and (not category_filter or p["category"] == category_filter)
    }

    raw = db.query(
        "SELECT product_id, size, kind, SUM(delta) AS delta, SUM(-delta * price) AS amount, "
        "COUNT(*) AS ops FROM movements WHERE undone = 0 AND deleted_at IS NULL "
        "AND delta <> 0 AND ts BETWEEN ? AND ? GROUP BY product_id, size, kind",
        (ts_from, ts_to),
    )
    rows = [r for r in raw if r["product_id"] in products]

    sold = {}
    sold_amount = {}
    sale_ops = sale_amount = sale_qty = 0
    return_qty = return_amount = 0
    received_qty = defect_qty = 0

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
        elif r["kind"] in (db.KIND_DEFECT, db.KIND_WRITEOFF):
            defect_qty += -r["delta"]

    live = [p for p in products.values() if not p["archived"]]
    summary = {
        "date_from": date_from,
        "date_to": date_to,
        "days": days,
        "sold_qty": sale_qty,
        "revenue": sale_amount + return_amount,
        "sales_ops": sale_ops,
        "returned_qty": return_qty,
        "received_qty": received_qty,
        "defect_qty": defect_qty,
        "avg_price": round(sale_amount / sale_ops) if sale_ops else 0,
        "stock_qty": sum(s["qty"] for p in live for s in p["sizes"]),
        "stock_amount": sum(s["qty"] * p["price"] for p in live for s in p["sizes"]),
        "per_day": round(sale_qty / days, 2),
    }

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

    today = date.today()
    dead = []
    for product in products.values():
        if product["archived"] or product["total"] <= 0:
            continue
        last = product["last_sale"]
        anchor = last or product["created_at"]
        idle = (today - datetime.fromisoformat(anchor).date()).days
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

    # Размеры считаем только по одежде и раздельно для числовых и буквенных рядов.
    scales = {}
    for (pid, size), qty in sold.items():
        if products[pid]["category"] != db.CAT_CLOTHING:
            continue
        scales.setdefault(_scale_of(size), {}).setdefault(size, {"sold": 0, "stock": 0})["sold"] += qty
    for product in products.values():
        if product["archived"] or product["category"] != db.CAT_CLOTHING:
            continue
        for s in product["sizes"]:
            bucket = scales.setdefault(_scale_of(s["size"]), {})
            bucket.setdefault(s["size"], {"sold": 0, "stock": 0})["stock"] += s["qty"]

    sizes_report = []
    for scale in ("num", "letter", "one", "other"):
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
                    "size": "" if product["category"] == db.CAT_SOUVENIR else s["size"],
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
        "category": category_filter,
    }


LETTER_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "XXXL", "4XL"]
ONE_SIZES = ["OS", "ONE", "ONESIZE"]
SCALE_LABELS = {
    "num": "Числовой ряд",
    "letter": "Буквенный ряд",
    "one": "Один размер",
    "other": "Прочие размеры",
}


def _scale_of(size):
    s = str(size).upper()
    if s.isdigit():
        return "num"
    if s in LETTER_SIZES:
        return "letter"
    if s in ONE_SIZES:
        return "one"
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

def _csv_cell(value):
    """Excel и LibreOffice выполняют содержимое ячейки, если оно начинается с
    =, +, - или @. Название товара «=1+1» превратилось бы в формулу, поэтому
    такие ячейки предваряем апострофом — он в таблице не показывается."""
    text = "" if value is None else str(value)
    if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text
    return text


def _csv_row(writer, values):
    writer.writerow([_csv_cell(v) for v in values])


def export_stock_csv():
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    _csv_row(writer, [
        "Категория", "Тип", "Цвет", "Принт", "Размер", "Остаток",
        "Цена", "Сумма", "Наименование в 1С", "Пересорт: продавать как",
        "Снято с продажи, шт",
    ])
    for product in list_products(include_archived=True):
        for s in product["sizes"]:
            _csv_row(writer, [
                CATEGORY_LABELS.get(product["category"], product["category"]),
                product["kind"], product["color"], product["print_name"],
                "" if product["category"] == db.CAT_SOUVENIR else s["size"],
                s["qty"], product["price"], s["qty"] * product["price"],
                product["name_1c"], s["alt_1c"],
                s["qty"] if product["blocked"] else (s["blocked_qty"] or ""),
            ])
    return buf.getvalue()


def export_movements_csv(params):
    data = list_movements(dict(params, limit=1000000))
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    _csv_row(writer, [
        "Дата", "Операция", "Товар", "Размер", "Штук", "Продавец", "Сумма",
        "Продано в 1С как", "Комментарий", "Не пробито", "Отменено",
    ])
    for row in data["items"]:
        _csv_row(writer, [
            row["ts"], row["kind_label"], row["title"], row["size"],
            row["delta"] or "", row["seller"], row["amount"], row["sold_as"], row["note"],
            "да" if row["unpunched"] else "", "да" if row["undone"] else "",
        ])
    return buf.getvalue()


def export_wishes_csv():
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    _csv_row(writer, ["Дата обращения", "Товар", "Контакты", "Продавец", "Статус", "Комментарий"])
    for w in list_wishes({"all": "1"}):
        _csv_row(writer, [
            w["asked_on"], w["product"], w["contact"], w["seller"],
            w["status_label"], w["note"],
        ])
    return buf.getvalue()


# --- Стартовые данные ------------------------------------------------------

def bootstrap():
    db.purge_trash_daily()
    products = list_products()
    kinds = sorted({p["kind"] for p in products})
    return {
        "run_id": RUN_ID,
        "shift_hours": SHIFT_HOURS,
        "products": products,
        "sellers": list_sellers(include_inactive=True),
        "facets": {
            "kinds": kinds,
            "colors": sorted({p["color"] for p in products if p["color"]}),
            "prints": sorted({p["print_name"] for p in products if p["print_name"]}),
            "sizes": sorted(
                {
                    s["size"] for p in products if p["category"] == db.CAT_CLOTHING
                    for s in p["sizes"]
                },
                key=_natural_size_key,
            ),
            "materials": sorted({p["material"] for p in products if p["material"]}),
            "kind_suggestions": {
                cat: sorted(set(names) | {p["kind"] for p in products if p["category"] == cat})
                for cat, names in KIND_SUGGESTIONS.items()
            },
            "material_suggestions": sorted(
                set(MATERIAL_SUGGESTIONS) | {p["material"] for p in products if p["material"]}
            ),
        },
        "size_presets": SIZE_PRESETS,
        "kind_labels": KIND_LABELS,
        "categories": CATEGORY_LABELS,
        "plus_reasons": PLUS_REASONS,
        "minus_reasons": MINUS_REASONS,
        "wish_statuses": WISH_STATUSES,
        "settings": dict(
            thresholds(),
            dead_days=_int(db.get_setting("dead_days", DEAD_DAYS_DEFAULT), DEAD_DAYS_DEFAULT),
            trash_days=db.TRASH_DAYS,
            db_size=db.db_size(),
        ),
        "counters": {
            "unpunched": db.query_one(
                "SELECT COUNT(*) AS n FROM movements WHERE kind = ? AND needs_punch = 1 "
                "AND punched = 0 AND undone = 0 AND deleted_at IS NULL", (db.KIND_SALE,)
            )["n"],
            "wishes": db.query_one(
                "SELECT COUNT(*) AS n FROM wishes WHERE status <> 'closed'"
            )["n"],
            "trash": db.query_one(
                "SELECT COUNT(*) AS n FROM movements WHERE deleted_at IS NOT NULL"
            )["n"],
            "archived": db.query_one(
                "SELECT COUNT(*) AS n FROM products WHERE archived = 1"
            )["n"],
            "overrides": db.query_one(
                "SELECT COUNT(*) AS n FROM stock WHERE alt_1c <> ''"
            )["n"],
            "blocked": db.query_one(
                "SELECT (SELECT COUNT(*) FROM products WHERE blocked = 1 AND archived = 0) + "
                "(SELECT COUNT(*) FROM stock s JOIN products p ON p.id = s.product_id "
                "WHERE s.blocked_qty > 0 AND p.blocked = 0 AND p.archived = 0) AS n"
            )["n"],
        },
    }
