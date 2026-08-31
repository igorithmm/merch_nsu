"""Совместный доступ по локальной сети: роли, коды входа и сессии.

Модель простая и намеренно узкая. Приложение по-прежнему живёт на одном
компьютере — том, что стоит в магазине; он же держит базу. Второй компьютер
(кабинет начальницы) ничего не устанавливает и не открывает файл базы по сети —
он просто заходит браузером на адрес первого. Базу нельзя класть на сетевую
папку или в облако: SQLite на таких дисках рвёт блокировки и портит файл.

Роли две:

* ``seller``  — всё как раньше: движения остатков, справочник, настройки;
* ``viewer``  — только чтение: остатки, журнал, отчёты и выгрузки в CSV.

Кто сидит за самим компьютером-сервером, тот всегда продавец и код не вводит:
физический доступ к машине и так даёт больше, чем любой пароль. Код спрашивают
только у тех, кто пришёл по сети, и роль определяется тем, какой из двух кодов
ввели, — по одному общему коду роли не различить, там просто нечему различаться.
"""

import base64
import hashlib
import hmac
import ipaddress
import secrets
import socket
import threading
import time

from . import db

ROLE_SELLER = "seller"
ROLE_VIEWER = "viewer"
ROLES = (ROLE_SELLER, ROLE_VIEWER)

ROLE_LABELS = {
    ROLE_SELLER: "Продавец",
    ROLE_VIEWER: "Только просмотр",
}

# Что роль умеет — для подсказок в интерфейсе.
ROLE_HINTS = {
    ROLE_SELLER: "полный доступ: продажи, поставки, справочник, настройки",
    ROLE_VIEWER: "остатки, журнал, отчёты и выгрузки — без права что-то менять",
}

SETTING_SHARING = "share_lan"
SETTING_SECRET = "share_secret"
SETTING_CODE = {ROLE_SELLER: "share_code_seller", ROLE_VIEWER: "share_code_viewer"}

SESSION_COOKIE = "merch_access"
SESSION_DAYS = 14

# Без похожих друг на друга символов: код диктуют голосом и переписывают от руки,
# так что 0/O и 1/I/l из алфавита выброшены.
CODE_ALPHABET = "ACEFHJKLMNPQRTUVWXY34679"
CODE_LENGTH = 8
CODE_MIN_LENGTH = 6
CODE_MAX_LENGTH = 64

# Подбор кода по сети: после порции неудач адрес отдыхает.
MAX_ATTEMPTS = 8
LOCKOUT_SECONDS = 300

_lock = threading.Lock()
_attempts = {}


# --- настройки совместного доступа -----------------------------------------

def sharing_enabled():
    return db.get_setting(SETTING_SHARING, "0") == "1"


def set_sharing(enabled):
    """Включая доступ по сети, сразу заводим коды: открытая сеть без кода —
    это приглашение для всего университета."""
    if enabled:
        ensure_codes()
    db.set_setting(SETTING_SHARING, "1" if enabled else "0")


def get_code(role):
    return db.get_setting(SETTING_CODE[role], "") or ""


def set_code(role, code):
    code = normalize_code(code)
    if len(code) < CODE_MIN_LENGTH:
        raise ValueError("Код должен быть не короче %d символов" % CODE_MIN_LENGTH)
    if len(code) > CODE_MAX_LENGTH:
        raise ValueError("Код слишком длинный")
    other = ROLE_VIEWER if role == ROLE_SELLER else ROLE_SELLER
    if get_code(other) and _same(code, normalize_code(get_code(other))):
        raise ValueError("Коды продавца и наблюдателя должны отличаться")
    db.set_setting(SETTING_CODE[role], code)
    return code


def generate_code():
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def ensure_codes():
    """Заводит недостающие коды. Возвращает роли, для которых код только что
    придумали, — их стоит показать продавцу сразу же."""
    created = []
    for role in ROLES:
        if not get_code(role):
            db.set_setting(SETTING_CODE[role], generate_code())
            created.append(role)
    return created


