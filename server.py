"""Shared administrative personnel app. Python standard library, SQLite, no tactical data."""
import argparse
import copy
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
import threading
import time
import webbrowser
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import urllib.request
import urllib.error
from updater import UpdateManager
from admin_extensions import CATEGORIES,EXTRA_TABLES,validate_extensions
from fullbackup import full_backup,restore_full

VERSION = '2.2.2'
KINDS = ('Робота', 'Відпустка', 'КЗВ', 'Лікарня', 'Лікарняний', 'ВЛК', 'Реабілітація')
ABSENCES = KINDS[1:]
DEFAULT_ROLES = ['Мех. Вод.', 'Ком. Гар.', 'Навідник', 'номер обслуги #1', 'номер обслуги #2']
STATIC = Path(getattr(sys, '_MEIPASS', Path(__file__).parent)) / 'web'
MAX_BODY = 2_000_000
ONLINE_API = 'https://personnel-workspace-api.kadrovyi-prostir.workers.dev'
ONLINE_SITE = 'https://personnel-workspace-api.kadrovyi-prostir.workers.dev/'


class Problem(Exception):
    def __init__(self, message, status=400):
        self.status = status
        super().__init__(message)


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def today():
    # Europe/Kyiv without relying on Windows tzdata being installed.
    from calendar import monthrange
    utc = datetime.now(timezone.utc)
    def transition(month):
        d = date(utc.year, month, monthrange(utc.year, month)[1])
        return datetime.combine(d-timedelta(days=(d.weekday()+1) % 7), datetime.min.time(), timezone.utc)+timedelta(hours=1)
    offset = 3 if transition(3) <= utc < transition(10) else 2
    return (utc+timedelta(hours=offset)).date().isoformat()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password, salt=None):
    if not isinstance(password, str) or not 12 <= len(password) <= 256:
        raise Problem('Пароль має містити від 12 до 256 символів.')
    salt = salt or secrets.token_hex(16)
    return salt+':'+hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 300_000).hex()


def password_ok(password, encoded):
    try:
        return hmac.compare_digest(password_hash(password, encoded.split(':')[0]), encoded)
    except (Problem, ValueError, AttributeError):
        return False


def empty_state():
    return {'people': [], 'events': [], 'groups': [], 'roles': DEFAULT_ROLES.copy(), 'title': 'Кадровий простір'}


def text(value, limit=500, required=False):
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise Problem('Перевірте обов’язкові поля та довжину тексту.')
    return value.strip()


def valid_day(value, optional=False):
    if optional and value == '':
        return ''
    try:
        if not isinstance(value, str) or len(value) != 10 or date.fromisoformat(value).isoformat() != value:
            raise ValueError()
    except (ValueError, TypeError):
        raise Problem('Дата має бути у форматі РРРР-ММ-ДД.')
    return value


