import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
from contextlib import closing
from datetime import date
from decimal import Decimal, InvalidOperation
from http.cookies import SimpleCookie
from pathlib import Path
from time import time
from wsgiref.simple_server import make_server

ROOT = Path(__file__).resolve().parent
DEMO = os.getenv("SCENTORA_DEMO") == "1"
DB = os.getenv("SCENTORA_DB", str(ROOT / "scentora.sqlite"))
SESSION_SECONDS = 12 * 3600
PASSWORD_MIN = 5
SCHEMA_VERSION = 3
SCALE = 1_000_000
CENT = SCALE // 100
MAX_VALUE = 1_000_000_000 * SCALE
ASSETS = {"/": ("index.html", "text/html"), "/app.css": ("app.css", "text/css"),
          "/app.js": ("app.js", "text/javascript")}

SCHEMA = """
CREATE TABLE IF NOT EXISTS units (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, password TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','operator')), active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions (
 token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS articles (
 id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
 unit INTEGER NOT NULL REFERENCES units(id), cost INTEGER NOT NULL CHECK(cost >= 0),
 stock INTEGER NOT NULL CHECK(stock >= 0));
CREATE TABLE IF NOT EXISTS perfumes (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
 unit INTEGER NOT NULL REFERENCES units(id), price INTEGER NOT NULL CHECK(price >= 0),
 stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0));
CREATE TABLE IF NOT EXISTS recipes (
 perfume INTEGER NOT NULL REFERENCES perfumes(id), article INTEGER NOT NULL REFERENCES articles(id),
 amount INTEGER NOT NULL CHECK(amount > 0), PRIMARY KEY(perfume, article));
CREATE TABLE IF NOT EXISTS movements (
 id INTEGER PRIMARY KEY, perfume INTEGER NOT NULL REFERENCES perfumes(id),
 amount INTEGER NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 actor TEXT NOT NULL, recipe TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, attempts INTEGER NOT NULL, since INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS contacts (
 id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('customer','supplier')),
 name TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL,
 country TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS contact_movements (
 id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL REFERENCES contacts(id),
 occurred_on TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0));
CREATE INDEX IF NOT EXISTS contact_movements_contact
 ON contact_movements(contact_id, occurred_on DESC, id DESC);
"""

ACCOUNTING_DETAILS_SCHEMA = """
CREATE TABLE accounting_details (
 movement_id INTEGER PRIMARY KEY REFERENCES contact_movements(id),
 perfume_id INTEGER REFERENCES perfumes(id), article_id INTEGER REFERENCES articles(id),
 unit TEXT, unit_cost INTEGER, quantity INTEGER, notes TEXT NOT NULL,
 request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
 CHECK((article_id IS NULL AND unit IS NULL
        AND unit_cost IS NULL AND quantity IS NULL)
       OR (perfume_id IS NULL AND article_id IS NOT NULL AND unit IS NOT NULL
           AND unit_cost IS NOT NULL AND unit_cost > 0 AND quantity IS NOT NULL AND quantity > 0)));
"""


class Problem(Exception):
    def __init__(self, message, status="400 Bad Request"):
        super().__init__(message)
        self.status = status


def digest(password, salt=None):
    salt = salt or secrets.token_hex(16)
    value = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=32768, r=8, p=1, maxmem=64 << 20)
    return salt + ":" + value.hex()


def connect(path):
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def migrate_accounting(db):
    exists = db.execute("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='accounting_details'").fetchone()
    if exists:
        db.execute("ALTER TABLE accounting_details RENAME TO accounting_details_previous")
    db.execute(ACCOUNTING_DETAILS_SCHEMA)
    if exists:
        columns = "movement_id,perfume_id,article_id,unit,unit_cost,quantity,notes,request_key,request_hash"
        db.execute(f"INSERT INTO accounting_details ({columns}) SELECT {columns} FROM accounting_details_previous")
        db.execute("DROP TABLE accounting_details_previous")


