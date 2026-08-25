"""Пример данных: показать, как выглядит заполненное приложение."""

import random
from datetime import datetime, timedelta

from . import api, db

# category, kind, color, print, material, price, sizes, наименование в 1С, ссылка
PRODUCTS = [
    (db.CAT_CLOTHING, "Толстовка", "фиолетовая", "большая печать", "Футер трёхнитка", 4200,
     "42,44,46,48,50,52,54,56", "Толстовка НГУ фиолет. больш. принт", "https://store.nsu.ru/hoodie-purple"),
    (db.CAT_CLOTHING, "Толстовка", "чёрная", "малый герб", "Футер трёхнитка", 3900,
     "42,44,46,48,50,52,54,56", "", ""),
    (db.CAT_CLOTHING, "Футболка", "белая", "большая печать", "Хлопок 100%", 1500,
     "42,44,46,48,50,52,54,56", "Футболка НГУ белая больш. принт", "https://store.nsu.ru/tshirt-white"),
    (db.CAT_CLOTHING, "Футболка", "синяя", "надпись NSU", "Хлопок 100%", 1500,
     "42,44,46,48,50,52,54,56", "Футболка НГУ синяя NSU", ""),
    (db.CAT_CLOTHING, "Худи", "серая", "малый герб", "Футер двухнитка", 4500,
     "XXS,XS,S,M,L,XL,XXL,3XL", "", ""),
    (db.CAT_CLOTHING, "Футболка", "фуксия", "надпись NSU", "Хлопок 100%", 1600,
     "42,44,46,48,50,52", "Футболка НГУ фуксия NSU", ""),
    (db.CAT_CLOTHING, "Шопер", "молочный", "большая печать", "Хлопок 100%", 900,
     "OS", "Шопер НГУ молочный", "https://store.nsu.ru/shopper"),
    (db.CAT_SOUVENIR, "Термокружка", "морская волна", "герб НГУ", "", 1900, "",
     "Термокружка НГУ", ""),
    (db.CAT_SOUVENIR, "Кружка", "белая", "герб НГУ", "", 650, "",
     "Кружка НГУ белая герб", "https://store.nsu.ru/mug-white"),
    (db.CAT_SOUVENIR, "Ручка", "синяя", "логотип", "", 180, "", "Ручка НГУ синяя", ""),
    (db.CAT_SOUVENIR, "Значок", "", "герб НГУ", "", 250, "", "", ""),
]

SELLERS = ["Игорь", "Анна", "Максим"]

WISHES = [
    ("Толстовка фиолетовая, размер 58", "+7 913 000-11-22, Мария", "Игорь",
     "Обещали позвонить, когда придёт поставка", "open", 4),
    ("Худи серая XXL", "t.me/pavel_nsk", "Анна", "", "notified", 11),
    ("Кружка с гербом, 5 штук на подарки", "kate@example.com", "Максим",
     "Нужно к 20 числу", "open", 2),
]


def seed():
    """Заполняет пустую базу примером. Возвращает число заведённых моделей."""
    if db.query_one("SELECT COUNT(*) AS n FROM products")["n"]:
        return 0

    for name in SELLERS:
        api.add_seller(name)

    rng = random.Random(42)
    now = datetime.now()

    for category, kind, color, print_name, material, price, sizes, name_1c, link in PRODUCTS:
        product_id = api.save_product(
            {
                "category": category,
                "kind": kind,
                "color": color,
                "print_name": print_name,
                "material": material,
                "price": price,
                "sizes": sizes,
                "name_1c": name_1c,
                "link": link,
            },
            seller=SELLERS[0],
        )
        size_list = [db.ONE_SIZE] if category == db.CAT_SOUVENIR else db.parse_sizes(sizes)
        title = "%s %s" % (kind, color)

        # Поставка два месяца назад.
        received_at = (now - timedelta(days=60)).replace(microsecond=0).isoformat(sep=" ")
        for size in size_list:
            qty = rng.randint(12, 30) if category == db.CAT_SOUVENIR else rng.randint(3, 12)
            db.execute(
                "INSERT INTO stock(product_id, size, qty) VALUES(?, ?, ?) "
                "ON CONFLICT(product_id, size) DO UPDATE SET qty = excluded.qty",
                (product_id, size, qty),
            )
            db.execute(
                "INSERT INTO movements(ts, product_id, title, size, delta, kind, seller, price, note) "
                "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (received_at, product_id, title, size, qty, db.KIND_RECEIPT, SELLERS[0],
                 price, "Поставка"),
            )

        # Продажи за последние 60 дней: ходовые размеры уходят чаще.
        weights = {s: (3 if s in ("46", "48", "50", "M", "L") else 1) for s in size_list}
        for _ in range(rng.randint(20, 45)):
            size = rng.choices(size_list, weights=[weights[s] for s in size_list])[0]
            row = db.query_one(
                "SELECT qty FROM stock WHERE product_id = ? AND size = ?", (product_id, size)
            )
            if not row or row["qty"] <= 0:
                continue
            sold_at = now - timedelta(days=rng.randint(0, 59), hours=rng.randint(0, 10))
            db.execute(
                "UPDATE stock SET qty = qty - 1 WHERE product_id = ? AND size = ?",
                (product_id, size),
            )
            db.execute(
                "INSERT INTO movements(ts, product_id, title, size, delta, kind, seller, price, "
                "note, needs_punch) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    sold_at.replace(microsecond=0).isoformat(sep=" "), product_id, title, size,
                    -1, db.KIND_SALE, rng.choice(SELLERS), price, "",
                    0 if name_1c else 1,
                ),
            )

    # Пример стоп-продажи: один товар целиком и один размер у другого.
    db.execute(
        "UPDATE products SET blocked = 1, block_note = ? WHERE kind = ? AND color = ?",
        ("ждём переоценку после подорожания", "Значок", ""),
    )
    hoodie = db.query_one(
        "SELECT id FROM products WHERE kind = ? AND color = ?", ("Худи", "серая")
    )
    if hoodie:
        db.set_size_marks(hoodie["id"], "3XL", "", "", 1, "одна испачкана, ждём химчистку")

    for product, contact, seller, note, status, days_ago in WISHES:
        wish_id = api.save_wish(
            {
                "product": product,
                "contact": contact,
                "seller": seller,
                "note": note,
                "asked_on": (now - timedelta(days=days_ago)).date().isoformat(),
            }
        )
        if status != "open":
            api.set_wish_status(wish_id, status)

    return len(PRODUCTS)
