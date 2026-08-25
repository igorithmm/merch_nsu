"""Пример данных: показать, как выглядит заполненное приложение."""

import random
from datetime import datetime, timedelta

from . import api, db

PRODUCTS = [
    ("Толстовка", "фиолетовая", "большая печать", 4200, "42,44,46,48,50,52,54,56"),
    ("Толстовка", "чёрная", "малый герб", 3900, "42,44,46,48,50,52,54,56"),
    ("Футболка", "белая", "большая печать", 1500, "42,44,46,48,50,52,54,56"),
    ("Футболка", "синяя", "надпись NSU", 1500, "42,44,46,48,50,52,54,56"),
    ("Худи", "серая", "малый герб", 4500, "XS,S,M,L,XL,XXL"),
    ("Свитшот", "бордовый", "большая печать", 3600, "42,44,46,48,50,52,54"),
]

SELLERS = ["Игорь", "Анна", "Максим"]


def seed():
    if db.query_one("SELECT COUNT(*) AS n FROM products")["n"]:
        print("  База уже не пустая — пример данных не добавлен.")
        return

    for name in SELLERS:
        api.add_seller(name)

    rng = random.Random(42)
    now = datetime.now()

    for kind, color, print_name, price, sizes in PRODUCTS:
        product_id = api.save_product(
            {
                "kind": kind,
                "color": color,
                "print_name": print_name,
                "price": price,
                "sizes": sizes,
            }
        )
        size_list = db.parse_sizes(sizes)

        # Приёмка партии два месяца назад.
        received_at = (now - timedelta(days=60)).replace(microsecond=0).isoformat(sep=" ")
        for size in size_list:
            qty = rng.randint(3, 12)
            db.execute(
                "INSERT INTO stock(product_id, size, qty) VALUES(?, ?, ?) "
                "ON CONFLICT(product_id, size) DO UPDATE SET qty = excluded.qty",
                (product_id, size, qty),
            )
            db.execute(
                "INSERT INTO movements(ts, product_id, size, delta, kind, seller, price, note) "
                "VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                (received_at, product_id, size, qty, db.KIND_RECEIPT, SELLERS[0], price,
                 "Приёмка партии"),
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
                "INSERT INTO movements(ts, product_id, size, delta, kind, seller, price, note) "
                "VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    sold_at.replace(microsecond=0).isoformat(sep=" "),
                    product_id,
                    size,
                    -1,
                    db.KIND_SALE,
                    rng.choice(SELLERS),
                    price,
                    "",
                ),
            )

    print("  Пример данных добавлен: %d моделей." % len(PRODUCTS))