def migrate_schema(db):
    version = db.execute("PRAGMA user_version").fetchone()[0]
    if version >= SCHEMA_VERSION:
        return
    if version < 1:
        migrate_accounting(db)
    if version < 2:
        db.execute("ALTER TABLE articles ADD COLUMN scentora_perfume_id INTEGER REFERENCES perfumes(id)")
    if version < 3:
        db.execute("ALTER TABLE articles ADD COLUMN supplier_id INTEGER REFERENCES contacts(id)")
    db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def initialize(path, demo=False):
    with closing(connect(path)) as db, db:
        db.executescript(SCHEMA)
        db.execute("BEGIN IMMEDIATE")
        migrate_schema(db)
        db.executemany("INSERT OR IGNORE INTO units(name) VALUES (?)", [("ml.",), ("pz.",), ("l.",)])
        if db.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            return
        if demo:
            db.execute("INSERT INTO users(name,password,role) VALUES ('Admin demo','','admin')")
            db.executemany("INSERT INTO articles(code,name,unit,cost,stock) VALUES (?,?,?,?,?)", [
                ("ESS-01", "Essenza ambrata", 1, 230000, 800*SCALE),
                ("FL-50", "Flacone vetro 50 ml", 2, 1800000, 24*SCALE),
                ("PK-50", "Confezione crema 50 ml", 2, 850000, 24*SCALE),
            ])
            db.execute("INSERT INTO perfumes(name,unit,price) VALUES ('Accordo Ambrato',2,29900000)")
            db.executemany("INSERT INTO recipes VALUES (1,?,?)", [(1, 50*SCALE), (2, SCALE), (3, SCALE)])
            return
        name = os.getenv("SCENTORA_ADMIN", "admin")
        password = os.getenv("SCENTORA_ADMIN_PASSWORD", "")
        if not PASSWORD_MIN <= len(password) <= 256:
            raise RuntimeError(f"Configurare SCENTORA_ADMIN_PASSWORD con {PASSWORD_MIN}–256 caratteri.")
        db.execute("INSERT INTO users(name,password,role) VALUES (?,?,'admin')", (name, digest(password)))


def field(data, key, limit=120):
    value = data.get(key)
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise Problem(f"Compila il campo «{key}» (massimo {limit} caratteri).")
    return value.strip()


def amount(value, positive=False):
    try:
        decimal = Decimal(str(value).replace(",", "."))
        if not decimal.is_finite() or decimal < 0 or decimal > Decimal(MAX_VALUE) / SCALE:
            raise ValueError()
        scaled = decimal * SCALE
        if scaled != scaled.to_integral_value() or (positive and not scaled):
            raise ValueError()
        return int(scaled)
    except (InvalidOperation, ValueError):
        raise Problem("Inserisci un numero valido con al massimo 6 cifre decimali.")


def integer(value):
    if type(value) is not int or not 0 < value < 2**53:
        raise Problem("Seleziona una voce valida.")
    return value


def rows(db, query, params=()):
    return [dict(row) for row in db.execute(query, params)]


def get_row(db, query, params):
    row = db.execute(query, params).fetchone()
    if row is None:
        raise Problem("La voce selezionata non è più disponibile.", "404 Not Found")
    return row


def check_unit(db, unit, value):
    name = get_row(db, "SELECT name FROM units WHERE id=?", (unit,))["name"]
    if name.casefold() == "pz." and value % SCALE:
        raise Problem("Per i pezzi inserisci una quantità intera.")


def replace_record(db, table, record_id, fields):
    if record_id is None:
        columns = ",".join(fields)
        placeholders = ",".join("?" for _ in fields)
        return db.execute(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
                          tuple(fields.values())).lastrowid
    record_id = integer(record_id)
    assignments = ",".join(f"{key}=?" for key in fields)
    updated = db.execute(f"UPDATE {table} SET {assignments} WHERE id=?",
                         (*fields.values(), record_id))
    if not updated.rowcount:
        raise Problem("La voce selezionata non è più disponibile.", "404 Not Found")
    return record_id