def validate_state(raw):
    if not isinstance(raw, dict):
        raise Problem('Неправильний формат бази.')
    if any(not isinstance(raw.get(k), list) for k in ('people', 'events', 'groups', 'roles')):
        raise Problem('У файлі немає кадрових таблиць.')
    if len(raw['people']) > 3000 or len(raw['events']) > 12000:
        raise Problem('Перевищено ліміт: 3000 людей або 12000 кадрових подій.')
    result = {'people': [], 'events': [], 'groups': [], 'roles': [], 'title': text(raw.get('title', 'Кадровий простір'), 100, True)}
    for kind in ('groups', 'roles'):
        if len(raw[kind]) > 300:
            raise Problem('Забагато записів довідника.')
        for name in raw[kind]:
            name = text(name, 100, True)
            if name.casefold() in [n.casefold() for n in result[kind]]:
                raise Problem('Повторення назви в довіднику.')
            result[kind].append(name)
    ids, names, callsigns = set(), set(), set()
    for raw_person in raw['people']:
        if not isinstance(raw_person, dict):
            raise Problem('Некоректна картка людини.')
        p = {k: text(raw_person.get(k, ''), 2000 if k == 'notes' else 200, k in ('id', 'name')) for k in ('id', 'name', 'callsign', 'rank', 'role', 'unit', 'phone', 'group', 'notes')}
        p['service_since'] = valid_day(raw_person.get('service_since', ''), True)
        p['archived'] = raw_person.get('archived', False)
        if not isinstance(p['archived'], bool):
            raise Problem('Некоректна ознака архіву.')
        normalized = ' '.join(p['name'].split()).casefold()
        if p['id'] in ids or normalized in names:
            raise Problem('Повторення людини: '+p['name'])
        if p['callsign'] and p['callsign'].casefold() in callsigns:
            raise Problem('Позивний уже використовується: '+p['callsign'])
        if p['group'] and p['group'] not in result['groups']:
            raise Problem('Невідома група / екіпаж.')
        if p['role'] and p['role'] not in result['roles']:
            raise Problem('Спочатку додайте посаду в довідник.')
        ids.add(p['id']); names.add(normalized)
        if p['callsign']: callsigns.add(p['callsign'].casefold())
        result['people'].append(p)
    event_ids, per_person = set(), {}
    for raw_event in raw['events']:
        if not isinstance(raw_event, dict):
            raise Problem('Некоректний кадровий період.')
        e = {k: text(raw_event.get(k, ''), 2000 if k == 'notes' else 200, k in ('id', 'person_id', 'kind')) for k in ('id', 'person_id', 'kind', 'notes')}
        e['start'], e['end'] = valid_day(raw_event.get('start')), valid_day(raw_event.get('end'))
        e['returned_on'] = valid_day(raw_event.get('returned_on', ''), True)
        e['cancelled'] = raw_event.get('cancelled', False)
        if not isinstance(e['cancelled'], bool) or e['id'] in event_ids or e['person_id'] not in ids or e['kind'] not in KINDS:
            raise Problem('Перевірте людину та тип кадрової події.')
        if e['end'] < e['start']:
            raise Problem('Кінцева дата не може бути раніше початкової.')
        if e['returned_on'] and (e['kind'] not in ABSENCES or not e['start'] <= e['returned_on'] <= today()):
            raise Problem('Повернення можливе лише з кадрової відсутності, від її початку до сьогодні.')
        # Actual return is the first day AFTER absence. Planned end is retained.
        effective_end = min(e['end'], (date.fromisoformat(e['returned_on'])-timedelta(days=1)).isoformat()) if e['returned_on'] else e['end']
        if not e['cancelled'] and effective_end >= e['start']:
            for old_start, old_end in per_person.setdefault(e['person_id'], []):
                if old_start <= effective_end and e['start'] <= old_end:
                    raise Problem('Періоди людини перетинаються. Змініть дати або скасуйте попередній запис.')
            per_person[e['person_id']].append((e['start'], effective_end))
        event_ids.add(e['id'])
        result['events'].append(e)
    for index,person in enumerate(result['people']):
        category=raw['people'][index].get('category',CATEGORIES[0])
        if category not in CATEGORIES:raise Problem('Невідома категорія людини.')
        person['category']=category
    try:result.update(validate_extensions(raw,ids,text,valid_day))
    except (ValueError,TypeError,AttributeError) as exc:raise Problem(str(exc))
    return result


def changes(before, after):
    result = []
    for table in ('people', 'events')+EXTRA_TABLES:
        old, new = {v['id']: v for v in before.get(table,[])}, {v['id']: v for v in after.get(table,[])}
        for key in sorted(old.keys() | new.keys()):
            a, b = old.get(key), new.get(key)
            if a != b:
                result.append({'table': table, 'id': key, 'before': a, 'after': b})
    for key in ('groups', 'roles', 'title'):
        if before[key] != after[key]:
            result.append({'table': key, 'before': before[key], 'after': after[key]})
    return result