def normalize_code(code):
    """Код диктуют по телефону, поэтому регистр и пробелы не считаем."""
    return "".join(str(code or "").split()).upper()


def _same(left, right):
    """Сравнение за постоянное время. Через байты, а не строки: код могут
    ввести кириллицей, а compare_digest на строках требует чистого ASCII."""
    return hmac.compare_digest(
        str(left).encode("utf-8"), str(right).encode("utf-8"))


# --- проверка кода ---------------------------------------------------------

def role_for_code(code):
    """Роль, которой соответствует введённый код, или None."""
    code = normalize_code(code)
    if not code:
        return None
    for role in ROLES:
        stored = get_code(role)
        if stored and _same(code, normalize_code(stored)):
            return role
    return None


def attempt_block(addr):
    """Сколько секунд адресу ещё ждать. Ноль — можно пробовать."""
    with _lock:
        state = _attempts.get(addr)
        if not state:
            return 0
        left = int(state["until"] - time.time())
        return max(0, left)


MAX_TRACKED_ADDRESSES = 1024


def note_failure(addr):
    with _lock:
        if addr not in _attempts and len(_attempts) >= MAX_TRACKED_ADDRESSES:
            # Забываем самые старые записи: иначе поток запросов с подставных
            # адресов раздувает словарь без ограничений.
            now = time.time()
            for key in [k for k, v in _attempts.items() if v["until"] < now][:256]:
                _attempts.pop(key, None)
            if len(_attempts) >= MAX_TRACKED_ADDRESSES:
                _attempts.clear()
        state = _attempts.setdefault(addr, {"count": 0, "until": 0})
        state["count"] += 1
        if state["count"] >= MAX_ATTEMPTS:
            state["until"] = time.time() + LOCKOUT_SECONDS
            state["count"] = 0


def note_success(addr):
    with _lock:
        _attempts.pop(addr, None)


# --- сессии ----------------------------------------------------------------

def _secret():
    value = db.get_setting(SETTING_SECRET, "")
    if not value:
        value = secrets.token_hex(32)
        db.set_setting(SETTING_SECRET, value)
    return value.encode("ascii")