def login(db, data, ip):
    now = int(time())
    db.execute("DELETE FROM login_attempts WHERE since <= ?", (now - 900,))
    attempts = db.execute("SELECT attempts FROM login_attempts WHERE ip=?", (ip,)).fetchone()
    if attempts and attempts["attempts"] >= 10:
        return {"error": "Troppi tentativi. Riprova tra 15 minuti."}, "429 Too Many Requests", None
    username = field(data, "utente")
    password = data.get("password")
    if not isinstance(password, str) or len(password) > 256:
        raise Problem("Credenziali non valide.")
    user = db.execute("SELECT * FROM users WHERE name=? AND active=1", (username,)).fetchone()
    stored = user["password"] if user else "0"*32 + ":" + "0"*128
    if not hmac.compare_digest(digest(password, stored.split(":")[0]), stored) or not user:
        db.execute("""INSERT INTO login_attempts VALUES (?,1,?)
                      ON CONFLICT(ip) DO UPDATE SET attempts=attempts+1""", (ip, now))
        return {"error": "Utente o password non validi."}, "401 Unauthorized", None
    db.execute("DELETE FROM login_attempts WHERE ip=?", (ip,))
    db.execute("DELETE FROM sessions WHERE expires <= ?", (now,))
    token = secrets.token_hex(32)
    db.execute("INSERT INTO sessions VALUES (?,?,?)", (token, user["id"], now + SESSION_SECONDS))
    return {"ok": True}, "200 OK", token


def state(db, user):
    return {
        "user": dict(user),
        "demo": DEMO,
        "articles": rows(db, "SELECT * FROM articles ORDER BY name COLLATE NOCASE"),
        "units": rows(db, "SELECT * FROM units ORDER BY name COLLATE NOCASE"),
        "perfumes": rows(db, "SELECT * FROM perfumes ORDER BY name COLLATE NOCASE"),
        "recipes": rows(db, "SELECT * FROM recipes ORDER BY perfume,article"),
        "customers": rows(db, "SELECT * FROM contacts WHERE kind='customer' ORDER BY name COLLATE NOCASE,id"),
        "suppliers": rows(db, "SELECT * FROM contacts WHERE kind='supplier' ORDER BY name COLLATE NOCASE,id"),
        "accounting": rows(db, """SELECT m.id,m.occurred_on,m.description,m.amount,c.name AS contact,
                                  c.kind,d.perfume_id,d.unit,d.unit_cost,d.quantity,d.notes
                                  FROM accounting_details d JOIN contact_movements m ON m.id=d.movement_id
                                  JOIN contacts c ON c.id=m.contact_id ORDER BY m.occurred_on DESC,m.id DESC"""),
        "movements": rows(db, """SELECT m.id,p.name,m.amount,m.created,m.actor
                                 FROM movements m JOIN perfumes p ON p.id=m.perfume ORDER BY m.id DESC LIMIT 100"""),
        "users": rows(db, "SELECT id,name,role,active FROM users ORDER BY name COLLATE NOCASE")
        if user["role"] == "admin" else [],
    }


def save_article(db, data):
    unit = integer(data.get("unit"))
    stock = amount(data.get("stock") or 0)
    check_unit(db, unit, stock)
    if data.get("id") is not None:
        article_id = integer(data["id"])
        article = get_row(db, "SELECT unit,stock FROM articles WHERE id=?", (article_id,))
        if article["unit"] != unit and (article["stock"] or db.execute(
                "SELECT 1 FROM recipes WHERE article=?", (article_id,)).fetchone()):
            raise Problem("L’unità è già utilizzata. Crea un nuovo articolo per usare un’altra unità.")
        stock = article["stock"]
    fields = {
        "code": field(data, "codice", 40), "name": field(data, "descrizione"),
        "unit": unit, "cost": amount(data.get("cost") or 0), "stock": stock,
    }
    if "scentora_perfume_id" in data:
        perfume_id = data["scentora_perfume_id"]
        if perfume_id is not None:
            perfume_id = integer(perfume_id)
            get_row(db, "SELECT id FROM perfumes WHERE id=?", (perfume_id,))
        fields["scentora_perfume_id"] = perfume_id
    if "supplier_id" in data:
        supplier_id = data["supplier_id"]
        if supplier_id is not None:
            supplier_id = integer(supplier_id)
            get_row(db, "SELECT id FROM contacts WHERE id=? AND kind='supplier'", (supplier_id,))
        fields["supplier_id"] = supplier_id
    replace_record(db, "articles", data.get("id"), fields)


