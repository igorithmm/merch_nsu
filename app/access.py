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


def note_failure(addr):
    with _lock:
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


def lan_addresses():
    """Все адреса машины в локальной сети — первым тот, что вероятнее нужен."""
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