def make_token(role, days=SESSION_DAYS):
    """Подписанный маркер сессии. Хранить список выданных не нужно: подпись
    и срок внутри самого маркера, а смена кода отзывает все сразу."""
    expires = int(time.time()) + days * 86400
    raw = "%s.%d.%s" % (role, expires, _code_fingerprint())
    sig = hmac.new(_secret(), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    token = "%s.%s" % (raw, sig)
    return base64.urlsafe_b64encode(token.encode("utf-8")).decode("ascii").rstrip("=")


def read_token(token):
    """Роль из маркера или None, если он подделан, просрочен или коды сменили."""
    if not token:
        return None
    try:
        padded = token + "=" * (-len(token) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        role, expires, fingerprint, sig = decoded.rsplit(".", 3)
    except Exception:  # noqa: BLE001 — любой мусор в куке считаем отсутствием входа
        return None
    if role not in ROLES:
        return None
    raw = "%s.%s.%s" % (role, expires, fingerprint)
    expected = hmac.new(_secret(), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    if not _same(sig, expected):
        return None
    try:
        if int(expires) < time.time():
            return None
    except ValueError:
        return None
    # Коды сменили — старые входы больше не действуют.
    if not _same(fingerprint, _code_fingerprint()):
        return None
    return role


def _code_fingerprint():
    """Отпечаток текущей пары кодов: меняем код — все выданные входы отваливаются."""
    joined = "\x00".join(normalize_code(get_code(role)) for role in ROLES)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


def cookie_from_header(header):
    """Достаёт наш маркер из заголовка Cookie, не разбирая чужие куки."""
    for chunk in (header or "").split(";"):
        name, _, value = chunk.strip().partition("=")
        if name == SESSION_COOKIE:
            return value.strip('"')
    return ""


def cookie_header(token, days=SESSION_DAYS):
    """SameSite=Lax и HttpOnly: маркер не читается скриптами и не уезжает на
    чужие сайты. Secure не ставим — в локальной сети приложение работает по
    http, и с этим флагом браузер просто не сохранил бы куку."""
    if not token:
        return "%s=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" % SESSION_COOKIE
    return "%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax" % (
        SESSION_COOKIE, token, days * 86400)


# --- кто с какого адреса пришёл --------------------------------------------

def is_local(addr):
    """Запрос с самого компьютера-сервера. Такому коды не нужны: у того, кто
    сидит за машиной, и так есть файл базы целиком."""
    if not addr:
        return False
    try:
        ip = ipaddress.ip_address(addr.split("%", 1)[0])
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_loopback


def allowed_host(host_header, port):
    """Пускаем запрос только если браузер обратился по нашему собственному
    адресу.

    Без этой проверки работает подмена DNS: вредный сайт evil.example даёт
    браузеру посетителя адрес 127.0.0.1, браузер шлёт Host и Origin со своим
    именем — они совпадают между собой, и сверка Origin с Host пропускает
    запрос. Тогда чужая страница получает права продавца: читает остатки,
    меняет их и скачивает бэкап со всей базой. Поэтому имя в Host сверяем
    с тем, как машину действительно можно называть."""
    host = (host_header or "").strip()
    if not host:
        return True  # HTTP/1.0 без заголовка: браузеры так не ходят
    # Отрезаем порт, не путаясь в IPv6 вида [::1]:8765.
    if host.startswith("["):
        name, _, tail = host.partition("]")
        name = name[1:]
        port_part = tail[1:] if tail.startswith(":") else ""
    else:
        name, _, port_part = host.rpartition(":")
        if not name:
            name, port_part = host, ""
    if port_part and port_part != str(port):
        return False

    name = name.lower().rstrip(".")
    if name in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
        return True
    if name in {a.lower() for a in lan_addresses(cached=True)}:
        return True
    # Компьютер могут звать и по имени в сети — «http://SHOP-PC:8765/».
    try:
        own = socket.gethostname().lower()
    except OSError:
        return False
    return name in (own, own.split(".", 1)[0])


def role_for_request(addr, cookie_header_value):
    """Роль запроса: за самим компьютером — продавец, по сети — что в маркере."""
    if is_local(addr):
        return ROLE_SELLER
    if not sharing_enabled():
        return None
    return read_token(cookie_from_header(cookie_header_value))


# --- адрес, который диктуют коллеге ----------------------------------------

def lan_ip():
    """IP, по которому машину видно из локальной сети. Соединение UDP наружу
    ничего не отправляет — нужно только чтобы система выбрала сетевую карту."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("192.0.2.1", 9))  # адрес из TEST-NET-1, туда не ходят пакеты
            return sock.getsockname()[0]
        finally:
            sock.close()
    except OSError:
        return ""


def port_open(host, port, timeout=1.5):
    """Правда ли по этому адресу кто-то отвечает. Настоящее TCP-подключение —
    единственный честный ответ на «а работает ли», всё остальное гадание."""
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
        sock.close()
        return True
    except OSError:
        return False


_ADDR_TTL = 30
_addr_cache = {"at": 0.0, "value": []}


def lan_addresses(cached=False):
    """Все адреса машины в локальной сети — первым тот, что вероятнее нужен.

    С cached=True результат берётся из недолгого кэша: проверка заголовка Host
    идёт на каждом запросе, а перебирать сетевые интерфейсы так часто незачем."""
    if cached:
        now = time.time()
        if now - _addr_cache["at"] < _ADDR_TTL:
            return _addr_cache["value"]
        value = lan_addresses()
        _addr_cache.update(at=now, value=value)
        return value

    found = []
    primary = lan_ip()
    if primary:
        found.append(primary)
    try:
        _, _, addrs = socket.gethostbyname_ex(socket.gethostname())
    except OSError:
        addrs = []
    for addr in addrs:
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if ip.is_loopback or ip.is_link_local:
            continue
        if addr not in found:
            found.append(addr)
    return found