def adjust_stock(db, data):
    article_id = integer(data.get("id"))
    article = get_row(db, "SELECT * FROM articles WHERE id=?", (article_id,))
    quantity = amount(data.get("amount"), positive=True)
    if data.get("direction") not in {"in", "out"}:
        raise Problem("Seleziona carico o scarico.")
    check_unit(db, article["unit"], quantity)
    new_stock = article["stock"] + (quantity if data["direction"] == "in" else -quantity)
    if not 0 <= new_stock <= MAX_VALUE:
        raise Problem("La quantità supera la giacenza disponibile o il limite consentito.")
    db.execute("UPDATE articles SET stock=? WHERE id=?", (new_stock, article_id))


def save_perfume(db, data):
    unit = integer(data.get("unit"))
    get_row(db, "SELECT id FROM units WHERE id=?", (unit,))
    if data.get("id") is not None:
        perfume_id = integer(data["id"])
        old = get_row(db, "SELECT unit FROM perfumes WHERE id=?", (perfume_id,))
        if old["unit"] != unit and db.execute("SELECT 1 FROM movements WHERE perfume=?", (perfume_id,)).fetchone():
            raise Problem("L’unità di un profumo già prodotto non può essere modificata.")
    recipe = data.get("recipe")
    if not isinstance(recipe, list) or not 1 <= len(recipe) <= 100:
        raise Problem("Aggiungi almeno un articolo alla distinta base (massimo 100).")
    lines = {}
    for line in recipe:
        if not isinstance(line, dict):
            raise Problem("Controlla le righe della distinta base.")
        article_id = integer(line.get("article"))
        article = get_row(db, "SELECT unit FROM articles WHERE id=?", (article_id,))
        quantity = amount(line.get("amount"), positive=True)
        check_unit(db, article["unit"], quantity)
        if article_id in lines:
            raise Problem("Ogni articolo può comparire una sola volta nella distinta base.")
        lines[article_id] = quantity
    perfume_id = replace_record(db, "perfumes", data.get("id"), {
        "name": field(data, "profumo"), "unit": unit, "price": amount(data.get("price") or 0),
    })
    db.execute("DELETE FROM recipes WHERE perfume=?", (perfume_id,))
    db.executemany("INSERT INTO recipes VALUES (?,?,?)",
                   ((perfume_id, article, qty) for article, qty in lines.items()))


def produce(db, data, user):
    perfume_id = integer(data.get("id"))
    perfume = get_row(db, "SELECT * FROM perfumes WHERE id=?", (perfume_id,))
    quantity = amount(data.get("amount"), positive=True)
    check_unit(db, perfume["unit"], quantity)
    if perfume["stock"] + quantity > MAX_VALUE:
        raise Problem("La giacenza risultante supera il limite consentito.")
    recipe = rows(db, """SELECT a.id,a.name,a.code,a.stock,a.cost,u.name AS unit,r.amount
                         FROM recipes r JOIN articles a ON a.id=r.article
                         JOIN units u ON u.id=a.unit WHERE r.perfume=?""", (perfume_id,))
    if not recipe:
        raise Problem("Completa la distinta base prima di caricare il profumo.")
    for line in recipe:
        required, remainder = divmod(line["amount"] * quantity, SCALE)
        if remainder or (line["unit"].casefold() == "pz." and required % SCALE):
            raise Problem(f"Quantità incompatibile con l’unità o la precisione di {line['name']}.")
        if required > line["stock"]:
            raise Problem(f"Giacenza insufficiente per {line['name']} ({line['code']}).")
        line["required"] = required
    db.executemany("UPDATE articles SET stock=stock-? WHERE id=?",
                   ((line["required"], line["id"]) for line in recipe))
    db.execute("UPDATE perfumes SET stock=stock+? WHERE id=?", (quantity, perfume_id))
    db.execute("INSERT INTO movements(perfume,amount,actor,recipe) VALUES (?,?,?,?)",
               (perfume_id, quantity, user["name"], json.dumps(recipe)))