class Database:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS invitations(token TEXT PRIMARY KEY,role TEXT NOT NULL,expires REAL NOT NULL,used INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY,created TEXT NOT NULL,actor TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset REAL NOT NULL);
            ''')
            db.execute('INSERT OR IGNORE INTO workspace VALUES(1,0,?)', (json.dumps(empty_state(), ensure_ascii=False),))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA busy_timeout=15000')
        try:
            with db:
                yield db
        finally:
            db.close()

    def bootstrap(self, login, password):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT count(*) FROM users').fetchone()[0]:
                raise Problem('Адміністратор уже створений.', 409)
            db.execute('INSERT INTO users VALUES(?,?,?,?,1)', (secrets.token_hex(12), login.casefold().strip(), password_hash(password), 'owner'))

    def identity(self, token):
        with self.connect() as db:
            row = db.execute('SELECT u.id,u.login,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1', (digest(token), time.time())).fetchone()
        if not row:
            raise Problem('Увійдіть у систему.', 401)
        return dict(row)

    def rate_limit(self, key):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM attempts WHERE key=?', (key,)).fetchone()
            count = row['count']+1 if row and row['reset'] > time.time() else 1
            reset = row['reset'] if row and row['reset'] > time.time() else time.time()+900
            db.execute('INSERT OR REPLACE INTO attempts VALUES(?,?,?)', (key, count, reset))
            db.execute('DELETE FROM attempts WHERE reset<?', (time.time(),))
        if count > 15:
            raise Problem('Забагато спроб входу. Спробуйте через 15 хвилин.', 429)

    def login(self, login, password, ip):
        self.rate_limit('ip:'+ip)
        self.rate_limit('login:'+str(login).casefold())
        with self.connect() as db:
            user = db.execute('SELECT * FROM users WHERE login=? AND active=1', (str(login).casefold().strip(),)).fetchone()
            # Equal work for missing usernames.
            encoded = user['password'] if user else '00'*16+':'+'00'*32
            if not password_ok(password, encoded) or not user:
                raise Problem('Неправильний логін або пароль.', 401)
            token = secrets.token_urlsafe(40)
            db.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
            db.execute('INSERT INTO sessions VALUES(?,?,?)', (digest(token), user['id'], time.time()+8*3600))
        return {'token': token, 'user': {k: user[k] for k in ('id', 'login', 'role')}}

    def read(self):
        with self.connect() as db:
            row = db.execute('SELECT * FROM workspace WHERE id=1').fetchone()
        return {'revision': row['revision'], 'state': json.loads(row['data']), 'today': today(), 'version': VERSION}

    def commit(self, user, raw, revision, action='Оновлення', restore_id=None):
        if user['role'] == 'viewer':
            raise Problem('У вас доступ лише для перегляду.', 403)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM workspace WHERE id=1').fetchone()
            if type(revision) is not int or row['revision'] != revision:
                raise Problem('Базу вже змінив інший користувач. Оновіть дані й повторіть зміну.', 409)
            if restore_id:
                if user['role'] != 'owner': raise Problem('Відновлення доступне адміністратору.', 403)
                backup = db.execute('SELECT data FROM backups WHERE id=?', (restore_id,)).fetchone()
                if not backup: raise Problem('Резервну копію не знайдено.', 404)
                raw = json.loads(backup['data'])
            elif isinstance(raw,dict):
                raw=copy.deepcopy(raw)
                previous=json.loads(row['data'])
                previous_people={p['id']:p for p in previous['people']}
                for person in raw.get('people',[]):
                    if isinstance(person,dict) and 'category' not in person and person.get('id') in previous_people:
                        person['category']=previous_people[person['id']].get('category',CATEGORIES[0])
                for name in EXTRA_TABLES:
                    if name not in raw and name in previous:raw[name]=previous[name]
            data = validate_state(raw)
            diff = changes(json.loads(row['data']), data)
            if diff:
                db.execute('INSERT INTO backups VALUES(?,?,?,?,?)', (secrets.token_hex(12), now(), user['login'], revision, row['data']))
                db.execute('INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)', (now(), user['login'], text(action, 150, True), json.dumps(diff, ensure_ascii=False)))
                db.execute('UPDATE workspace SET revision=revision+1,data=? WHERE id=1', (json.dumps(data, ensure_ascii=False),))
                # Last 100 snapshots plus full audit. Export before long-term retention changes.
                db.execute('DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY rowid DESC LIMIT 100)')
        return self.read()

    def invite(self, user, role):
        if user['role'] != 'owner' or role not in ('viewer', 'editor'):
            raise Problem('Створення запрошень доступне адміністратору.', 403)
        token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute('INSERT INTO invitations VALUES(?,?,?,0)', (digest(token), role, time.time()+48*3600))
            db.execute('INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)', (now(), user['login'], 'Створено запрошення: '+role, '[]'))
        return {'invitation': token, 'hours': 48}

    def redeem(self, token, login, password, ip):
        self.rate_limit('invite:'+ip)
        login = text(login, 100, True).casefold()
        encoded = password_hash(password)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            invite = db.execute('SELECT * FROM invitations WHERE token=? AND used=0 AND expires>?', (digest(str(token)), time.time())).fetchone()
            if not invite: raise Problem('Запрошення недійсне, використане або прострочене.', 403)
            if db.execute('SELECT id FROM users WHERE login=?', (login,)).fetchone(): raise Problem('Цей логін уже існує.')
            db.execute('INSERT INTO users VALUES(?,?,?,?,1)', (secrets.token_hex(12), login, encoded, invite['role']))
            db.execute('UPDATE invitations SET used=1 WHERE token=?', (digest(token),))
            db.execute('INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)', (now(), login, 'Прийнято запрошення: '+invite['role'], '[]'))
        return self.login(login, password, ip)


class Handler(BaseHTTPRequestHandler):
    server_version = 'PersonnelWeb/'+VERSION

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def log_message(self, fmt, *args):
        # Do not log query strings, invitation tokens or login payloads.
        print(f'{now()} {self.command} {urlsplit(self.path).path} {args[1] if len(args)>1 else ""}')

    def origin_allowed(self):
        origin = self.headers.get('Origin')
        if not origin: return True
        return origin in self.server.allowed_origins

    def reply(self, status, data=None, body=None, mime='application/json; charset=utf-8'):
        encoded = body if body is not None else json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(encoded)))
        self.send_header('Cache-Control', 'no-store' if self.path.startswith('/api/') else 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        if self.headers.get('Origin') and self.origin_allowed():
            self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
            self.send_header('Vary', 'Origin')
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self):
        if not self.origin_allowed(): return self.reply(403, {'error': 'Цей сайт не має доступу до API.'})
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin', 'null'))
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization,Content-Type')
        self.send_header('Vary', 'Origin')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self): self.dispatch()
    def do_POST(self): self.dispatch()

    def dispatch(self):
        try:
            path = urlsplit(self.path).path
            if not path.startswith('/api/'):
                if self.command != 'GET': raise Problem('Метод не підтримується.', 405)
                names = {'/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/excel.js': 'excel.js', **{('/'+name):name for name in ('model.js','extensions.js','backup-client.js','excel-styles.js','schedule-export.js')}, '/config.js': 'config.js', '/favicon.svg': 'favicon.svg', '/manifest.webmanifest': 'manifest.webmanifest'}
                if path not in names: raise Problem('Сторінку не знайдено.', 404)
                file = STATIC/names[path]
                if path=='/config.js' and self.server.cloud_api:
                    config='window.PERSONNEL_CONFIG = '+json.dumps({'API_URL':'','SHARE_URL':ONLINE_SITE})+';'
                    return self.reply(200,body=config.encode(),mime='text/javascript; charset=utf-8')
                mime = {'html': 'text/html', 'js': 'text/javascript', 'css': 'text/css', 'svg': 'image/svg+xml', 'webmanifest': 'application/manifest+json'}[file.suffix[1:]]+'; charset=utf-8'
                return self.reply(200, body=file.read_bytes(), mime=mime)
            if not self.origin_allowed(): raise Problem('Цей сайт не має доступу до API.', 403)
            payload = {}
            if self.command == 'POST':
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= (20_000_000 if path=='/api/full-restore' else MAX_BODY): raise Problem('Запит надто великий або порожній.', 413)
                if self.headers.get_content_type() != 'application/json': raise Problem('Очікується JSON.', 415)
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict): raise Problem('Очікується об’єкт JSON.')
            if self.server.cloud_api and path!='/api/update':
                return self.proxy_cloud(payload if self.command=='POST' else None)
            db = self.server.database
            if path == '/api/health' and self.command == 'GET': return self.reply(200, {'ok': True, 'version': VERSION})
            if path == '/api/login' and self.command == 'POST': return self.reply(200, db.login(payload.get('login'), payload.get('password'), self.client_address[0]))
            if path == '/api/redeem' and self.command == 'POST': return self.reply(200, db.redeem(payload.get('invitation'), payload.get('login'), payload.get('password'), self.client_address[0]))
            token = self.headers.get('Authorization', '').removeprefix('Bearer ')
            user = self.cloud_identity(token) if self.server.cloud_api else db.identity(token)
            if path=='/api/register' and self.command=='POST':
                if user['role']!='owner' or payload.get('role') not in ('viewer','editor'):raise Problem('Доступ адміністратора.',403)
                login=text(payload.get('login'),100,True).casefold()
                with db.connect() as conn:
                    if conn.execute('SELECT id FROM users WHERE login=?',(login,)).fetchone():raise Problem('Логін уже існує.')
                    conn.execute('INSERT INTO users VALUES(?,?,?,?,1)',(secrets.token_hex(12),login,password_hash(payload.get('password')),payload['role']))
                    conn.execute('INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)',(now(),user['login'],'Створено обліковий запис: '+login,'[]'))
                return self.reply(200,{'ok':True})
            if path=='/api/full-backup' and self.command=='GET':
                if user['role']!='owner':raise Problem('Доступ адміністратора.',403)
                return self.reply(200,full_backup(db))
            if path=='/api/full-restore' and self.command=='POST':
                if user['role']!='owner':raise Problem('Доступ адміністратора.',403)
                try:return self.reply(200,restore_full(db,user,payload,validate_state))
                except ValueError as exc:raise Problem(str(exc))
            if path == '/api/state' and self.command == 'GET': return self.reply(200, dict(db.read(), user=user))
            if path == '/api/state' and self.command == 'POST': return self.reply(200, db.commit(user, payload.get('state'), payload.get('revision'), payload.get('action', 'Оновлення')))
            if path == '/api/update':
                if user['role'] != 'owner': raise Problem('Оновлення програми доступне адміністратору.', 403)
                updater = self.server.updater
                if self.command == 'GET': return self.reply(200, updater.snapshot())
                if 'enabled' in payload:
                    if not isinstance(payload['enabled'], bool): raise Problem('Неправильне налаштування оновлень.')
                    updater.settings(payload['enabled'])
                action=payload.get('action')
                if action=='check': updater.check_async()
                elif action=='install':
                    if updater.snapshot()['state']!='ready': raise Problem('Оновлення ще не готове. Спочатку перевірте нову версію.')
                    updater.arm()
                    threading.Timer(1.0, self.server.shutdown).start()
                return self.reply(200, updater.snapshot())
            if path == '/api/logout' and self.command == 'POST':
                with db.connect() as conn: conn.execute('DELETE FROM sessions WHERE token=?', (digest(token),))
                return self.reply(200, {'ok': True})
            if path == '/api/password' and self.command == 'POST':
                with db.connect() as conn:
                    row = conn.execute('SELECT password FROM users WHERE id=?', (user['id'],)).fetchone()
                    if not row or not password_ok(payload.get('old'), row['password']): raise Problem('Поточний пароль неправильний.', 403)
                    conn.execute('UPDATE users SET password=? WHERE id=?', (password_hash(payload.get('password')), user['id']))
                    conn.execute('DELETE FROM sessions WHERE user_id=? AND token!=?', (user['id'], digest(token)))
                    conn.execute('INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)', (now(), user['login'], 'Змінено пароль', '[]'))
                return self.reply(200, {'ok': True})
            if path == '/api/invite' and self.command == 'POST': return self.reply(200, db.invite(user, payload.get('role')))
            if path == '/api/backups' and self.command == 'GET':
                if user['role'] != 'owner': raise Problem('Резервні копії доступні адміністратору.', 403)
                with db.connect() as conn: rows = [dict(r) for r in conn.execute('SELECT id,created,actor,revision FROM backups ORDER BY rowid DESC LIMIT 100')]
                return self.reply(200, rows)
            if path == '/api/restore' and self.command == 'POST': return self.reply(200, db.commit(user, None, payload.get('revision'), 'Відновлення резервної копії', text(payload.get('id'), 100, True)))
            if path == '/api/audit' and self.command == 'GET':
                offset = max(0, min(int(parse_qs(urlsplit(self.path).query).get('offset', ['0'])[0]), 1000000))
                with db.connect() as conn: rows = [dict(r) for r in conn.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 100 OFFSET ?', (offset,))]
                for row in rows: row['details'] = json.loads(row['details'])
                return self.reply(200, rows)
            if path == '/api/users' and self.command == 'GET':
                if user['role'] != 'owner': raise Problem('Доступ адміністратора.', 403)
                with db.connect() as conn: rows = [dict(r) for r in conn.execute('SELECT id,login,role,active FROM users')]
                return self.reply(200, rows)
            if path == '/api/users' and self.command == 'POST':
                if user['role'] != 'owner' or payload.get('id') == user['id']: raise Problem('Не можна вимкнути власний доступ.', 403)
                with db.connect() as conn:
                    target = conn.execute('SELECT login,role FROM users WHERE id=?', (payload.get('id'),)).fetchone()
                    if not target or target['role'] == 'owner': raise Problem('Користувача не знайдено або він адміністратор.')
                    conn.execute('UPDATE users SET active=? WHERE id=?', (int(bool(payload.get('active'))), payload.get('id')))
                    conn.execute('DELETE FROM sessions WHERE user_id=?', (payload.get('id'),))
                    conn.execute('INSERT INTO audit(created,actor,action,details) VALUES(?,?,?,?)', (now(), user['login'], 'Зміна доступу: '+target['login'], json.dumps([{'before': not bool(payload.get('active')), 'after': bool(payload.get('active'))}])))
                return self.reply(200, {'ok': True})
            raise Problem('Маршрут не знайдено.', 404)
        except Problem as error:
            self.reply(error.status, {'error': str(error)})
        except (ValueError, TypeError, json.JSONDecodeError):
            self.reply(400, {'error': 'Некоректний запит.'})
        except Exception:
            import traceback
            traceback.print_exc()
            self.reply(500, {'error': 'Помилка сервера. Перевірте журнал сервера.'})

    def cloud_identity(self, token):
        request=urllib.request.Request(self.server.cloud_api+'/api/state',headers={'Authorization':'Bearer '+token,'User-Agent':'Mozilla/5.0 PersonnelWorkspace-PC/'+VERSION})
        try:
            with urllib.request.urlopen(request,timeout=30) as response:return json.load(response)['user']
        except urllib.error.HTTPError as error:
            status=error.code;error.close();raise Problem('Увійдіть в онлайн-базу.',status)
        except (OSError,ValueError):raise Problem('Немає зв’язку з онлайн-базою.',503)

    def proxy_cloud(self,payload):
        # Fixed upstream; no user-selected proxy destinations or stored cloud passwords.
        request=urllib.request.Request(self.server.cloud_api+self.path,data=json.dumps(payload,ensure_ascii=False).encode() if payload is not None else None,headers={'Authorization':self.headers.get('Authorization',''),'Content-Type':'application/json','User-Agent':'Mozilla/5.0 PersonnelWorkspace-PC/'+VERSION},method=self.command)
        try:
            with urllib.request.urlopen(request,timeout=30) as response:
                return self.reply(response.status,body=response.read(20_000_001 if urlsplit(self.path).path=='/api/full-backup' else MAX_BODY+1))
        except urllib.error.HTTPError as error:
            try:return self.reply(error.code,body=error.read(MAX_BODY+1))
            finally:error.close()
        except OSError:raise Problem('Онлайн-база недоступна. Перевірте інтернет; локальні дані не підміняють спільну базу.',503)


def make_server(database, host='127.0.0.1', port=8765, origins=(),cloud_api=None):
    server = ThreadingHTTPServer((host, port), Handler)
    server.database = database
    server.cloud_api = cloud_api
    server.updater = UpdateManager(VERSION, database.path.parent/'updates')
    server.allowed_origins = set(origins) | {f'http://127.0.0.1:{server.server_port}', f'http://localhost:{server.server_port}'}
    return server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default=os.environ.get('HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '8765')))
    parser.add_argument('--database', default=os.environ.get('DATABASE_PATH', str(Path.home()/'PersonnelWeb'/'personnel.sqlite3')))
    parser.add_argument('--init-admin', action='store_true')
    parser.add_argument('--open', action='store_true')
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--online',action='store_true',help='Use the shared hosted database')
    mode.add_argument('--local',action='store_true',help='Use a separate local database')
    args = parser.parse_args()
    online=(args.online or bool(getattr(sys,'frozen',False))) and not args.local
    db = Database(args.database)
    with db.connect() as conn: needs_admin = not conn.execute('SELECT count(*) FROM users').fetchone()[0]
    if not online and (args.init_admin or needs_admin):
        login = os.environ.get('ADMIN_LOGIN', 'admin')
        password = os.environ.get('ADMIN_PASSWORD')
        if not password:
            password = secrets.token_urlsafe(18)
            print('Початковий логін:', login, '\nПочатковий пароль (збережіть):', password, flush=True)
        try: db.bootstrap(login, password)
        except Problem as error: print(error)
    server = make_server(db, args.host, args.port, filter(None, os.environ.get('ALLOWED_ORIGINS', '').split(',')), ONLINE_API if online else None)
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'Кадровий простір {VERSION}: {url}', flush=True)
    if server.updater.supported and server.updater.snapshot()['enabled']: server.updater.check_async()
    if args.open or bool(getattr(sys,'frozen',False)): threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__ == '__main__': main()