def save_contact(db, data):
    kind = data.get("kind")
    if kind not in ("customer", "supplier"):
        raise Problem("Seleziona un tipo di anagrafica valido.")
    contact_id = data.get("id")
    if contact_id is not None:
        get_row(db, "SELECT id FROM contacts WHERE id=? AND kind=?", (integer(contact_id), kind))
    fields = {"kind": kind, "name": field(data, "nome")}
    for key, label, limit in (("address", "indirizzo", 200), ("city", "città", 100),
                              ("phone", "telefono", 48), ("country", "nazione", 100)):
        value = data.get(label, "")
        if not isinstance(value, str) or len(value.strip()) > limit:
            raise Problem(f"Il campo «{label}» accetta al massimo {limit} caratteri.")
        fields[key] = value.strip()
    if kind == "customer":
        fields["country"] = ""
    replace_record(db, "contacts", contact_id, fields)


def record_accounting(db, data, kind):
    key = data.get("request_key")
    if not isinstance(key, str) or not re.fullmatch(r"[a-f0-9-]{36}", key):
        raise Problem("Riapri la maschera per registrare il movimento.")
    fingerprint = hashlib.sha256(json.dumps([kind, data], sort_keys=True).encode()).hexdigest()
    previous = db.execute("SELECT request_hash FROM accounting_details WHERE request_key=?", (key,)).fetchone()
    if previous:
        if previous["request_hash"] != fingerprint:
            raise Problem("Il movimento è già stato registrato. Chiudi e riapri la maschera per inserirne un altro.",
                          "409 Conflict")
        return
    try:
        day = date.fromisoformat(data.get("data", ""))
        if day.isoformat() != data["data"]:
            raise ValueError()
    except (TypeError, ValueError):
        raise Problem("Inserisci una data valida.")
    notes = data.get("note", "")
    if not isinstance(notes, str) or len(notes) > 1000:
        raise Problem("Le note possono contenere al massimo 1.000 caratteri.")
    contact_id = integer(data.get("contact"))
    get_row(db, "SELECT id FROM contacts WHERE id=? AND kind=?", (contact_id, kind))
    perfume_id = article_id = unit = unit_cost = quantity = None
    if kind == "customer":
        description = "Incasso generico"
        if data.get("perfume") is not None:
            perfume_id = integer(data["perfume"])
            perfume = get_row(db, "SELECT name FROM perfumes WHERE id=?", (perfume_id,))
            description = perfume["name"]
        total = amount(data.get("amount"), positive=True)
        if total % CENT:
            raise Problem("Inserisci un importo con al massimo due decimali.")
    else:
        article_id = integer(data.get("article"))
        article = get_row(db, """SELECT a.code,a.name,a.cost,a.unit,u.name AS unit_name FROM articles a
                                 JOIN units u ON u.id=a.unit WHERE a.id=?""", (article_id,))
        description = f"{article['code']} · {article['name']}"
        unit = article["unit_name"]
        unit_cost = article["cost"]
        if not unit_cost:
            raise Problem("Imposta un costo unitario positivo nella scheda dell’articolo di base.")
        if amount(data.get("unit_cost")) != unit_cost or integer(data.get("unit")) != article["unit"]:
            raise Problem("Costo o unità sono cambiati. Aggiorna la pagina e riprova.", "409 Conflict")
        quantity = amount(data.get("quantity"), positive=True)
        check_unit(db, article["unit"], quantity)
        total = ((unit_cost * quantity + SCALE * CENT // 2) // (SCALE * CENT)) * CENT
        if not 0 < total <= MAX_VALUE:
            raise Problem("Il totale dell’acquisto deve essere almeno 0,01 € e rientrare nel limite consentito.")
    movement = db.execute("INSERT INTO contact_movements(contact_id,occurred_on,description,amount) VALUES (?,?,?,?)",
                          (contact_id, day.isoformat(), description, total)).lastrowid
    db.execute("""INSERT INTO accounting_details(movement_id,perfume_id,article_id,unit,unit_cost,quantity,notes,
                  request_key,request_hash) VALUES (?,?,?,?,?,?,?,?,?)""",
               (movement, perfume_id, article_id, unit, unit_cost, quantity, notes.strip(), key, fingerprint))


def save_user(db, data, user):
    target = data.get("id")
    role = data.get("role")
    active = data.get("active")
    if role not in ("admin", "operator") or type(active) is not bool:
        raise Problem("Seleziona ruolo e stato validi.")
    if target == user["id"] and (role != "admin" or not active):
        raise Problem("Mantieni attivo il tuo account amministratore.")
    password = data.get("password", "")
    fields = {"name": field(data, "utente"), "role": role, "active": active}
    if password or target is None:
        if not isinstance(password, str) or not PASSWORD_MIN <= len(password) <= 256:
            raise Problem(f"La password deve contenere da {PASSWORD_MIN} a 256 caratteri.")
        fields["password"] = digest(password)
    user_id = replace_record(db, "users", target, fields)
    if target is not None and (password or not active):
        db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))


def cookie(name, value, age):
    secure = "; Secure" if os.getenv("RENDER") or os.getenv("SCENTORA_SECURE") == "1" else ""
    return ("Set-Cookie", f"{name}={value}; Path=/; Max-Age={age}; HttpOnly; SameSite=Strict{secure}")


def read_json(env):
    if env.get("CONTENT_TYPE", "").split(";")[0] != "application/json":
        raise Problem("Formato della richiesta non valido.")
    length = int(env.get("CONTENT_LENGTH") or 0)
    if not 0 < length <= 100_000:
        raise Problem("Richiesta vuota o troppo grande.")
    try:
        data = json.loads(env["wsgi.input"].read(length))
    except (ValueError, UnicodeError):
        raise Problem("Formato della richiesta non valido.")
    if not isinstance(data, dict):
        raise Problem("Formato della richiesta non valido.")
    return data


def api(env, path, method):
    cookies = SimpleCookie(env.get("HTTP_COOKIE", ""))
    session = cookies["scentora"].value if "scentora" in cookies else ""
    headers = []
    if DEMO:
        demo_id = cookies["scentora_demo"].value if "scentora_demo" in cookies else ""
        if not re.fullmatch(r"[a-f0-9]{32}", demo_id):
            demo_id = secrets.token_hex(16)
            headers.append(cookie("scentora_demo", demo_id, 86400))
        directory = Path("/tmp/scentora-demo")
        directory.mkdir(mode=0o700, exist_ok=True)
        demo_db = directory / (demo_id + ".sqlite")
        if not demo_db.exists():
            files = list(directory.glob("*.sqlite"))
            for old in files:
                try:
                    if old.stat().st_mtime < time() - 86400:
                        old.unlink()
                except FileNotFoundError:
                    pass
            if len(list(directory.glob("*.sqlite"))) >= 500:
                raise Problem("Demo al completo. Riprova più tardi.", "503 Service Unavailable")
            initialize(demo_db, demo=True)
        path_db = str(demo_db)
    else:
        path_db = DB
    with closing(connect(path_db)) as db, db:
        if DEMO and db.execute("PRAGMA user_version").fetchone()[0] < SCHEMA_VERSION:
            db.execute("BEGIN IMMEDIATE")
            migrate_schema(db)
            db.commit()
        if method == "POST":
            data = read_json(env)
            db.execute("BEGIN IMMEDIATE")
        if path == "/api/login" and method == "POST" and not DEMO:
            result, status, token = login(db, data, env.get("HTTP_X_RENDER_CLIENT_IP") or env.get("REMOTE_ADDR", ""))
            if token:
                headers.append(cookie("scentora", token, SESSION_SECONDS))
            return result, status, headers
        user = (db.execute("SELECT id,name,role FROM users WHERE id=1").fetchone() if DEMO else
                db.execute("""SELECT u.id,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id
                              WHERE s.token=? AND s.expires>? AND u.active=1""",
                           (session, int(time()))).fetchone())
        if not user:
            return {"error": "Accedi per continuare."}, "401 Unauthorized", headers
        if path == "/api/state" and method == "GET":
            db.execute("BEGIN")
            return state(db, user), "200 OK", headers
        ledger = re.fullmatch(r"/api/contacts/([1-9][0-9]{0,15})/ledger", path)
        if ledger and method == "GET":
            contact_id = integer(int(ledger[1]))
            db.execute("BEGIN")
            get_row(db, "SELECT id FROM contacts WHERE id=?", (contact_id,))
            movements = rows(db, """SELECT m.occurred_on,m.description,m.amount,d.notes FROM contact_movements m
                                   LEFT JOIN accounting_details d ON d.movement_id=m.id
                                   WHERE m.contact_id=? ORDER BY m.occurred_on DESC,m.id DESC""", (contact_id,))
            return {"movements": movements}, "200 OK", headers
        if method != "POST":
            raise Problem("Pagina non trovata.", "404 Not Found")
        action = path.removeprefix("/api/")
        if action == "logout":
            db.execute("DELETE FROM sessions WHERE token=?", (session,))
            headers.append(cookie("scentora", "", 0))
        elif action == "article":
            save_article(db, data)
        elif action == "stock":
            adjust_stock(db, data)
        elif action == "perfume":
            save_perfume(db, data)
        elif action == "produce":
            produce(db, data, user)
        elif action == "contact":
            save_contact(db, data)
        elif action in ("receipt", "purchase"):
            record_accounting(db, data, "customer" if action == "receipt" else "supplier")
        elif action == "unit":
            if user["role"] != "admin":
                raise Problem("Operazione riservata agli amministratori.", "403 Forbidden")
            replace_record(db, "units", None, {"name": field(data, "unità", 24)})
        elif action == "user":
            if user["role"] != "admin":
                raise Problem("Operazione riservata agli amministratori.", "403 Forbidden")
            save_user(db, data, user)
        else:
            raise Problem("Pagina non trovata.", "404 Not Found")
        return {"ok": True}, "200 OK", headers


def application(env, start_response):
    path = env["PATH_INFO"]
    method = env["REQUEST_METHOD"]
    headers = [
        ("X-Content-Type-Options", "nosniff"),
        ("Referrer-Policy", "same-origin"),
        ("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"),
        ("Cache-Control", "no-store"),
    ]
    status = "200 OK"
    mime = "application/json"
    try:
        if method == "GET" and path in ASSETS:
            filename, mime = ASSETS[path]
            body = (ROOT / "static" / filename).read_bytes()
        elif method == "GET" and path == "/health":
            if not DEMO:
                with closing(connect(DB)) as db:
                    db.execute("SELECT 1 FROM users LIMIT 1").fetchone()
            body = b'{"ok":true}'
        elif path.startswith("/api/"):
            if method == "POST" and env.get("HTTP_SEC_FETCH_SITE") == "cross-site":
                raise Problem("Richiesta non autorizzata.", "403 Forbidden")
            result, status, extra = api(env, path, method)
            headers.extend(extra)
            body = json.dumps(result, ensure_ascii=False).encode()
        else:
            raise Problem("Pagina non trovata.", "404 Not Found")
    except Problem as error:
        status, body = error.status, json.dumps({"error": str(error)}).encode()
    except sqlite3.IntegrityError:
        status = "409 Conflict"
        body = json.dumps({"error": "Il codice o il nome è già presente."}).encode()
    except Exception:
        logging.exception("Errore durante la richiesta")
        status = "500 Internal Server Error"
        body = json.dumps({"error": "Si è verificato un errore. Riprova."}).encode()
    start_response(status, headers + [("Content-Type", mime + "; charset=utf-8"),
                                     ("Content-Length", str(len(body)))])
    return [body]


def import_articles(path):
    payload = os.getenv("SCENTORA_ARTICLE_IMPORT")
    if not payload:
        return
    articles = json.loads(payload)
    if not isinstance(articles, list) or not articles:
        raise RuntimeError("Importazione articoli: elenco non valido.")
    batch = hashlib.sha256(payload.encode()).hexdigest()
    with closing(connect(path)) as db, db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("CREATE TABLE IF NOT EXISTS article_imports (batch TEXT PRIMARY KEY)")
        if db.execute("SELECT 1 FROM article_imports WHERE batch=?", (batch,)).fetchone():
            return
        inserted = 0
        for item in articles:
            code = field(item, "code", 40)
            name = field(item, "name")
            unit_name = field(item, "unit", 24)
            unit = get_row(db, "SELECT id FROM units WHERE name=?", (unit_name,))["id"]
            cost = amount(item["cost"] if item["cost"] is not None else 0)
            stock = amount(item["stock"] if item["stock"] is not None else 0)
            check_unit(db, unit, stock)
            inserted += db.execute(
                """INSERT INTO articles(code,name,unit,cost,stock) VALUES (?,?,?,?,?)
                   ON CONFLICT(code) DO NOTHING""", (code, name, unit, cost, stock)
            ).rowcount
        db.execute("INSERT INTO article_imports VALUES (?)", (batch,))
    print(f"Importazione articoli completata: {inserted} inseriti, "
          f"{len(articles)-inserted} già presenti.", flush=True)


def import_perfumes(path):
    payload = os.getenv("SCENTORA_PERFUME_IMPORT")
    if not payload:
        return
    data = json.loads(payload)
    names = data["names"]
    if not isinstance(names, list) or not names:
        raise RuntimeError("Importazione profumi: elenco non valido.")
    price = amount(data["price"], positive=True)
    unit_name = field(data, "unit", 24)
    batch = hashlib.sha256(payload.encode()).hexdigest()
    with closing(connect(path)) as db, db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("CREATE TABLE IF NOT EXISTS perfume_imports (batch TEXT PRIMARY KEY)")
        if db.execute("SELECT 1 FROM perfume_imports WHERE batch=?", (batch,)).fetchone():
            return
        unit = get_row(db, "SELECT id FROM units WHERE name=?", (unit_name,))["id"]
        inserted = 0
        for value in names:
            name = field({"nome": value}, "nome")
            inserted += db.execute(
                """INSERT INTO perfumes(name,unit,price) VALUES (?,?,?)
                   ON CONFLICT(name) DO NOTHING""", (name, unit, price)
            ).rowcount
        db.execute("INSERT INTO perfume_imports VALUES (?)", (batch,))
    print(f"Importazione profumi completata: {inserted} inseriti, "
          f"{len(names)-inserted} già presenti.", flush=True)


def apply_article_bulk_update(path):
    payload = os.getenv("SCENTORA_ARTICLE_BULK_UPDATE")
    if not payload:
        return
    data = json.loads(payload)
    batch = field(data, "batch")
    supplier = field(data, "fornitore")
    cost = amount(data.get("cost"))
    with closing(connect(path)) as db, db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("CREATE TABLE IF NOT EXISTS article_bulk_updates (batch TEXT PRIMARY KEY)")
        if db.execute("SELECT 1 FROM article_bulk_updates WHERE batch=?", (batch,)).fetchone():
            return
        contact = db.execute("""SELECT id FROM contacts WHERE kind='supplier' AND name=? COLLATE NOCASE
                                ORDER BY id LIMIT 1""", (supplier,)).fetchone()
        supplier_id = contact["id"] if contact else db.execute(
            "INSERT INTO contacts(kind,name,address,city,phone) VALUES ('supplier',?,'','','')",
            (supplier,)).lastrowid
        count = db.execute("UPDATE articles SET cost=?, supplier_id=?", (cost, supplier_id)).rowcount
        db.execute("INSERT INTO article_bulk_updates VALUES (?)", (batch,))
    print(f"Aggiornamento articoli {batch}: {count} articoli impostati.", flush=True)


if not DEMO:
    initialize(DB)
    import_articles(DB)
    import_perfumes(DB)
    apply_article_bulk_update(DB)

if __name__ == "__main__":
    with make_server("0.0.0.0", int(os.getenv("PORT", "8000")), application) as server:
        server.serve_forever()
